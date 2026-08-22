import { Hono } from 'hono';
// Contrats partagés : `satisfies` ci-dessous fait échouer la compilation si
// la forme émise s'écarte de ce que les clients importent.
import type {
  TwoFactorSetupData,
  LoginData,
  RefreshData,
  RegisterData,
  SessionsData,
  TwoFactorSetupCompleteData,
} from '@tnc-trading/shared/contracts';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { phoneSchema } from '@tnc-trading/shared/validators';
import type { AppEnv } from '../types/env';
import { AuthService } from '../services/auth.service';
import { UserService } from '../services/user.service';
import { WalletService } from '../services/wallet.service';
import { SecurityService, SECURITY_DEFAULTS } from '../services/security.service';
import { NotificationService } from '../services/notification.service';
import { ConfigService } from '../services/config.service';
import { setAuthCookies, clearAuthCookies, getRefreshToken } from '../lib/cookies';
import { encryptTotpSecret, decryptTotpSecret } from '../lib/totp-secret';
import { texte } from '../lib/reponse-erreur';
import { surErreurDeValidation } from '../lib/validation-hook';

const auth = new Hono<AppEnv>();

// ==========================================
// SECURITY HELPERS
// ==========================================

/**
 * SECURITY: Hash verification code before storing in KV
 * Uses SHA-256 to prevent plaintext code exposure if KV is compromised
 */
async function hashVerificationCode(code: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(code);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * SECURITY: Constant-time string comparison to prevent timing attacks
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Compare against dummy to maintain constant time
    const dummy = 'x'.repeat(Math.max(a.length, b.length));
    a = a.padEnd(dummy.length, '\0');
    b = b.padEnd(dummy.length, '\0');
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0 && a.length === b.length;
}

// ==========================================
// VALIDATION SCHEMAS (Banking-grade)
// ==========================================

const registerSchema = z.object({
  email: z.string().email('Email invalide').max(255),
  // La MEME regle que la mise a jour du profil, partagee (ADR 021) : deux copies
  // d'une regle sur un meme champ divergent, et c'est ce qui s'est produit.
  phone: phoneSchema,
  password: z.string()
    .min(SECURITY_DEFAULTS.PASSWORD_MIN_LENGTH, `Le mot de passe doit contenir au moins ${SECURITY_DEFAULTS.PASSWORD_MIN_LENGTH} caractères`)
    .max(SECURITY_DEFAULTS.PASSWORD_MAX_LENGTH),
  country: z.string().length(2).default('BF'),
  firstName: z.string().min(1, 'Prénom requis').max(100).optional(),
  lastName: z.string().min(1, 'Nom requis').max(100).optional(),
});

const loginSchema = z.object({
  identifier: z.string().min(1, 'Identifiant requis'),
  password: z.string().min(1, 'Mot de passe requis'),
  totpCode: z.string().length(6).optional(),
  deviceFingerprint: z.string().optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional(), // Optional - can also come from cookie
});

const verifyEmailSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
});

const verifyPhoneSchema = z.object({
  phone: z.string(),
  code: z.string().length(6),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string()
    .min(SECURITY_DEFAULTS.PASSWORD_MIN_LENGTH)
    .max(SECURITY_DEFAULTS.PASSWORD_MAX_LENGTH),
});

const setup2faSchema = z.object({
  password: z.string().min(1, 'Mot de passe requis pour activer 2FA'),
});

const verify2faSchema = z.object({
  code: z.string().length(6, 'Code 2FA doit être 6 chiffres'),
  secret: z.string().min(1),
});

const disable2faSchema = z.object({
  password: z.string().min(1),
  code: z.string().length(6),
});

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function getClientIp(c: any): string {
  return c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown';
}

function getUserAgent(c: any): string {
  return c.req.header('User-Agent') || 'unknown';
}

// ==========================================
// ROUTES
// ==========================================

// POST /auth/register
auth.post('/register', zValidator('json', registerSchema, surErreurDeValidation), async (c) => {
  const body = c.req.valid('json');
  const requestId = crypto.randomUUID();
  const ipAddress = getClientIp(c);
  const userAgent = getUserAgent(c);

  const configService = new ConfigService(c.env.DB, c.env.CACHE);
  const authService = new AuthService(c.env.JWT_SECRET, configService);
  const userService = new UserService(c.env.DB);
  const walletService = new WalletService(c.env.DB);
  const securityService = new SecurityService(c.env.DB, c.env.CACHE, configService);

  try {
    // Rate limit registration attempts by IP
    const [registerMax, registerWindow] = await Promise.all([
      configService.getNumber('rate_limit_register_max', 5),
      configService.getNumber('rate_limit_register_window', 3600),
    ]);
    const rateLimit = await securityService.checkRateLimit(
      ipAddress,
      'register',
      registerMax,
      registerWindow
    );

    if (!rateLimit.allowed) {
      await securityService.logSecurityEvent({
        action: 'REGISTRATION_RATE_LIMITED',
        identifier: body.email,
        ipAddress,
        userAgent,
        riskLevel: 'medium',
      });

      return c.json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: texte(c, 'RATE_LIMIT_EXCEEDED'),
        },
        requestId,
      }, 429);
    }

    // Validate password strength
    const passwordValidation = securityService.validatePassword(body.password);
    if (!passwordValidation.valid) {
      return c.json({
        success: false,
        error: {
          code: 'WEAK_PASSWORD',
          message: texte(c, 'WEAK_PASSWORD'),
          details: passwordValidation.errors,
        },
        requestId,
      }, 400);
    }

    // Check if user already exists
    const existingByEmail = await userService.findByEmail(body.email);
    if (existingByEmail) {
      // Don't reveal that email exists - security best practice
      await securityService.logSecurityEvent({
        action: 'REGISTRATION_DUPLICATE_EMAIL',
        identifier: body.email,
        ipAddress,
        riskLevel: 'low',
      });

      return c.json({
        success: false,
        error: {
          code: 'AUTH_EMAIL_EXISTS',
          message: texte(c, 'AUTH_EMAIL_EXISTS'),
        },
        requestId,
      }, 400);
    }

    const existingByPhone = await userService.findByPhone(body.phone);
    if (existingByPhone) {
      return c.json({
        success: false,
        error: {
          code: 'AUTH_PHONE_EXISTS',
          message: texte(c, 'AUTH_PHONE_EXISTS'),
        },
        requestId,
      }, 400);
    }

    // Hash password
    const passwordHash = await authService.hashPassword(body.password);

    // Create user
    const userId = crypto.randomUUID();
    const user = await userService.create({
      id: userId,
      email: body.email.toLowerCase().trim(),
      phone: body.phone.trim(),
      passwordHash,
      country: body.country,
      firstName: body.firstName?.trim(),
      lastName: body.lastName?.trim(),
    });

    // Store password in history
    await securityService.addPasswordToHistory(userId, passwordHash);

    // Create wallet
    const walletId = crypto.randomUUID();
    await walletService.create(userId, walletId);

    // Generate verification code
    const verificationCode = authService.generateVerificationCode();
    const verificationCodeTtl = await configService.getNumber('verification_code_ttl', 900);

    // SECURITY: Hash verification code before storing in KV
    const hashedCode = await hashVerificationCode(verificationCode);
    await c.env.CACHE.put(
      `verify:email:${body.email.toLowerCase()}`,
      JSON.stringify({
        code: hashedCode,
        userId,
        attempts: 0,
        createdAt: Date.now(),
      }),
      { expirationTtl: verificationCodeTtl }
    );

    // Initialize notification service and send emails/SMS
    const notificationService = new NotificationService(c.env.DB, {
      resendApiKey: c.env.RESEND_API_KEY,
      sendgridApiKey: c.env.SENDGRID_API_KEY,
      twilioAccountSid: c.env.TWILIO_ACCOUNT_SID,
      twilioAuthToken: c.env.TWILIO_AUTH_TOKEN,
      twilioPhoneNumber: c.env.TWILIO_PHONE_NUMBER,
    });

    // Send welcome email (non-blocking)
    notificationService.sendWelcomeEmail(body.email, body.email.split('@')[0]).catch(err => {
      console.error('Failed to send welcome email:', err);
    });

    // Send verification code email
    notificationService.sendVerificationCode(body.email, verificationCode, 'email').catch(err => {
      console.error('Failed to send verification email:', err);
    });

    // Also store phone verification code and send SMS
    const phoneVerificationCode = authService.generateVerificationCode();
    // SECURITY: Hash phone verification code before storing
    const hashedPhoneCode = await hashVerificationCode(phoneVerificationCode);
    await c.env.CACHE.put(
      `verify:phone:${body.phone}`,
      JSON.stringify({
        code: hashedPhoneCode,
        userId,
        attempts: 0,
        createdAt: Date.now(),
      }),
      { expirationTtl: verificationCodeTtl }
    );

    // Send SMS verification code (non-blocking)
    notificationService.sendVerificationCodeSms(body.phone, phoneVerificationCode).catch(err => {
      console.error('Failed to send verification SMS:', err);
    });

    // Log successful registration
    await securityService.logAuditEvent({
      userId,
      action: 'USER_REGISTERED',
      entityType: 'user',
      entityId: userId,
      ipAddress,
      userAgent,
      riskLevel: 'low',
      success: true,
    });

    return c.json({
      success: true,
      data: {
        message: 'Compte créé avec succès. Vérifiez votre email.',
        userId: user.id,
        passwordStrength: passwordValidation.strength,
      } satisfies RegisterData,
      requestId,
    }, 201);
  } catch (error) {
    console.error('Registration error:', error);
    await securityService.logSecurityEvent({
      action: 'REGISTRATION_ERROR',
      identifier: body.email,
      ipAddress,
      details: { error: error instanceof Error ? error.message : 'Unknown' },
      riskLevel: 'medium',
    });

    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId,
    }, 500);
  }
});

