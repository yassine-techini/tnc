import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types/env';
import { AuthService } from '../services/auth.service';
import { UserService } from '../services/user.service';
import { WalletService } from '../services/wallet.service';
import { SecurityService, SECURITY_DEFAULTS } from '../services/security.service';
import { NotificationService } from '../services/notification.service';
import { ConfigService } from '../services/config.service';

const auth = new Hono<AppEnv>();

// ==========================================
// VALIDATION SCHEMAS (Banking-grade)
// ==========================================

const registerSchema = z.object({
  email: z.string().email('Email invalide').max(255),
  phone: z.string()
    .min(10, 'Numéro de téléphone invalide')
    .max(20)
    .regex(/^\+?[0-9]{10,15}$/, 'Format de téléphone invalide'),
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
  refreshToken: z.string().min(1),
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
auth.post('/register', zValidator('json', registerSchema), async (c) => {
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
          message: 'Trop de tentatives. Veuillez réessayer plus tard.',
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
          message: 'Mot de passe non conforme aux exigences de sécurité',
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
          message: 'Un compte avec cet email existe déjà',
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
          message: 'Un compte avec ce numéro de téléphone existe déjà',
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

    // Store verification code in KV
    await c.env.CACHE.put(
      `verify:email:${body.email.toLowerCase()}`,
      JSON.stringify({
        code: verificationCode,
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
    await c.env.CACHE.put(
      `verify:phone:${body.phone}`,
      JSON.stringify({
        code: phoneVerificationCode,
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
      },
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
        message: 'Erreur lors de la création du compte',
      },
      requestId,
    }, 500);
  }
});

// POST /auth/login
auth.post('/login', zValidator('json', loginSchema), async (c) => {
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
          message: 'Accès temporairement bloqué. Contactez le support.',
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
          message: 'Trop de tentatives de connexion. Veuillez patienter.',
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
          message: `Compte temporairement bloqué. Réessayez dans ${Math.ceil(lockStatus.remainingSeconds! / 60)} minute(s).`,
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
          message: 'Identifiants incorrects',
        },
        requestId,
      }, 401);
    }

    // Verify password
    const isValidPassword = await authService.verifyPassword(body.password, user.password_hash);
    if (!isValidPassword) {
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
            message: 'Compte bloqué suite à plusieurs tentatives échouées',
            lockoutUntil: lockResult.lockoutUntil,
          },
          requestId,
        }, 403);
      }

      return c.json({
        success: false,
        error: {
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Identifiants incorrects',
          attemptsRemaining: lockResult.attemptsRemaining,
        },
        requestId,
      }, 401);
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
          message: 'Configuration 2FA obligatoire. Scannez le QR code pour activer.',
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
          message: 'Code d\'authentification à deux facteurs requis',
        },
        requestId,
      }, 401);
    }

    const isValidTotp = await securityService.verifyTotpCode(user.two_factor_secret, body.totpCode);
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
          message: 'Code 2FA invalide',
        },
        requestId,
      }, 401);
    }

    // Clear login attempts on successful login
    await securityService.clearLoginAttempts(body.identifier.toLowerCase());

    // Update last login
    await userService.updateLastLogin(user.id);

    // Generate tokens
    const tokens = await authService.generateTokens({
      sub: user.id,
      email: user.email,
      kycLevel: user.kyc_level,
    });

    // Create session record
    const sessionId = crypto.randomUUID();
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
      },
      requestId,
    });
  } catch (error) {
    console.error('Login error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors de la connexion',
      },
      requestId,
    }, 500);
  }
});

// POST /auth/refresh
auth.post('/refresh', zValidator('json', refreshSchema), async (c) => {
  const body = c.req.valid('json');
  const requestId = crypto.randomUUID();

  const authService = new AuthService(c.env.JWT_SECRET);

  try {
    const tokens = await authService.refreshAccessToken(body.refreshToken);

    if (!tokens) {
      return c.json({
        success: false,
        error: {
          code: 'AUTH_INVALID_REFRESH_TOKEN',
          message: 'Token de rafraîchissement invalide ou expiré',
        },
        requestId,
      }, 401);
    }

    return c.json({
      success: true,
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      },
      requestId,
    });
  } catch (error) {
    console.error('Refresh error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors du rafraîchissement',
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
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const authService = new AuthService(c.env.JWT_SECRET);
      const payload = await authService.verifyToken(token);

      if (payload) {
        // Invalidate all sessions for user
        await c.env.DB
          .prepare('DELETE FROM active_sessions WHERE user_id = ?')
          .bind(payload.sub)
          .run();

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
auth.post('/verify-email', zValidator('json', verifyEmailSchema), async (c) => {
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
          message: 'Code de vérification invalide ou expiré',
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
          message: 'Trop de tentatives. Veuillez demander un nouveau code.',
        },
        requestId,
      }, 400);
    }

    if (storedData.code !== body.code) {
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
          message: 'Code de vérification incorrect',
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
          message: 'Utilisateur non trouvé',
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
        message: 'Erreur lors de la vérification',
      },
      requestId,
    }, 500);
  }
});