// POST /auth/login
auth.post('/login', zValidator('json', loginSchema, surErreurDeValidation), async (c) => {
  const body = c.req.valid('json');
  const requestId = crypto.randomUUID();
  const ipAddress = getClientIp(c);
  const userAgent = getUserAgent(c);

  const configService = new ConfigService(c.env.DB, c.env.CACHE);
  const authService = new AuthService(c.env.JWT_SECRET, configService);
  const userService = new UserService(c.env.DB);
  const securityService = new SecurityService(c.env.DB, c.env.CACHE, configService);

  try {
    // Check if IP is blocked
    const ipBlocked = await c.env.DB
      .prepare('SELECT * FROM ip_blocklist WHERE ip_address = ? AND (expires_at IS NULL OR expires_at > datetime("now"))')
      .bind(ipAddress)
      .first();

    if (ipBlocked) {
      return c.json({
        success: false,
        error: {
          code: 'IP_BLOCKED',
          message: texte(c, 'IP_BLOCKED'),
        },
        requestId,
      }, 403);
    }

    // Rate limit login attempts by IP
    const secCfg = await securityService.getSecurityConfig();
    const ipRateLimit = await securityService.checkRateLimit(
      ipAddress,
      'login_ip',
      secCfg.rateLimitLoginPerMinute,
      60
    );

    if (!ipRateLimit.allowed) {
      await securityService.logSecurityEvent({
        action: 'LOGIN_RATE_LIMITED_IP',
        identifier: body.identifier,
        ipAddress,
        userAgent,
        riskLevel: 'high',
      });

      return c.json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: texte(c, 'RATE_LIMIT_EXCEEDED'),
        },
        requestId,
      }, 429);
    }

    // Check if account is locked (by identifier)
    const lockStatus = await securityService.isAccountLocked(body.identifier.toLowerCase());
    if (lockStatus.locked) {
      return c.json({
        success: false,
        error: {
          code: 'AUTH_ACCOUNT_LOCKED',
          message: texte(c, 'AUTH_ACCOUNT_LOCKED', { minutes: Math.ceil(lockStatus.remainingSeconds! / 60) }),
          lockoutUntil: lockStatus.lockoutUntil,
        },
        requestId,
      }, 403);
    }

    // Find user by email or phone
    const user = await userService.findByEmailOrPhone(body.identifier.toLowerCase());
    if (!user) {
      // Record failed attempt even for non-existent users (prevents enumeration timing attacks)
      await securityService.recordFailedLogin(body.identifier.toLowerCase(), ipAddress);

      await securityService.logSecurityEvent({
        action: 'LOGIN_FAILED_USER_NOT_FOUND',
        identifier: body.identifier,
        ipAddress,
        userAgent,
        riskLevel: 'low',
      });

      return c.json({
        success: false,
        error: {
          code: 'AUTH_INVALID_CREDENTIALS',
          message: texte(c, 'AUTH_INVALID_CREDENTIALS'),
        },
        requestId,
      }, 401);
    }

    // Verify password (with automatic Argon2id upgrade for legacy PBKDF2 hashes)
    const passwordResult = await authService.verifyPasswordWithRehashCheck(body.password, user.password_hash);
    if (!passwordResult.valid) {
      const lockResult = await securityService.recordFailedLogin(body.identifier.toLowerCase(), ipAddress);

      await securityService.logSecurityEvent({
        action: 'LOGIN_FAILED_WRONG_PASSWORD',
        userId: user.id,
        identifier: body.identifier,
        ipAddress,
        userAgent,
        details: { attemptsRemaining: lockResult.attemptsRemaining },
        riskLevel: lockResult.locked ? 'high' : 'medium',
      });

      if (lockResult.locked) {
        return c.json({
          success: false,
          error: {
            code: 'AUTH_ACCOUNT_LOCKED',
            message: texte(c, 'AUTH_ACCOUNT_LOCKED', {}),
            lockoutUntil: lockResult.lockoutUntil,
          },
          requestId,
        }, 403);
      }

      return c.json({
        success: false,
        error: {
          code: 'AUTH_INVALID_CREDENTIALS',
          message: texte(c, 'AUTH_INVALID_CREDENTIALS'),
          attemptsRemaining: lockResult.attemptsRemaining,
        },
        requestId,
      }, 401);
    }

    // Upgrade legacy PBKDF2 hash to Argon2id (transparent migration)
    if (passwordResult.needsRehash) {
      try {
        const newHash = await authService.hashPassword(body.password);
        await c.env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?')
          .bind(newHash, user.id)
          .run();
        console.log(`[Auth] Upgraded password hash for user ${user.id} to Argon2id`);
      } catch (e) {
        // Non-blocking: log but don't fail login
        console.error('[Auth] Failed to upgrade password hash:', e);
      }
    }

    // 2FA is mandatory - check if set up
    if (!user.two_factor_secret) {
      // 2FA not set up - generate setup token and require setup
      const setupToken = crypto.randomUUID();
      await c.env.CACHE.put(
        `user_2fa_setup:${setupToken}`,
        JSON.stringify({ userId: user.id, email: user.email }),
        { expirationTtl: 600 } // 10 minutes
      );

      return c.json({
        success: false,
        error: {
          code: 'AUTH_2FA_SETUP_REQUIRED',
          message: texte(c, 'AUTH_2FA_SETUP_REQUIRED'),
        },
        data: {
          setupToken,
          userId: user.id,
        },
        requestId,
      }, 403);
    }

    // 2FA is set up - verify code
    if (!body.totpCode) {
      return c.json({
        success: false,
        error: {
          code: 'AUTH_2FA_REQUIRED',
          message: texte(c, 'AUTH_2FA_REQUIRED'),
        },
        requestId,
      }, 401);
    }

    const loginTotpSecret = await decryptTotpSecret(c.env.ENCRYPTION_KEY, user.two_factor_secret);
    const isValidTotp = await securityService.verifyTotpCode(loginTotpSecret, body.totpCode, user.id);
    if (!isValidTotp) {
      await securityService.logSecurityEvent({
        action: 'LOGIN_FAILED_INVALID_2FA',
        userId: user.id,
        ipAddress,
        userAgent,
        riskLevel: 'high',
      });

      return c.json({
        success: false,
        error: {
          code: 'AUTH_2FA_INVALID',
          message: texte(c, 'AUTH_2FA_INVALID'),
        },
        requestId,
      }, 401);
    }

    // Clear login attempts on successful login
    await securityService.clearLoginAttempts(body.identifier.toLowerCase());

    // Update last login
    await userService.updateLastLogin(user.id);

    // Generate tokens
    // Mint the session id first so it can be embedded as the token's `sid`.
    const sessionId = crypto.randomUUID();
    const tokens = await authService.generateTokens({
      sub: user.id,
      email: user.email,
      kycLevel: user.kyc_level,
      sid: sessionId,
    });

    // Create session record
    const sessionTokenHash = await authService.hashPassword(tokens.accessToken.slice(-32));

    const sessionTimeoutHours = secCfg.absoluteSessionTimeoutHours;
    await c.env.DB
      .prepare(`
        INSERT INTO active_sessions (id, user_id, session_token_hash, ip_address, user_agent, device_type, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' hours'), datetime('now'))
      `)
      .bind(sessionId, user.id, sessionTokenHash, ipAddress, userAgent, 'web', sessionTimeoutHours)
      .run();

    // Log successful login
    await securityService.logAuditEvent({
      userId: user.id,
      action: 'USER_LOGIN',
      entityType: 'session',
      entityId: sessionId,
      ipAddress,
      userAgent,
      riskLevel: 'low',
      success: true,
    });

    // Set httpOnly cookies for secure token storage
    setAuthCookies(c, tokens.accessToken, tokens.refreshToken, tokens.expiresIn, c.env.ENVIRONMENT || 'development');

    return c.json({
      success: true,
      data: {
        // Still return tokens in body for mobile apps (they don't use cookies)
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          country: user.country,
          kycLevel: user.kyc_level,
          kycStatus: user.kyc_status,
          emailVerified: Boolean(user.email_verified),
          phoneVerified: Boolean(user.phone_verified),
          twoFactorEnabled: Boolean(user.two_factor_enabled),
        },
        sessionId,
      } satisfies LoginData,
      requestId,
    });
  } catch (error) {
    console.error('Login error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId,
    }, 500);
  }
});

// POST /auth/refresh
auth.post('/refresh', zValidator('json', refreshSchema, surErreurDeValidation), async (c) => {
  const body = c.req.valid('json');
  const requestId = crypto.randomUUID();
  const ipAddress = getClientIp(c);

  const authService = new AuthService(c.env.JWT_SECRET);

  try {
    // SECURITY: Rate limit refresh attempts per IP (max 10 per 5 minutes)
    const rateLimitKey = `refresh_rate:${ipAddress}`;
    const attempts = await c.env.CACHE.get(rateLimitKey);
    if (attempts) {
      const attemptCount = parseInt(attempts, 10);
      if (attemptCount >= 10) {
        return c.json({
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: texte(c, 'RATE_LIMITED'),
          },
          requestId,
        }, 429);
      }
      await c.env.CACHE.put(rateLimitKey, String(attemptCount + 1), { expirationTtl: 300 });
    } else {
      await c.env.CACHE.put(rateLimitKey, '1', { expirationTtl: 300 });
    }

    // Get refresh token from body or cookie
    const refreshToken = body.refreshToken || getRefreshToken(c);

    if (!refreshToken) {
      return c.json({
        success: false,
        error: {
          code: 'AUTH_REFRESH_TOKEN_REQUIRED',
          message: texte(c, 'AUTH_REFRESH_TOKEN_REQUIRED'),
        },
        requestId,
      }, 400);
    }

    // Load the user's invalidation epoch so refresh tokens issued before a
    // logout/password-reset are rejected (decode sub without trusting it yet).
    let invalidBefore: string | null = null;
    const preCheck = await authService.verifyToken(refreshToken);
    if (preCheck?.sub) {
      const userRow = await c.env.DB
        .prepare('SELECT tokens_invalid_before FROM users WHERE id = ?')
        .bind(preCheck.sub)
        .first<{ tokens_invalid_before: string | null }>();
      invalidBefore = userRow?.tokens_invalid_before ?? null;
    }

    const tokens = await authService.refreshAccessToken(refreshToken, invalidBefore);

    if (!tokens) {
      return c.json({
        success: false,
        error: {
          code: 'AUTH_INVALID_REFRESH_TOKEN',
          message: texte(c, 'AUTH_INVALID_REFRESH_TOKEN'),
        },
        requestId,
      }, 401);
    }

    // Set new cookies
    setAuthCookies(c, tokens.accessToken, tokens.refreshToken, tokens.expiresIn, c.env.ENVIRONMENT || 'development');

    return c.json({
      success: true,
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      } satisfies RefreshData,
      requestId,
    });
  } catch (error) {
    console.error('Refresh error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId,
    }, 500);
  }
});

// POST /auth/logout
auth.post('/logout', async (c) => {
  const requestId = crypto.randomUUID();
  const ipAddress = getClientIp(c);

  try {
    // Get token from header or cookie
    const { getAccessToken } = await import('../lib/cookies');
    const token = getAccessToken(c);

    if (token) {
      const authService = new AuthService(c.env.JWT_SECRET);
      const payload = await authService.verifyToken(token);

      if (payload) {
        // SECURITY: Invalidate ALL sessions and refresh tokens for user, and
        // bump the token epoch so any already-issued refresh token is rejected.
        await Promise.all([
          c.env.DB
            .prepare('DELETE FROM active_sessions WHERE user_id = ?')
            .bind(payload.sub)
            .run(),
          c.env.DB
            .prepare('DELETE FROM sessions WHERE user_id = ?')
            .bind(payload.sub)
            .run(),
          c.env.DB
            .prepare("UPDATE users SET tokens_invalid_before = datetime('now') WHERE id = ?")
            .bind(payload.sub)
            .run(),
        ]);

        const securityService = new SecurityService(c.env.DB, c.env.CACHE);
        await securityService.logAuditEvent({
          userId: payload.sub,
          action: 'USER_LOGOUT',
          entityType: 'session',
          ipAddress,
          riskLevel: 'low',
          success: true,
        });
      }
    }

    // Clear auth cookies
    clearAuthCookies(c, c.env.ENVIRONMENT || 'development');

    return c.json({
      success: true,
      data: { message: 'Déconnexion réussie' },
      requestId,
    });
  } catch (error) {
    return c.json({
      success: true,
      data: { message: 'Déconnexion réussie' },
      requestId,
    });
  }
});

// POST /auth/verify-email
auth.post('/verify-email', zValidator('json', verifyEmailSchema, surErreurDeValidation), async (c) => {
  const body = c.req.valid('json');
  const requestId = crypto.randomUUID();
  const ipAddress = getClientIp(c);

  const userService = new UserService(c.env.DB);
  const configService = new ConfigService(c.env.DB, c.env.CACHE);
  const securityService = new SecurityService(c.env.DB, c.env.CACHE, configService);

  try {
    const [verificationMaxAttempts, verificationCodeTtl] = await Promise.all([
      configService.getNumber('verification_max_attempts', 5),
      configService.getNumber('verification_code_ttl', 900),
    ]);

    // Get stored verification data
    const storedDataStr = await c.env.CACHE.get(`verify:email:${body.email.toLowerCase()}`);
    if (!storedDataStr) {
      return c.json({
        success: false,
        error: {
          code: 'AUTH_INVALID_CODE',
          message: texte(c, 'AUTH_INVALID_CODE'),
        },
        requestId,
      }, 400);
    }

    const storedData = JSON.parse(storedDataStr);

    // Check attempts
    if (storedData.attempts >= verificationMaxAttempts) {
      await c.env.CACHE.delete(`verify:email:${body.email.toLowerCase()}`);
      return c.json({
        success: false,
        error: {
          code: 'AUTH_TOO_MANY_ATTEMPTS',
          message: texte(c, 'AUTH_TOO_MANY_ATTEMPTS'),
        },
        requestId,
      }, 400);
    }

    // SECURITY: Hash user input and use constant-time comparison
    const hashedInputCode = await hashVerificationCode(body.code);
    if (!constantTimeEqual(storedData.code, hashedInputCode)) {
      // Increment attempts
      storedData.attempts++;
      await c.env.CACHE.put(
        `verify:email:${body.email.toLowerCase()}`,
        JSON.stringify(storedData),
        { expirationTtl: verificationCodeTtl }
      );

      return c.json({
        success: false,
        error: {
          code: 'AUTH_INVALID_CODE',
          message: texte(c, 'AUTH_INVALID_CODE'),
          attemptsRemaining: verificationMaxAttempts - storedData.attempts,
        },
        requestId,
      }, 400);
    }

    // Verify email
    const user = await userService.findByEmail(body.email);
    if (!user) {
      return c.json({
        success: false,
        error: {
          code: 'AUTH_USER_NOT_FOUND',
          message: texte(c, 'AUTH_USER_NOT_FOUND'),
        },
        requestId,
      }, 404);
    }

    await userService.verifyEmail(user.id);
    await c.env.CACHE.delete(`verify:email:${body.email.toLowerCase()}`);

    await securityService.logAuditEvent({
      userId: user.id,
      action: 'EMAIL_VERIFIED',
      entityType: 'user',
      entityId: user.id,
      ipAddress,
      riskLevel: 'low',
      success: true,
    });

    return c.json({
      success: true,
      data: { message: 'Email vérifié avec succès' },
      requestId,
    });
  } catch (error) {
    console.error('Verify email error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId,
    }, 500);
  }
});