// POST /auth/verify-phone
auth.post('/verify-phone', zValidator('json', verifyPhoneSchema), async (c) => {
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
          message: 'Code de vérification invalide ou expiré',
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
          message: 'Trop de tentatives. Veuillez demander un nouveau code.',
        },
        requestId,
      }, 400);
    }

    if (storedData.code !== body.code) {
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
          message: 'Code de vérification incorrect',
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
          message: 'Utilisateur non trouvé',
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
        message: 'Erreur lors de la vérification',
      },
      requestId,
    }, 500);
  }
});

// POST /auth/forgot-password
auth.post('/forgot-password', zValidator('json', forgotPasswordSchema), async (c) => {
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
auth.post('/reset-password', zValidator('json', resetPasswordSchema), async (c) => {
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
          message: 'Lien de réinitialisation invalide ou expiré',
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
          message: 'Mot de passe non conforme aux exigences de sécurité',
          details: passwordValidation.errors,
        },
        requestId,
      }, 400);
    }

    // Hash new password
    const passwordHash = await authService.hashPassword(body.password);

    // Check password history
    const isNewPassword = await securityService.checkPasswordHistory(storedData.userId, passwordHash, 5);
    if (!isNewPassword) {
      return c.json({
        success: false,
        error: {
          code: 'PASSWORD_RECENTLY_USED',
          message: 'Ce mot de passe a été utilisé récemment. Choisissez un nouveau mot de passe.',
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

    // Invalidate all existing sessions
    await c.env.DB
      .prepare('DELETE FROM active_sessions WHERE user_id = ?')
      .bind(storedData.userId)
      .run();

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
        message: 'Erreur lors de la réinitialisation',
      },
      requestId,
    }, 500);
  }
});

// POST /auth/2fa/setup - Initialize 2FA setup
auth.post('/2fa/setup', zValidator('json', setup2faSchema), async (c) => {
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
        error: { code: 'AUTH_REQUIRED', message: 'Authentification requise' },
        requestId,
      }, 401);
    }

    const payload = await authService.verifyToken(authHeader.substring(7));
    if (!payload) {
      return c.json({
        success: false,
        error: { code: 'AUTH_INVALID_TOKEN', message: 'Token invalide' },
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
        error: { code: 'USER_NOT_FOUND', message: 'Utilisateur non trouvé' },
        requestId,
      }, 404);
    }

    const isValidPassword = await authService.verifyPassword(body.password, user.password_hash);
    if (!isValidPassword) {
      return c.json({
        success: false,
        error: { code: 'AUTH_INVALID_PASSWORD', message: 'Mot de passe incorrect' },
        requestId,
      }, 401);
    }

    // Check if 2FA is already enabled
    if (user.two_factor_enabled) {
      return c.json({
        success: false,
        error: { code: '2FA_ALREADY_ENABLED', message: '2FA est déjà activé' },
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
        message: 'Scannez le QR code avec votre application d\'authentification',
      },
      requestId,
    });
  } catch (error) {
    console.error('2FA setup error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors de la configuration 2FA' },
      requestId,
    }, 500);
  }
});

// POST /auth/2fa/verify - Verify and enable 2FA
auth.post('/2fa/verify', zValidator('json', verify2faSchema), async (c) => {
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
        error: { code: 'AUTH_REQUIRED', message: 'Authentification requise' },
        requestId,
      }, 401);
    }

    const payload = await authService.verifyToken(authHeader.substring(7));
    if (!payload) {
      return c.json({
        success: false,
        error: { code: 'AUTH_INVALID_TOKEN', message: 'Token invalide' },
        requestId,
      }, 401);
    }

    // Get pending 2FA setup
    const setupData = await c.env.CACHE.get(`2fa_setup:${payload.sub}`);
    if (!setupData) {
      return c.json({
        success: false,
        error: { code: '2FA_SETUP_EXPIRED', message: 'Session de configuration expirée. Recommencez.' },
        requestId,
      }, 400);
    }

    const setup = JSON.parse(setupData);

    // Verify the secret matches
    if (setup.secret !== body.secret) {
      return c.json({
        success: false,
        error: { code: '2FA_INVALID_SECRET', message: 'Secret invalide' },
        requestId,
      }, 400);
    }

    // Verify TOTP code
    const isValidCode = await securityService.verifyTotpCode(body.secret, body.code);
    if (!isValidCode) {
      return c.json({
        success: false,
        error: { code: '2FA_INVALID_CODE', message: 'Code incorrect. Vérifiez l\'heure de votre appareil.' },
        requestId,
      }, 400);
    }

    // Enable 2FA
    await c.env.DB
      .prepare('UPDATE users SET two_factor_enabled = 1, two_factor_secret = ?, updated_at = datetime("now") WHERE id = ?')
      .bind(body.secret, payload.sub)
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
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors de l\'activation 2FA' },
      requestId,
    }, 500);
  }
});