// POST /auth/verify-phone
auth.post('/verify-phone', zValidator('json', verifyPhoneSchema, surErreurDeValidation), async (c) => {
  const body = c.req.valid('json');
  const requestId = crypto.randomUUID();

  const userService = new UserService(c.env.DB);
  const configService = new ConfigService(c.env.DB, c.env.CACHE);

  try {
    const [verificationMaxAttempts, verificationCodeTtl] = await Promise.all([
      configService.getNumber('verification_max_attempts', 5),
      configService.getNumber('verification_code_ttl', 900),
    ]);

    const storedDataStr = await c.env.CACHE.get(`verify:phone:${body.phone}`);
    if (!storedDataStr) {
      return c.json({
        success: false,
        error: {
          code: 'AUTH_INVALID_CODE',
          message: texte(c, 'AUTH_INVALID_CODE'),
        },
        requestId,
      }, 400);
    }

    const storedData = JSON.parse(storedDataStr);

    if (storedData.attempts >= verificationMaxAttempts) {
      await c.env.CACHE.delete(`verify:phone:${body.phone}`);
      return c.json({
        success: false,
        error: {
          code: 'AUTH_TOO_MANY_ATTEMPTS',
          message: texte(c, 'AUTH_TOO_MANY_ATTEMPTS'),
        },
        requestId,
      }, 400);
    }

    // SECURITY: Hash user input and use constant-time comparison
    const hashedInputCode = await hashVerificationCode(body.code);
    if (!constantTimeEqual(storedData.code, hashedInputCode)) {
      storedData.attempts++;
      await c.env.CACHE.put(
        `verify:phone:${body.phone}`,
        JSON.stringify(storedData),
        { expirationTtl: verificationCodeTtl }
      );

      return c.json({
        success: false,
        error: {
          code: 'AUTH_INVALID_CODE',
          message: texte(c, 'AUTH_INVALID_CODE'),
        },
        requestId,
      }, 400);
    }

    const user = await userService.findByPhone(body.phone);
    if (!user) {
      return c.json({
        success: false,
        error: {
          code: 'AUTH_USER_NOT_FOUND',
          message: texte(c, 'AUTH_USER_NOT_FOUND'),
        },
        requestId,
      }, 404);
    }

    await userService.verifyPhone(user.id);
    await c.env.CACHE.delete(`verify:phone:${body.phone}`);

    return c.json({
      success: true,
      data: { message: 'Téléphone vérifié avec succès' },
      requestId,
    });
  } catch (error) {
    console.error('Verify phone error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId,
    }, 500);
  }
});

// POST /auth/forgot-password
auth.post('/forgot-password', zValidator('json', forgotPasswordSchema, surErreurDeValidation), async (c) => {
  const body = c.req.valid('json');
  const requestId = crypto.randomUUID();
  const ipAddress = getClientIp(c);

  const configService = new ConfigService(c.env.DB, c.env.CACHE);
  const authService = new AuthService(c.env.JWT_SECRET, configService);
  const userService = new UserService(c.env.DB);
  const securityService = new SecurityService(c.env.DB, c.env.CACHE, configService);

  try {
    // Rate limit password reset requests (configurable)
    const [resetRateMax, resetRateWindow, resetTokenTtl] = await Promise.all([
      configService.getNumber('rate_limit_password_reset_max', 3),
      configService.getNumber('rate_limit_password_reset_window', 3600),
      configService.getNumber('reset_token_ttl', 3600),
    ]);

    const rateLimit = await securityService.checkRateLimit(
      ipAddress,
      'password_reset',
      resetRateMax,
      resetRateWindow
    );

    if (!rateLimit.allowed) {
      return c.json({
        success: true, // Don't reveal rate limit to prevent enumeration
        data: { message: 'Si cet email existe, un lien de réinitialisation a été envoyé' },
        requestId,
      });
    }

    const user = await userService.findByEmail(body.email.toLowerCase());

    if (user) {
      const resetToken = authService.generateSessionId();
      await c.env.CACHE.put(
        `reset:${resetToken}`,
        JSON.stringify({
          userId: user.id,
          email: user.email,
          createdAt: Date.now(),
        }),
        { expirationTtl: resetTokenTtl }
      );

      await securityService.logAuditEvent({
        userId: user.id,
        action: 'PASSWORD_RESET_REQUESTED',
        entityType: 'user',
        entityId: user.id,
        ipAddress,
        riskLevel: 'medium',
        success: true,
      });

      // Send password reset email
      const notificationService = new NotificationService(c.env.DB, {
        resendApiKey: c.env.RESEND_API_KEY,
        sendgridApiKey: c.env.SENDGRID_API_KEY,
      });

      const [appUrl, appName] = await Promise.all([
        configService.get('app_url', 'https://app.tnc-trading.com'),
        configService.get('app_name', 'TNC Trading'),
      ]);
      const resetUrl = `${appUrl}/reset-password?token=${resetToken}`;
      const resetTokenTtlHours = Math.floor(resetTokenTtl / 3600);
      const resetTokenTtlLabel = resetTokenTtlHours >= 1 ? `${resetTokenTtlHours} heure${resetTokenTtlHours > 1 ? 's' : ''}` : `${Math.floor(resetTokenTtl / 60)} minutes`;
      notificationService.sendEmail({
        to: user.email,
        subject: `Réinitialisation de votre mot de passe - ${appName}`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center; }
              .header h1 { color: #d4a373; margin: 0; }
              .content { padding: 30px; background: #f9f9f9; }
              .button { display: inline-block; padding: 12px 30px; background: #d4a373; color: white; text-decoration: none; border-radius: 5px; }
              .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>${appName}</h1>
              </div>
              <div class="content">
                <h2>Réinitialisation du mot de passe</h2>
                <p>Vous avez demandé la réinitialisation de votre mot de passe.</p>
                <p>Cliquez sur le bouton ci-dessous pour définir un nouveau mot de passe :</p>
                <p style="text-align: center;">
                  <a href="${resetUrl}" class="button">Réinitialiser mon mot de passe</a>
                </p>
                <p style="color: #666; font-size: 12px; margin-top: 20px;">
                  Ce lien expire dans ${resetTokenTtlLabel}. Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.
                </p>
              </div>
              <div class="footer">
                <p>© ${new Date().getFullYear()} ${appName}. Tous droits réservés.</p>
              </div>
            </div>
          </body>
          </html>
        `,
      }).catch(err => {
        console.error('Failed to send password reset email:', err);
      });
    }

    // Always return success to prevent email enumeration
    return c.json({
      success: true,
      data: { message: 'Si cet email existe, un lien de réinitialisation a été envoyé' },
      requestId,
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return c.json({
      success: true,
      data: { message: 'Si cet email existe, un lien de réinitialisation a été envoyé' },
      requestId,
    });
  }
});

// POST /auth/reset-password
auth.post('/reset-password', zValidator('json', resetPasswordSchema, surErreurDeValidation), async (c) => {
  const body = c.req.valid('json');
  const requestId = crypto.randomUUID();
  const ipAddress = getClientIp(c);

  const authService = new AuthService(c.env.JWT_SECRET);
  const userService = new UserService(c.env.DB);
  const securityService = new SecurityService(c.env.DB, c.env.CACHE);

  try {
    // Get user ID from reset token
    const storedDataStr = await c.env.CACHE.get(`reset:${body.token}`);
    if (!storedDataStr) {
      return c.json({
        success: false,
        error: {
          code: 'AUTH_INVALID_RESET_TOKEN',
          message: texte(c, 'AUTH_INVALID_RESET_TOKEN'),
        },
        requestId,
      }, 400);
    }

    const storedData = JSON.parse(storedDataStr);

    // Validate password strength
    const passwordValidation = securityService.validatePassword(body.password);
    if (!passwordValidation.valid) {
      return c.json({
        success: false,
        error: {
          code: 'WEAK_PASSWORD',
          message: texte(c, 'WEAK_PASSWORD'),
          details: passwordValidation.errors,
        },
        requestId,
      }, 400);
    }

    // Hash new password
    const passwordHash = await authService.hashPassword(body.password);

    // Check password history (verify plaintext against salted stored hashes)
    const isNewPassword = await securityService.checkPasswordHistory(
      storedData.userId,
      body.password,
      (plain, hash) => authService.verifyPassword(plain, hash),
      5
    );
    if (!isNewPassword) {
      return c.json({
        success: false,
        error: {
          code: 'PASSWORD_RECENTLY_USED',
          message: texte(c, 'PASSWORD_RECENTLY_USED'),
        },
        requestId,
      }, 400);
    }

    // Update password
    await c.env.DB
      .prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(passwordHash, storedData.userId)
      .run();

    // Add to password history
    await securityService.addPasswordToHistory(storedData.userId, passwordHash);

    // Delete reset token
    await c.env.CACHE.delete(`reset:${body.token}`);

    // Clear any login attempts
    await securityService.clearLoginAttempts(storedData.email);

    // SECURITY: Invalidate ALL sessions and refresh tokens after password reset
    await Promise.all([
      c.env.DB
        .prepare('DELETE FROM active_sessions WHERE user_id = ?')
        .bind(storedData.userId)
        .run(),
      c.env.DB
        .prepare('DELETE FROM sessions WHERE user_id = ?')
        .bind(storedData.userId)
        .run(),
      c.env.DB
        .prepare("UPDATE users SET tokens_invalid_before = datetime('now') WHERE id = ?")
        .bind(storedData.userId)
        .run(),
    ]);

    await securityService.logAuditEvent({
      userId: storedData.userId,
      action: 'PASSWORD_RESET_COMPLETED',
      entityType: 'user',
      entityId: storedData.userId,
      ipAddress,
      riskLevel: 'high',
      success: true,
    });

    return c.json({
      success: true,
      data: {
        message: 'Mot de passe réinitialisé avec succès',
        passwordStrength: passwordValidation.strength,
      },
      requestId,
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId,
    }, 500);
  }
});

// POST /auth/2fa/setup - Initialize 2FA setup
auth.post('/2fa/setup', zValidator('json', setup2faSchema, surErreurDeValidation), async (c) => {
  const body = c.req.valid('json');
  const requestId = crypto.randomUUID();

  const authService = new AuthService(c.env.JWT_SECRET);
  const securityService = new SecurityService(c.env.DB, c.env.CACHE);

  try {
    // Verify user is authenticated
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: texte(c, 'AUTH_REQUIRED') },
        requestId,
      }, 401);
    }

    const payload = await authService.verifyToken(authHeader.substring(7));
    if (!payload) {
      return c.json({
        success: false,
        error: { code: 'AUTH_INVALID_TOKEN', message: texte(c, 'AUTH_INVALID_TOKEN') },
        requestId,
      }, 401);
    }

    // Verify password before enabling 2FA
    const user = await c.env.DB
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(payload.sub)
      .first<any>();

    if (!user) {
      return c.json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: texte(c, 'USER_NOT_FOUND') },
        requestId,
      }, 404);
    }

    const passwordResult = await authService.verifyPasswordWithRehashCheck(body.password, user.password_hash);
    if (!passwordResult.valid) {
      return c.json({
        success: false,
        error: { code: 'AUTH_INVALID_PASSWORD', message: texte(c, 'AUTH_INVALID_PASSWORD') },
        requestId,
      }, 401);
    }

    // Upgrade legacy PBKDF2 hash to Argon2id (transparent migration)
    if (passwordResult.needsRehash) {
      const newHash = await authService.hashPassword(body.password);
      await c.env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?')
        .bind(newHash, user.id)
        .run();
    }

    // Check if 2FA is already enabled
    if (user.two_factor_enabled) {
      return c.json({
        success: false,
        error: { code: '2FA_ALREADY_ENABLED', message: texte(c, '2FA_ALREADY_ENABLED') },
        requestId,
      }, 400);
    }

    // Generate TOTP secret
    const secret = securityService.generateTotpSecret();
    const uri = await securityService.generateTotpUri(secret, user.email);

    // Store pending 2FA setup (configurable TTL)
    const configService = new ConfigService(c.env.DB, c.env.CACHE);
    const [twoFactorSetupTtl, totpIssuer] = await Promise.all([
      configService.getNumber('two_factor_setup_ttl', 600),
      configService.get('totp_issuer', SECURITY_DEFAULTS.TOTP_ISSUER),
    ]);

    await c.env.CACHE.put(
      `2fa_setup:${payload.sub}`,
      JSON.stringify({ secret, createdAt: Date.now() }),
      { expirationTtl: twoFactorSetupTtl }
    );

    return c.json({
      success: true,
      data: {
        secret,
        uri,
        issuer: totpIssuer,
        // Aucune image de QR n'est produite : la faire générer par un service
        // externe enverrait la graine TOTP à un tiers.
        message: 'Ajoutez ce compte à votre application d\'authentification',
      } satisfies TwoFactorSetupData,
      requestId,
    });
  } catch (error) {
    console.error('2FA setup error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: texte(c, 'INTERNAL_ERROR') },
      requestId,
    }, 500);
  }
});

// POST /auth/2fa/verify - Verify and enable 2FA
auth.post('/2fa/verify', zValidator('json', verify2faSchema, surErreurDeValidation), async (c) => {
  const body = c.req.valid('json');
  const requestId = crypto.randomUUID();
  const ipAddress = getClientIp(c);

  const configService = new ConfigService(c.env.DB, c.env.CACHE);
  const authService = new AuthService(c.env.JWT_SECRET, configService);
  const securityService = new SecurityService(c.env.DB, c.env.CACHE, configService);

  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: texte(c, 'AUTH_REQUIRED') },
        requestId,
      }, 401);
    }

    const payload = await authService.verifyToken(authHeader.substring(7));
    if (!payload) {
      return c.json({
        success: false,
        error: { code: 'AUTH_INVALID_TOKEN', message: texte(c, 'AUTH_INVALID_TOKEN') },
        requestId,
      }, 401);
    }

    // Get pending 2FA setup
    const setupData = await c.env.CACHE.get(`2fa_setup:${payload.sub}`);
    if (!setupData) {
      return c.json({
        success: false,
        error: { code: '2FA_SETUP_EXPIRED', message: texte(c, '2FA_SETUP_EXPIRED') },
        requestId,
      }, 400);
    }

    const setup = JSON.parse(setupData);

    // Verify the secret matches
    if (setup.secret !== body.secret) {
      return c.json({
        success: false,
        error: { code: '2FA_INVALID_SECRET', message: texte(c, '2FA_INVALID_SECRET') },
        requestId,
      }, 400);
    }

    // Verify TOTP code
    const isValidCode = await securityService.verifyTotpCode(body.secret, body.code, payload.sub);
    if (!isValidCode) {
      return c.json({
        success: false,
        error: { code: '2FA_INVALID_CODE', message: texte(c, '2FA_INVALID_CODE') },
        requestId,
      }, 400);
    }

    // Enable 2FA (secret encrypted at rest)
    const encryptedEnableSecret = await encryptTotpSecret(c.env.ENCRYPTION_KEY, body.secret);
    await c.env.DB
      .prepare('UPDATE users SET two_factor_enabled = 1, two_factor_secret = ?, updated_at = datetime("now") WHERE id = ?')
      .bind(encryptedEnableSecret, payload.sub)
      .run();

    // Generate backup codes (configurable count)
    const backupCodeCount = await configService.getNumber('two_factor_backup_code_count', 10);
    const backupCodes: string[] = [];
    for (let i = 0; i < backupCodeCount; i++) {
      const code = Array.from(crypto.getRandomValues(new Uint8Array(4)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
      backupCodes.push(code);

      // Store hashed backup code
      const codeHash = await authService.hashPassword(code);
      await c.env.DB
        .prepare('INSERT INTO two_factor_backup_codes (id, user_id, code_hash) VALUES (?, ?, ?)')
        .bind(crypto.randomUUID(), payload.sub, codeHash)
        .run();
    }

    // Clear setup data
    await c.env.CACHE.delete(`2fa_setup:${payload.sub}`);

    await securityService.logAuditEvent({
      userId: payload.sub,
      action: '2FA_ENABLED',
      entityType: 'user',
      entityId: payload.sub,
      ipAddress,
      riskLevel: 'high',
      success: true,
    });

    return c.json({
      success: true,
      data: {
        message: '2FA activé avec succès',
        backupCodes,
        warning: 'Conservez ces codes de secours en lieu sûr. Ils ne seront plus affichés.',
      },
      requestId,
    });
  } catch (error) {
    console.error('2FA verify error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: texte(c, 'INTERNAL_ERROR') },
      requestId,
    }, 500);
  }
});

// POST /auth/2fa/disable - Disable 2FA
auth.post('/2fa/disable', zValidator('json', disable2faSchema, surErreurDeValidation), async (c) => {
  const body = c.req.valid('json');
  const requestId = crypto.randomUUID();
  const ipAddress = getClientIp(c);

  const authService = new AuthService(c.env.JWT_SECRET);
  const securityService = new SecurityService(c.env.DB, c.env.CACHE);

  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: texte(c, 'AUTH_REQUIRED') },
        requestId,
      }, 401);
    }

    const payload = await authService.verifyToken(authHeader.substring(7));
    if (!payload) {
      return c.json({
        success: false,
        error: { code: 'AUTH_INVALID_TOKEN', message: texte(c, 'AUTH_INVALID_TOKEN') },
        requestId,
      }, 401);
    }

    const user = await c.env.DB
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(payload.sub)
      .first<any>();

    if (!user || !user.two_factor_enabled) {
      return c.json({
        success: false,
        error: { code: '2FA_NOT_ENABLED', message: texte(c, '2FA_NOT_ENABLED') },
        requestId,
      }, 400);
    }

    // Verify password
    const passwordResult = await authService.verifyPasswordWithRehashCheck(body.password, user.password_hash);
    if (!passwordResult.valid) {
      return c.json({
        success: false,
        error: { code: 'AUTH_INVALID_PASSWORD', message: texte(c, 'AUTH_INVALID_PASSWORD') },
        requestId,
      }, 401);
    }

    // Upgrade legacy PBKDF2 hash to Argon2id (transparent migration)
    if (passwordResult.needsRehash) {
      const newHash = await authService.hashPassword(body.password);
      await c.env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?')
        .bind(newHash, user.id)
        .run();
    }

    // Verify 2FA code
    const disableTotpSecret = await decryptTotpSecret(c.env.ENCRYPTION_KEY, user.two_factor_secret);
    const isValidCode = await securityService.verifyTotpCode(disableTotpSecret, body.code, user.id);
    if (!isValidCode) {
      return c.json({
        success: false,
        error: { code: '2FA_INVALID_CODE', message: texte(c, '2FA_INVALID_CODE') },
        requestId,
      }, 400);
    }

    // Disable 2FA
    await c.env.DB
      .prepare('UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL, updated_at = datetime("now") WHERE id = ?')
      .bind(payload.sub)
      .run();

    // Delete backup codes
    await c.env.DB
      .prepare('DELETE FROM two_factor_backup_codes WHERE user_id = ?')
      .bind(payload.sub)
      .run();

    await securityService.logAuditEvent({
      userId: payload.sub,
      action: '2FA_DISABLED',
      entityType: 'user',
      entityId: payload.sub,
      ipAddress,
      riskLevel: 'critical',
      success: true,
    });

    return c.json({
      success: true,
      data: { message: '2FA désactivé avec succès' },
      requestId,
    });
  } catch (error) {
    console.error('2FA disable error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: texte(c, 'INTERNAL_ERROR') },
      requestId,
    }, 500);
  }
});

// GET /auth/sessions - Get active sessions
auth.get('/sessions', async (c) => {
  const requestId = crypto.randomUUID();

  const authService = new AuthService(c.env.JWT_SECRET);

  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: texte(c, 'AUTH_REQUIRED') },
        requestId,
      }, 401);
    }

    const payload = await authService.verifyToken(authHeader.substring(7));
    if (!payload) {
      return c.json({
        success: false,
        error: { code: 'AUTH_INVALID_TOKEN', message: texte(c, 'AUTH_INVALID_TOKEN') },
        requestId,
      }, 401);
    }

    const sessions = await c.env.DB
      .prepare(`
        SELECT id, ip_address, user_agent, device_type, location, last_activity_at, created_at
        FROM active_sessions
        WHERE user_id = ? AND expires_at > datetime('now')
        ORDER BY last_activity_at DESC
      `)
      .bind(payload.sub)
      .all<any>();

    // Prefer the stable session id from the token (`sid`); fall back to the
    // legacy IP heuristic only for older tokens that predate the sid claim.
    const currentIp = getClientIp(c);
    let foundCurrent = false;

    return c.json({
      success: true,
      data: {
        sessions: sessions.results?.map(s => {
          const isCurrent = payload.sid
            ? s.id === payload.sid
            : (!foundCurrent && s.ip_address === currentIp);
          if (isCurrent) foundCurrent = true;
          return {
            id: s.id,
            ipAddress: s.ip_address,
            userAgent: s.user_agent,
            deviceType: s.device_type,
            location: s.location,
            lastUsed: s.last_activity_at,
            createdAt: s.created_at,
            isCurrent,
          };
        }) || [],
      } satisfies SessionsData,
      requestId,
    });
  } catch (error) {
    console.error('Get sessions error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: texte(c, 'INTERNAL_ERROR') },
      requestId,
    }, 500);
  }
});

// DELETE /auth/sessions/:id - Revoke a specific session
auth.delete('/sessions/:id', async (c) => {
  const { id } = c.req.param();
  const requestId = crypto.randomUUID();
  const ipAddress = getClientIp(c);

  const authService = new AuthService(c.env.JWT_SECRET);
  const securityService = new SecurityService(c.env.DB, c.env.CACHE);

  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: texte(c, 'AUTH_REQUIRED') },
        requestId,
      }, 401);
    }

    const payload = await authService.verifyToken(authHeader.substring(7));
    if (!payload) {
      return c.json({
        success: false,
        error: { code: 'AUTH_INVALID_TOKEN', message: texte(c, 'AUTH_INVALID_TOKEN') },
        requestId,
      }, 401);
    }

    // Delete session (only if it belongs to the user)
    await c.env.DB
      .prepare('DELETE FROM active_sessions WHERE id = ? AND user_id = ?')
      .bind(id, payload.sub)
      .run();

    await securityService.logAuditEvent({
      userId: payload.sub,
      action: 'SESSION_REVOKED',
      entityType: 'session',
      entityId: id,
      ipAddress,
      riskLevel: 'medium',
      success: true,
    });

    return c.json({
      success: true,
      data: { message: 'Session révoquée' },
      requestId,
    });
  } catch (error) {
    console.error('Revoke session error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: texte(c, 'INTERNAL_ERROR') },
      requestId,
    }, 500);
  }
});

// DELETE /auth/sessions - Revoke all sessions (except current)
auth.delete('/sessions', async (c) => {
  const requestId = crypto.randomUUID();
  const ipAddress = getClientIp(c);

  const authService = new AuthService(c.env.JWT_SECRET);
  const securityService = new SecurityService(c.env.DB, c.env.CACHE);

  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: texte(c, 'AUTH_REQUIRED') },
        requestId,
      }, 401);
    }

    const payload = await authService.verifyToken(authHeader.substring(7));
    if (!payload) {
      return c.json({
        success: false,
        error: { code: 'AUTH_INVALID_TOKEN', message: texte(c, 'AUTH_INVALID_TOKEN') },
        requestId,
      }, 401);
    }

    // Revoke all sessions EXCEPT the current one (identified by the token's sid).
    // Older tokens without a sid fall back to revoking everything.
    const result = payload.sid
      ? await c.env.DB
          .prepare('DELETE FROM active_sessions WHERE user_id = ? AND id != ?')
          .bind(payload.sub, payload.sid)
          .run()
      : await c.env.DB
          .prepare('DELETE FROM active_sessions WHERE user_id = ?')
          .bind(payload.sub)
          .run();

    await securityService.logAuditEvent({
      userId: payload.sub,
      action: 'ALL_SESSIONS_REVOKED',
      entityType: 'session',
      ipAddress,
      riskLevel: 'high',
      success: true,
    });

    return c.json({
      success: true,
      data: { message: 'Toutes les sessions ont été révoquées' },
      requestId,
    });
  } catch (error) {
    console.error('Revoke all sessions error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: texte(c, 'INTERNAL_ERROR') },
      requestId,
    }, 500);
  }
});

// POST /auth/resend-code - Resend verification code
const resendCodeSchema = z.object({
  type: z.enum(['email', 'phone']),
  identifier: z.string().min(1), // email or phone
});

auth.post('/resend-code', zValidator('json', resendCodeSchema, surErreurDeValidation), async (c) => {
  const body = c.req.valid('json');
  const requestId = crypto.randomUUID();
  const ipAddress = getClientIp(c);

  const configService = new ConfigService(c.env.DB, c.env.CACHE);
  const authService = new AuthService(c.env.JWT_SECRET, configService);
  const userService = new UserService(c.env.DB);
  const securityService = new SecurityService(c.env.DB, c.env.CACHE, configService);

  try {
    // Rate limit resend attempts (configurable)
    const [resendRateMax, resendRateWindow, verificationCodeTtl] = await Promise.all([
      configService.getNumber('rate_limit_resend_code_max', 3),
      configService.getNumber('rate_limit_resend_code_window', 300),
      configService.getNumber('verification_code_ttl', 900),
    ]);

    const rateLimit = await securityService.checkRateLimit(
      ipAddress,
      `resend_${body.type}`,
      resendRateMax,
      resendRateWindow
    );

    if (!rateLimit.allowed) {
      return c.json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: texte(c, 'RATE_LIMIT_EXCEEDED'),
        },
        requestId,
      }, 429);
    }

    // Find user
    const user = body.type === 'email'
      ? await userService.findByEmail(body.identifier.toLowerCase())
      : await userService.findByPhone(body.identifier);

    if (!user) {
      // Don't reveal if user exists
      return c.json({
        success: true,
        data: { message: 'Si ce compte existe, un code de vérification a été envoyé.' },
        requestId,
      });
    }

    // Generate new verification code
    const verificationCode = authService.generateVerificationCode();

    // Store in cache
    const cacheKey = body.type === 'email'
      ? `verify:email:${body.identifier.toLowerCase()}`
      : `verify:phone:${body.identifier}`;

    // SECURITY: Hash verification code before storing in KV
    const hashedResendCode = await hashVerificationCode(verificationCode);
    await c.env.CACHE.put(
      cacheKey,
      JSON.stringify({
        code: hashedResendCode,
        userId: user.id,
        attempts: 0,
        createdAt: Date.now(),
      }),
      { expirationTtl: verificationCodeTtl }
    );

    // Send notification
    const notificationService = new NotificationService(c.env.DB, {
      resendApiKey: c.env.RESEND_API_KEY,
      sendgridApiKey: c.env.SENDGRID_API_KEY,
      twilioAccountSid: c.env.TWILIO_ACCOUNT_SID,
      twilioAuthToken: c.env.TWILIO_AUTH_TOKEN,
      twilioPhoneNumber: c.env.TWILIO_PHONE_NUMBER,
    });

    if (body.type === 'email') {
      notificationService.sendVerificationCode(user.email, verificationCode, 'email').catch(err => {
        console.error('Failed to send verification email:', err);
      });
    } else {
      notificationService.sendVerificationCodeSms(user.phone, verificationCode).catch(err => {
        console.error('Failed to send verification SMS:', err);
      });
    }

    return c.json({
      success: true,
      data: { message: 'Code de vérification envoyé.' },
      requestId,
    });
  } catch (error) {
    console.error('Resend code error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId,
    }, 500);
  }
});

// POST /auth/2fa/setup-init - Initialize 2FA setup with setup token (no auth required)
auth.post('/2fa/setup-init', async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const body = await c.req.json();
    const { setupToken } = body;

    if (!setupToken) {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: texte(c, 'INVALID_INPUT'),
        },
        requestId,
      }, 400);
    }

    // Verify setup token
    const setupDataStr = await c.env.CACHE.get(`user_2fa_setup:${setupToken}`);
    if (!setupDataStr) {
      return c.json({
        success: false,
        error: {
          code: 'SETUP_TOKEN_EXPIRED',
          message: texte(c, 'SETUP_TOKEN_EXPIRED'),
        },
        requestId,
      }, 400);
    }

    const setupData = JSON.parse(setupDataStr);

    // Generate TOTP secret
    const configService = new ConfigService(c.env.DB, c.env.CACHE);
    const securityService = new SecurityService(c.env.DB, c.env.CACHE, configService);
    const secret = securityService.generateTotpSecret();
    const uri = await securityService.generateTotpUri(secret, setupData.email);

    // Store pending 2FA setup
    await c.env.CACHE.put(
      `user_2fa_pending:${setupToken}`,
      JSON.stringify({ secret, userId: setupData.userId, email: setupData.email }),
      { expirationTtl: 600 }
    );

    return c.json({
      success: true,
      data: {
        secret,
        uri,
        issuer: 'TNC Trading',
        message: 'Scannez le QR code avec votre application d\'authentification',
      },
      requestId,
    });
  } catch (error) {
    console.error('2FA setup-init error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId,
    }, 500);
  }
});

// POST /auth/2fa/setup-complete - Complete 2FA setup and login
auth.post('/2fa/setup-complete', async (c) => {
  const requestId = crypto.randomUUID();
  const ipAddress = getClientIp(c);
  const userAgent = getUserAgent(c);

  try {
    const body = await c.req.json();
    const { setupToken, code } = body;

    if (!setupToken || !code) {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: texte(c, 'INVALID_INPUT'),
        },
        requestId,
      }, 400);
    }

    // Get pending setup data
    const pendingDataStr = await c.env.CACHE.get(`user_2fa_pending:${setupToken}`);
    if (!pendingDataStr) {
      return c.json({
        success: false,
        error: {
          code: 'SETUP_EXPIRED',
          message: texte(c, 'SETUP_EXPIRED'),
        },
        requestId,
      }, 400);
    }

    const pendingData = JSON.parse(pendingDataStr);

    // Verify TOTP code
    const configService = new ConfigService(c.env.DB, c.env.CACHE);
    const securityService = new SecurityService(c.env.DB, c.env.CACHE, configService);
    const isValidCode = await securityService.verifyTotpCode(pendingData.secret, code, pendingData.userId);

    if (!isValidCode) {
      return c.json({
        success: false,
        error: {
          code: '2FA_INVALID_CODE',
          message: texte(c, '2FA_INVALID_CODE'),
        },
        requestId,
      }, 400);
    }

    // Save 2FA secret to user (encrypted at rest)
    const encryptedUserSecret = await encryptTotpSecret(c.env.ENCRYPTION_KEY, pendingData.secret);
    await c.env.DB
      .prepare('UPDATE users SET two_factor_secret = ?, two_factor_enabled = 1, updated_at = datetime("now") WHERE id = ?')
      .bind(encryptedUserSecret, pendingData.userId)
      .run();

    // Clear setup tokens
    await c.env.CACHE.delete(`user_2fa_setup:${setupToken}`);
    await c.env.CACHE.delete(`user_2fa_pending:${setupToken}`);

    // Get user data
    const user = await c.env.DB
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(pendingData.userId)
      .first<any>();

    if (!user) {
      return c.json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: texte(c, 'USER_NOT_FOUND'),
        },
        requestId,
      }, 404);
    }

    // Generate login tokens
    const authService = new AuthService(c.env.JWT_SECRET, configService);
    // Mint the session id first so it can be embedded as the token's `sid`.
    const sessionId = crypto.randomUUID();
    const tokens = await authService.generateTokens({
      sub: user.id,
      email: user.email,
      kycLevel: user.kyc_level,
      sid: sessionId,
    });

    // Create session record
    const sessionTokenHash = await authService.hashPassword(tokens.accessToken.slice(-32));
    const secCfg = await securityService.getSecurityConfig();

    await c.env.DB
      .prepare(`
        INSERT INTO active_sessions (id, user_id, session_token_hash, ip_address, user_agent, device_type, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' hours'), datetime('now'))
      `)
      .bind(sessionId, user.id, sessionTokenHash, ipAddress, userAgent, 'web', secCfg.absoluteSessionTimeoutHours)
      .run();

    // Log successful login
    await securityService.logAuditEvent({
      userId: user.id,
      action: 'USER_2FA_SETUP_COMPLETED',
      entityType: 'user',
      entityId: user.id,
      ipAddress,
      userAgent,
      riskLevel: 'high',
      success: true,
    });

    return c.json({
      success: true,
      data: {
        message: '2FA activé avec succès',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          country: user.country,
          kycLevel: user.kyc_level,
          kycStatus: user.kyc_status,
          emailVerified: Boolean(user.email_verified),
          phoneVerified: Boolean(user.phone_verified),
          twoFactorEnabled: true,
        },
        sessionId,
      } satisfies TwoFactorSetupCompleteData,
      requestId,
    });
  } catch (error) {
    console.error('2FA setup-complete error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId,
    }, 500);
  }
});

// ==========================================
// PASSWORDLESS AUTHENTICATION
// ==========================================

const passwordlessRequestSchema = z.object({
  identifier: z.string().min(1, 'Email ou téléphone requis'),
  method: z.enum(['email', 'sms']).default('email'),
});

const passwordlessVerifySchema = z.object({
  identifier: z.string().min(1, 'Identifiant requis'),
  code: z.string().length(6, 'Code doit être 6 chiffres'),
  totpCode: z.string().length(6).optional(),
});

// POST /auth/passwordless/request - Request a one-time code
auth.post('/passwordless/request', zValidator('json', passwordlessRequestSchema, surErreurDeValidation), async (c) => {
  const body = c.req.valid('json');
  const requestId = crypto.randomUUID();
  const ipAddress = getClientIp(c);

  const userService = new UserService(c.env.DB);
  const securityService = new SecurityService(c.env.DB, c.env.CACHE);
  const notificationService = new NotificationService(c.env.DB, {
    resendApiKey: c.env.RESEND_API_KEY,
    sendgridApiKey: c.env.SENDGRID_API_KEY,
    twilioAccountSid: c.env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: c.env.TWILIO_AUTH_TOKEN,
    twilioPhoneNumber: c.env.TWILIO_PHONE_NUMBER,
  });
  const configService = new ConfigService(c.env.DB, c.env.CACHE);

  try {
    const identifier = body.identifier.toLowerCase().trim();
    const isEmail = identifier.includes('@');
    const isPhone = /^\+?[0-9]{10,15}$/.test(identifier.replace(/\s/g, ''));

    // Determine contact method
    let method = body.method;
    if (isEmail && method === 'sms') {
      method = 'email'; // Can't send SMS to email
    }
    if (isPhone && !isEmail && method === 'email') {
      method = 'sms'; // Can't send email to phone
    }

    // Find user by email or phone
    let user;
    if (isEmail) {
      user = await userService.findByEmail(identifier);
    } else if (isPhone) {
      user = await userService.findByPhone(identifier.replace(/\s/g, ''));
    }

    // Always return success to prevent user enumeration
    if (!user) {
      // Still wait a bit to prevent timing attacks
      await new Promise(resolve => setTimeout(resolve, 500));
      return c.json({
        success: true,
        data: {
          message: 'Si un compte existe, un code a été envoyé',
          method: method,
          expiresIn: 300,
        },
        requestId,
      });
    }

    // Check rate limiting
    const rateLimitKey = `passwordless:${identifier}`;
    const recentAttempts = await c.env.CACHE.get(rateLimitKey);
    if (recentAttempts) {
      const attempts = parseInt(recentAttempts);
      if (attempts >= 3) {
        return c.json({
          success: false,
          error: {
            code: 'AUTH_RATE_LIMITED',
            message: texte(c, 'AUTH_RATE_LIMITED'),
          },
          requestId,
        }, 429);
      }
      await c.env.CACHE.put(rateLimitKey, String(attempts + 1), { expirationTtl: 300 });
    } else {
      await c.env.CACHE.put(rateLimitKey, '1', { expirationTtl: 300 });
    }

    // SECURITY: Generate 6-digit OTP code using cryptographically secure random
    const randomBytes = new Uint32Array(1);
    crypto.getRandomValues(randomBytes);
    const code = String(100000 + (randomBytes[0] % 900000)).padStart(6, '0');

    // SECURITY: Hash code before storing in KV cache
    const hashedCode = await hashVerificationCode(code);
    const codeData = {
      code: hashedCode,
      userId: user.id,
      method,
      attempts: 0,
      createdAt: Date.now(),
    };
    await c.env.CACHE.put(
      `passwordless:code:${identifier}`,
      JSON.stringify(codeData),
      { expirationTtl: 300 }
    );

    // Send code via email or SMS
    if (method === 'email' && user.email) {
      await notificationService.sendEmail({
        to: user.email,
        subject: 'Votre code de connexion TNC Trading',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #D4AF37;">Code de connexion</h2>
            <p>Bonjour,</p>
            <p>Votre code de connexion à usage unique est :</p>
            <div style="background: #f5f5f5; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 20px 0;">
              ${code}
            </div>
            <p>Ce code expire dans 5 minutes.</p>
            <p style="color: #666; font-size: 12px;">Si vous n'avez pas demandé ce code, ignorez cet email.</p>
          </div>
        `,
        text: `Votre code de connexion TNC Trading: ${code}. Ce code expire dans 5 minutes.`,
      });
    } else if (method === 'sms' && user.phone) {
      await notificationService.sendSms({
        to: user.phone,
        message: `TNC Trading: Votre code de connexion est ${code}. Valide 5 minutes.`,
      });
    }

    // Log the attempt
    await securityService.logAuditEvent({
      userId: user.id,
      action: 'PASSWORDLESS_CODE_REQUESTED',
      entityType: 'user',
      entityId: user.id,
      ipAddress,
      riskLevel: 'medium',
      success: true,
    });

    return c.json({
      success: true,
      data: {
        message: 'Code envoyé avec succès',
        method,
        expiresIn: 300,
      },
      requestId,
    });
  } catch (error) {
    console.error('Passwordless request error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId,
    }, 500);
  }
});