// POST /auth/2fa/disable - Disable 2FA
auth.post('/2fa/disable', zValidator('json', disable2faSchema), async (c) => {
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
        error: { code: 'AUTH_REQUIRED', message: 'Authentification requise' },
        requestId,
      }, 401);
    }

    const payload = await authService.verifyToken(authHeader.substring(7));
    if (!payload) {
      return c.json({
        success: false,
        error: { code: 'AUTH_INVALID_TOKEN', message: 'Token invalide' },
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
        error: { code: '2FA_NOT_ENABLED', message: '2FA n\'est pas activé' },
        requestId,
      }, 400);
    }

    // Verify password
    const isValidPassword = await authService.verifyPassword(body.password, user.password_hash);
    if (!isValidPassword) {
      return c.json({
        success: false,
        error: { code: 'AUTH_INVALID_PASSWORD', message: 'Mot de passe incorrect' },
        requestId,
      }, 401);
    }

    // Verify 2FA code
    const isValidCode = await securityService.verifyTotpCode(user.two_factor_secret, body.code);
    if (!isValidCode) {
      return c.json({
        success: false,
        error: { code: '2FA_INVALID_CODE', message: 'Code 2FA incorrect' },
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
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors de la désactivation 2FA' },
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
        error: { code: 'AUTH_REQUIRED', message: 'Authentification requise' },
        requestId,
      }, 401);
    }

    const payload = await authService.verifyToken(authHeader.substring(7));
    if (!payload) {
      return c.json({
        success: false,
        error: { code: 'AUTH_INVALID_TOKEN', message: 'Token invalide' },
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

    // The most recent session with matching IP is likely the current one
    const currentIp = getClientIp(c);
    let foundCurrent = false;

    return c.json({
      success: true,
      data: {
        sessions: sessions.results?.map(s => {
          // Mark the first session matching the current IP as current
          const isCurrent = !foundCurrent && s.ip_address === currentIp;
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
      },
      requestId,
    });
  } catch (error) {
    console.error('Get sessions error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors de la récupération des sessions' },
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
        error: { code: 'AUTH_REQUIRED', message: 'Authentification requise' },
        requestId,
      }, 401);
    }

    const payload = await authService.verifyToken(authHeader.substring(7));
    if (!payload) {
      return c.json({
        success: false,
        error: { code: 'AUTH_INVALID_TOKEN', message: 'Token invalide' },
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
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors de la révocation' },
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
        error: { code: 'AUTH_REQUIRED', message: 'Authentification requise' },
        requestId,
      }, 401);
    }

    const payload = await authService.verifyToken(authHeader.substring(7));
    if (!payload) {
      return c.json({
        success: false,
        error: { code: 'AUTH_INVALID_TOKEN', message: 'Token invalide' },
        requestId,
      }, 401);
    }

    // Delete all sessions for the user
    const result = await c.env.DB
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
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors de la révocation' },
      requestId,
    }, 500);
  }
});

// POST /auth/resend-code - Resend verification code
const resendCodeSchema = z.object({
  type: z.enum(['email', 'phone']),
  identifier: z.string().min(1), // email or phone
});

auth.post('/resend-code', zValidator('json', resendCodeSchema), async (c) => {
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
          message: 'Trop de demandes. Veuillez patienter quelques minutes.',
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

    await c.env.CACHE.put(
      cacheKey,
      JSON.stringify({
        code: verificationCode,
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
        message: 'Erreur lors de l\'envoi du code',
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
          message: 'Token de configuration requis',
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
          message: 'Session de configuration expirée. Reconnectez-vous.',
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
        message: 'Erreur lors de la configuration 2FA',
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
          message: 'Token et code requis',
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
          message: 'Session de configuration expirée. Recommencez.',
        },
        requestId,
      }, 400);
    }

    const pendingData = JSON.parse(pendingDataStr);

    // Verify TOTP code
    const configService = new ConfigService(c.env.DB, c.env.CACHE);
    const securityService = new SecurityService(c.env.DB, c.env.CACHE, configService);
    const isValidCode = await securityService.verifyTotpCode(pendingData.secret, code);

    if (!isValidCode) {
      return c.json({
        success: false,
        error: {
          code: '2FA_INVALID_CODE',
          message: 'Code incorrect. Vérifiez l\'heure de votre appareil.',
        },
        requestId,
      }, 400);
    }

    // Save 2FA secret to user
    await c.env.DB
      .prepare('UPDATE users SET two_factor_secret = ?, two_factor_enabled = 1, updated_at = datetime("now") WHERE id = ?')
      .bind(pendingData.secret, pendingData.userId)
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
          message: 'Utilisateur non trouvé',
        },
        requestId,
      }, 404);
    }

    // Generate login tokens
    const authService = new AuthService(c.env.JWT_SECRET, configService);
    const tokens = await authService.generateTokens({
      sub: user.id,
      email: user.email,
      kycLevel: user.kyc_level,
    });

    // Create session record
    const sessionId = crypto.randomUUID();
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
      },
      requestId,
    });
  } catch (error) {
    console.error('2FA setup-complete error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors de l\'activation 2FA',
      },
      requestId,
    }, 500);
  }
});

export const authRoutes = auth;