// POST /auth/passwordless/verify - Verify code and login
auth.post('/passwordless/verify', zValidator('json', passwordlessVerifySchema, surErreurDeValidation), async (c) => {
  const body = c.req.valid('json');
  const requestId = crypto.randomUUID();
  const ipAddress = getClientIp(c);
  const userAgent = getUserAgent(c);

  const userService = new UserService(c.env.DB);
  const securityService = new SecurityService(c.env.DB, c.env.CACHE);
  const configService = new ConfigService(c.env.DB, c.env.CACHE);
  const authService = new AuthService(c.env.JWT_SECRET, configService);

  try {
    const identifier = body.identifier.toLowerCase().trim();

    // Get stored code
    const storedDataStr = await c.env.CACHE.get(`passwordless:code:${identifier}`);
    if (!storedDataStr) {
      return c.json({
        success: false,
        error: {
          code: 'AUTH_INVALID_CODE',
          message: texte(c, 'AUTH_INVALID_CODE'),
        },
        requestId,
      }, 400);
    }

    const storedData = JSON.parse(storedDataStr);

    // Check max attempts
    if (storedData.attempts >= 5) {
      await c.env.CACHE.delete(`passwordless:code:${identifier}`);
      return c.json({
        success: false,
        error: {
          code: 'AUTH_TOO_MANY_ATTEMPTS',
          message: texte(c, 'AUTH_TOO_MANY_ATTEMPTS'),
        },
        requestId,
      }, 400);
    }

    // SECURITY: Hash user input and use constant-time comparison
    const hashedInputCode = await hashVerificationCode(body.code);
    if (!constantTimeEqual(storedData.code, hashedInputCode)) {
      storedData.attempts++;
      await c.env.CACHE.put(
        `passwordless:code:${identifier}`,
        JSON.stringify(storedData),
        { expirationTtl: 300 }
      );
      return c.json({
        success: false,
        error: {
          code: 'AUTH_INVALID_CODE',
          message: texte(c, 'AUTH_INVALID_CODE'),
          attemptsRemaining: 5 - storedData.attempts,
        },
        requestId,
      }, 400);
    }

    // Get user
    const user = await c.env.DB
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(storedData.userId)
      .first<any>();

    if (!user) {
      return c.json({
        success: false,
        error: {
          code: 'AUTH_USER_NOT_FOUND',
          message: texte(c, 'AUTH_USER_NOT_FOUND'),
        },
        requestId,
      }, 404);
    }

    // Check if user is suspended
    if (user.suspended) {
      return c.json({
        success: false,
        error: {
          code: 'AUTH_ACCOUNT_SUSPENDED',
          message: texte(c, 'AUTH_ACCOUNT_SUSPENDED'),
        },
        requestId,
      }, 403);
    }

    // Check 2FA if enabled (still required even for passwordless)
    if (user.two_factor_secret && user.two_factor_enabled) {
      if (!body.totpCode) {
        return c.json({
          success: false,
          error: {
            code: 'AUTH_2FA_REQUIRED',
            message: texte(c, 'AUTH_2FA_REQUIRED'),
          },
          requestId,
        }, 403);
      }

      const txTotpSecret = await decryptTotpSecret(c.env.ENCRYPTION_KEY, user.two_factor_secret);
      const isValid2FA = await securityService.verifyTotpCode(txTotpSecret, body.totpCode, user.id);
      if (!isValid2FA) {
        return c.json({
          success: false,
          error: {
            code: 'AUTH_2FA_INVALID',
            message: texte(c, 'AUTH_2FA_INVALID'),
          },
          requestId,
        }, 400);
      }
    }

    // Delete used code
    await c.env.CACHE.delete(`passwordless:code:${identifier}`);

    // Mint the session id first so it can be embedded as the token's `sid`.
    const sessionId = crypto.randomUUID();
    // Generate tokens
    const tokens = await authService.generateTokens({
      sub: user.id,
      email: user.email,
      kycLevel: user.kyc_level,
      sid: sessionId,
    });

    // Store refresh token
    const refreshTokenHash = await authService.hashPassword(tokens.refreshToken);
    const refreshTokenExpiry = await configService.getNumber('refresh_token_expiry_days', 30);
    await c.env.DB
      .prepare(`INSERT INTO sessions (id, user_id, refresh_token_hash, ip_address, user_agent, expires_at, created_at)
                VALUES (?, ?, ?, ?, ?, datetime('now', '+' || ? || ' days'), datetime('now'))`)
      .bind(crypto.randomUUID(), user.id, refreshTokenHash, ipAddress, userAgent, refreshTokenExpiry)
      .run();

    // Create session
    const sessionTokenHash = await authService.hashPassword(tokens.accessToken.slice(-32));
    const secCfg = await securityService.getSecurityConfig();

    await c.env.DB
      .prepare(`INSERT INTO active_sessions (id, user_id, session_token_hash, ip_address, user_agent, device_type, expires_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' hours'), datetime('now'))`)
      .bind(sessionId, user.id, sessionTokenHash, ipAddress, userAgent, 'web', secCfg.absoluteSessionTimeoutHours)
      .run();

    // Update last login
    await c.env.DB
      .prepare('UPDATE users SET last_login_at = datetime(\'now\'), failed_login_attempts = 0 WHERE id = ?')
      .bind(user.id)
      .run();

    // Log successful login
    await securityService.logAuditEvent({
      userId: user.id,
      action: 'USER_PASSWORDLESS_LOGIN',
      entityType: 'user',
      entityId: user.id,
      ipAddress,
      userAgent,
      riskLevel: 'medium',
      success: true,
    });

    return c.json({
      success: true,
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          country: user.country,
          kycLevel: user.kyc_level,
          kycStatus: user.kyc_status,
          emailVerified: Boolean(user.email_verified),
          phoneVerified: Boolean(user.phone_verified),
          twoFactorEnabled: Boolean(user.two_factor_enabled),
        },
        sessionId,
      } satisfies LoginData,
      requestId,
    });
  } catch (error) {
    console.error('Passwordless verify error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId,
    }, 500);
  }
});

export const authRoutes = auth;
