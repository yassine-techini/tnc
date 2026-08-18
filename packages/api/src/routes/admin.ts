import { Hono, Context, Next } from 'hono';
import type {
  AdminDashboardData,
  AdminStockData,
  AdminProofOfReserveData,
  AdminPermissionsData,
} from '@tnc-trading/shared/contracts';
import type {
  BulkReconcileData,
  DailyReconciliationData,
  PendingReconciliationData,
  ReconcileActionData,
  ReconciliationReportData,
  BulkKycApproveData,
  StuckTransactionsData,
  SuspendedUsersData,
  WalletDiscrepanciesData,
} from '@tnc-trading/shared/contracts';
import { z } from 'zod';
import type { AppEnv } from '../types/env';
import { AuthService } from '../services/auth.service';
import { PaymentService } from '../services/payment.service';
import { NotificationService } from '../services/notification.service';
import { ReconciliationService } from '../services/reconciliation.service';
import { SecurityService } from '../services/security.service';
import { requirePermission } from '../middleware/rbac';
import { verifierAjustementStock } from '../lib/stock-invariant';
import { chiffresReserve } from '../lib/reserve';
import { resolvePermissions, ROLE_DEFAULTS } from '../lib/rbac';
import { isPortalToken, canAccessAdminPortal } from '../lib/portal';
import { ConfigService } from '../services/config.service';
import { encryptTotpSecret, decryptTotpSecret } from '../lib/totp-secret';
import { analyticsRoutes } from './admin/analytics';
import { ConsignmentService } from '../services/consignment.service';
import { ProducerProfileService } from '../services/producer-profile.service';
import { ReadinessService } from '../services/readiness.service';
import { AttestationService } from '../services/attestation.service';
import { renderPdf, type PdfBlock } from '../lib/pdf';
import { DispositionService } from '../services/disposition.service';
import {
  SettlementStatementService,
  statementFilename,
} from '../services/settlement-statement.service';
import { GOLD_STOCK_ID } from '../services/market.service';
import type { NotificationType } from '../services/notification.service';
import { streamConsignmentPhoto } from './producer';

/**
 * Roles that may be assigned to an admin account. Derived from ROLE_DEFAULTS so
 * a new role cannot be defined in the RBAC map, accepted by the `admins.role`
 * CHECK constraint, and still be unassignable through the API — which is what
 * happened to TRANSITAIRE and DUBAI_VALIDATOR when the consignment workflow
 * shipped against a hardcoded list.
 */
const ASSIGNABLE_ADMIN_ROLES = Object.keys(ROLE_DEFAULTS);

// Zod schemas for admin endpoints
const AdminLoginSchema = z.object({
  email: z.string().email('Email invalide'),
  password: z.string().min(1, 'Mot de passe requis'),
  totpCode: z.string().length(6).optional(),
});

const Admin2FASetupSchema = z.object({
  setupToken: z.string().uuid('Token invalide'),
});

const Admin2FAVerifySchema = z.object({
  setupToken: z.string().uuid('Token invalide'),
  code: z.string().length(6, 'Code doit être 6 chiffres'),
});

// Type for admin record from DB
interface AdminRecord {
  id: string;
  email: string;
  name: string;
  role: string;
  password_hash: string;
  two_factor_secret: string | null;
  two_factor_enabled: number;
  active: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

const admin = new Hono<AppEnv>();

/** Safe pagination parser: ensures page >= 1, 1 <= limit <= maxLimit */
function parsePagination(
  query: { page?: string; limit?: string },
  maxLimit: number = 100,
  defaultLimit: number = 20
): { page: number; limit: number; offset: number } {
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Math.floor(Number(query.limit)) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

// JWT-based auth middleware for admin
async function adminJwtMiddleware(c: Context<AppEnv>, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({
      success: false,
      error: {
        code: 'ADMIN_AUTH_REQUIRED',
        message: 'Authentification admin requise',
      },
      requestId: crypto.randomUUID(),
    }, 401);
  }

  const token = authHeader.substring(7);

  try {
    const authService = new AuthService(c.env.JWT_SECRET);
    const payload = await authService.verifyToken(token);

    if (!payload || payload.type !== 'access') {
      return c.json({
        success: false,
        error: {
          code: 'AUTH_INVALID_TOKEN',
          message: 'Token invalide ou expiré',
        },
        requestId: crypto.randomUUID(),
      }, 401);
    }

    // The token must have been minted by the admin portal. Customer and state
    // tokens are signed with the same secret and carry an email, so without this
    // check any access token whose email matched an active `admins` row granted
    // back-office access — bypassing the mandatory TOTP of the admin login.
    if (!isPortalToken(payload, 'admin')) {
      return c.json({
        success: false,
        error: {
          code: 'ADMIN_ACCESS_DENIED',
          message: 'Accès administrateur non autorisé',
        },
        requestId: crypto.randomUUID(),
      }, 403);
    }

    // Check if this is an admin (by email)
    const adminUser = await c.env.DB
      .prepare('SELECT id, email, name, role, password_hash, two_factor_enabled, two_factor_secret, active, last_login_at, created_at, updated_at FROM admins WHERE email = ? AND active = 1')
      .bind(payload.email)
      .first<AdminRecord>();

    // A government operator has its own read-only portal and must not reach the
    // back-office, where the same view permissions expose individual records.
    if (!adminUser || !canAccessAdminPortal(adminUser.role)) {
      return c.json({
        success: false,
        error: {
          code: 'ADMIN_ACCESS_DENIED',
          message: 'Accès administrateur non autorisé',
        },
        requestId: crypto.randomUUID(),
      }, 403);
    }

    c.set('adminId', adminUser.id);
    c.set('adminEmail', payload.email);
    c.set('adminRole', adminUser.role);

    return next();
  } catch (error) {
    return c.json({
      success: false,
      error: {
        code: 'ADMIN_AUTH_FAILED',
        message: 'Authentification échouée',
      },
      requestId: crypto.randomUUID(),
    }, 401);
  }
}

// POST /admin/login - Admin login with mandatory 2FA
admin.post('/login', async (c) => {
  try {
    const body = await c.req.json();

    // Validate input with Zod
    const parseResult = AdminLoginSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: parseResult.error.issues[0]?.message || 'Données invalides',
          details: parseResult.error.issues,
        },
        requestId: crypto.randomUUID(),
      }, 400);
    }

    const { email, password, totpCode } = parseResult.data;
    const clientIp = c.req.header('CF-Connecting-IP') || 'unknown';

    // Brute-force protection: lockout keyed on the admin identifier (separate
    // namespace from end users). This is the most sensitive login surface.
    const lockConfigService = new ConfigService(c.env.DB, c.env.CACHE);
    const lockSecurityService = new SecurityService(c.env.DB, c.env.CACHE, lockConfigService);
    const lockIdentifier = `admin:${email.toLowerCase()}`;
    const lockStatus = await lockSecurityService.isAccountLocked(lockIdentifier);
    if (lockStatus.locked) {
      return c.json({
        success: false,
        error: {
          code: 'AUTH_ACCOUNT_LOCKED',
          message: `Compte temporairement bloqué. Réessayez dans ${Math.ceil((lockStatus.remainingSeconds || 0) / 60)} minute(s).`,
        },
        requestId: crypto.randomUUID(),
      }, 429);
    }

    // Find admin
    const adminUser = await c.env.DB
      .prepare('SELECT id, email, name, role, password_hash, two_factor_enabled, two_factor_secret, active, last_login_at, created_at, updated_at FROM admins WHERE email = ? AND active = 1')
      .bind(email)
      .first<AdminRecord>();

    if (!adminUser) {
      await lockSecurityService.recordFailedLogin(lockIdentifier, clientIp);
      return c.json({
        success: false,
        error: {
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Email ou mot de passe incorrect',
        },
        requestId: crypto.randomUUID(),
      }, 401);
    }

    // Verify password (with automatic Argon2id upgrade for legacy hashes)
    const authService = new AuthService(c.env.JWT_SECRET);
    const passwordResult = await authService.verifyPasswordWithRehashCheck(password, adminUser.password_hash);

    if (!passwordResult.valid) {
      await lockSecurityService.recordFailedLogin(lockIdentifier, clientIp);
      return c.json({
        success: false,
        error: {
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Email ou mot de passe incorrect',
        },
        requestId: crypto.randomUUID(),
      }, 401);
    }

    // Upgrade legacy PBKDF2 hash to Argon2id (transparent migration)
    if (passwordResult.needsRehash) {
      const newHash = await authService.hashPassword(password);
      await c.env.DB.prepare('UPDATE admins SET password_hash = ?, updated_at = datetime("now") WHERE id = ?')
        .bind(newHash, adminUser.id)
        .run();
    }

    // Check if 2FA is set up (mandatory for admins)
    if (!adminUser.two_factor_secret) {
      // 2FA not set up - generate setup token and require setup
      const setupToken = crypto.randomUUID();
      await c.env.CACHE.put(
        `admin_2fa_setup:${setupToken}`,
        JSON.stringify({ adminId: adminUser.id, email: adminUser.email }),
        { expirationTtl: 600 } // 10 minutes
      );

      return c.json({
        success: false,
        error: {
          code: '2FA_SETUP_REQUIRED',
          message: 'Configuration 2FA obligatoire. Scannez le QR code pour activer.',
        },
        data: {
          setupToken,
          adminId: adminUser.id,
        },
        requestId: crypto.randomUUID(),
      }, 403);
    }

    // 2FA is set up - verify code
    if (!totpCode) {
      return c.json({
        success: false,
        error: {
          code: '2FA_REQUIRED',
          message: 'Code d\'authentification à deux facteurs requis',
        },
        requestId: crypto.randomUUID(),
      }, 401);
    }

    // Verify TOTP code
    const configService = new ConfigService(c.env.DB, c.env.CACHE);
    const securityService = new SecurityService(c.env.DB, c.env.CACHE, configService);
    const adminTotpSecret = await decryptTotpSecret(c.env.ENCRYPTION_KEY, adminUser.two_factor_secret);
    const isValidTotp = await securityService.verifyTotpCode(adminTotpSecret, totpCode, adminUser.id);

    if (!isValidTotp) {
      await lockSecurityService.recordFailedLogin(lockIdentifier, clientIp);
      return c.json({
        success: false,
        error: {
          code: '2FA_INVALID',
          message: 'Code 2FA invalide',
        },
        requestId: crypto.randomUUID(),
      }, 401);
    }

    // Successful login — clear failed-attempt counter
    await lockSecurityService.clearLoginAttempts(lockIdentifier);

    // Update last login
    await c.env.DB
      .prepare('UPDATE admins SET last_login_at = datetime(\'now\') WHERE id = ?')
      .bind(adminUser.id)
      .run();

    // Generate tokens
    const tokens = await authService.generateTokens({
      sub: adminUser.id,
      email: adminUser.email,
      kycLevel: 'VERIFIED', // Admins are always verified
      portal: 'admin',
    });

    // Resolve effective permissions (role defaults + overrides)
    const permissions = await resolvePermissions(c.env.DB, adminUser.id, adminUser.role);

    return c.json({
      success: true,
      data: {
        user: {
          id: adminUser.id,
          email: adminUser.email,
          name: adminUser.name,
          role: adminUser.role,
          permissions,
          twoFactorEnabled: true,
        },
        tokens,
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('Admin login error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur interne',
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// POST /admin/2fa/setup - Generate 2FA setup (requires setup token)
admin.post('/2fa/setup', async (c) => {
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
        requestId: crypto.randomUUID(),
      }, 400);
    }

    // Verify setup token
    const setupDataStr = await c.env.CACHE.get(`admin_2fa_setup:${setupToken}`);
    if (!setupDataStr) {
      return c.json({
        success: false,
        error: {
          code: 'SETUP_TOKEN_EXPIRED',
          message: 'Session de configuration expirée. Reconnectez-vous.',
        },
        requestId: crypto.randomUUID(),
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
      `admin_2fa_pending:${setupToken}`,
      JSON.stringify({ secret, adminId: setupData.adminId, email: setupData.email }),
      { expirationTtl: 600 }
    );

    return c.json({
      success: true,
      data: {
        secret,
        uri,
        issuer: 'TNC Trading Admin',
        message: 'Scannez le QR code avec votre application d\'authentification',
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('Admin 2FA setup error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors de la configuration 2FA',
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// POST /admin/2fa/verify - Verify and complete 2FA setup
admin.post('/2fa/verify', async (c) => {
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
        requestId: crypto.randomUUID(),
      }, 400);
    }

    // Get pending setup data
    const pendingDataStr = await c.env.CACHE.get(`admin_2fa_pending:${setupToken}`);
    if (!pendingDataStr) {
      return c.json({
        success: false,
        error: {
          code: 'SETUP_EXPIRED',
          message: 'Session de configuration expirée. Recommencez.',
        },
        requestId: crypto.randomUUID(),
      }, 400);
    }

    const pendingData = JSON.parse(pendingDataStr);

    // Verify TOTP code
    const configService = new ConfigService(c.env.DB, c.env.CACHE);
    const securityService = new SecurityService(c.env.DB, c.env.CACHE, configService);
    const isValidCode = await securityService.verifyTotpCode(pendingData.secret, code, pendingData.adminId);

    if (!isValidCode) {
      return c.json({
        success: false,
        error: {
          code: '2FA_INVALID_CODE',
          message: 'Code incorrect. Vérifiez l\'heure de votre appareil.',
        },
        requestId: crypto.randomUUID(),
      }, 400);
    }

    // Save 2FA secret to admin (encrypted at rest)
    const encryptedAdminSecret = await encryptTotpSecret(c.env.ENCRYPTION_KEY, pendingData.secret);
    await c.env.DB
      .prepare('UPDATE admins SET two_factor_secret = ?, two_factor_enabled = 1, updated_at = datetime("now") WHERE id = ?')
      .bind(encryptedAdminSecret, pendingData.adminId)
      .run();

    // Clear setup tokens
    await c.env.CACHE.delete(`admin_2fa_setup:${setupToken}`);
    await c.env.CACHE.delete(`admin_2fa_pending:${setupToken}`);

    // Generate login tokens
    const authService = new AuthService(c.env.JWT_SECRET);
    const tokens = await authService.generateTokens({
      sub: pendingData.adminId,
      email: pendingData.email,
      kycLevel: 'VERIFIED',
      portal: 'admin',
    });

    // Get admin details and permissions
    const adminUser = await c.env.DB
      .prepare('SELECT id, email, name, role, password_hash, two_factor_enabled, two_factor_secret, active, last_login_at, created_at, updated_at FROM admins WHERE id = ?')
      .bind(pendingData.adminId)
      .first<any>();

    const permissions = await resolvePermissions(c.env.DB, pendingData.adminId, adminUser?.role || 'ADMIN');

    return c.json({
      success: true,
      data: {
        message: '2FA activé avec succès',
        user: {
          id: pendingData.adminId,
          email: pendingData.email,
          name: adminUser?.name,
          role: adminUser?.role,
          permissions,
          twoFactorEnabled: true,
        },
        tokens,
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('Admin 2FA verify error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors de l\'activation 2FA',
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// All following routes require admin authentication
admin.use('/*', adminJwtMiddleware);

// GET /admin/dashboard
admin.get('/dashboard', requirePermission('dashboard', 'view'), async (c) => {
  try {
    // Total users
    const totalUsersResult = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM users')
      .first<{ count: number }>();

    // Active users (last 30 days)
    const activeUsersResult = await c.env.DB
      .prepare(`SELECT COUNT(*) as count FROM users WHERE updated_at > datetime('now', '-30 days')`)
      .first<{ count: number }>();

    // Total transactions
    const totalTransactionsResult = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM transactions')
      .first<{ count: number }>();

    // Total volume (last 30 days)
    const totalVolumeResult = await c.env.DB
      .prepare(`SELECT COALESCE(SUM(cash_amount), 0) as total FROM transactions WHERE status = 'COMPLETED' AND created_at > datetime('now', '-30 days')`)
      .first<{ total: number }>();

    // Pending KYC count (for stats)
    const pendingKycCountResult = await c.env.DB
      .prepare(`SELECT COUNT(*) as count FROM users WHERE kyc_status = 'SUBMITTED'`)
      .first<{ count: number }>();

    // Pending withdrawals
    const pendingWithdrawalsResult = await c.env.DB
      .prepare(`SELECT COUNT(*) as count FROM transactions WHERE type = 'WITHDRAWAL' AND status = 'PENDING'`)
      .first<{ count: number }>();

    // Recent transactions
    const recentTx = await c.env.DB
      .prepare(`
        SELECT t.*, u.email as user_email
        FROM transactions t
        LEFT JOIN users u ON t.user_id = u.id
        ORDER BY t.created_at DESC
        LIMIT 10
      `)
      .all<any>();

    // Get current price from KV
    let currentPrice = null;
    try {
      const env = c.env.ENVIRONMENT || 'development';
      const priceStr = await c.env.CACHE.get(`${env}:gold_price:current`);
      if (priceStr) currentPrice = JSON.parse(priceStr);
    } catch {}

    const recentTransactionsMapped = (recentTx.results || []).map((tx: any) => ({
      id: tx.id,
      type: tx.type,
      amount: tx.cash_amount,
      status: tx.status,
      createdAt: tx.created_at,
      userEmail: tx.user_email,
    }));

    return c.json({
      success: true,
      data: {
        totalUsers: totalUsersResult?.count || 0,
        activeUsers: activeUsersResult?.count || 0,
        totalTransactions: totalTransactionsResult?.count || 0,
        totalVolume: totalVolumeResult?.total || 0,
        pendingKyc: pendingKycCountResult?.count || 0,
        pendingWithdrawals: pendingWithdrawalsResult?.count || 0,
        recentTransactions: recentTransactionsMapped,
        currentPrice,
      } satisfies AdminDashboardData,
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors du chargement du dashboard',
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// GET /admin/users
admin.get('/users', requirePermission('users', 'view'), async (c) => {
  try {
    const { page, limit, offset } = parsePagination({ page: c.req.query('page'), limit: c.req.query('limit') });
    const search = c.req.query('search') || '';

    let query = 'SELECT id, email, phone, email_verified, phone_verified, country, kyc_level, kyc_status, two_factor_enabled, first_name, last_name, suspended, suspended_at, suspended_until, suspension_reason, last_login_at, created_at, updated_at FROM users';
    let countQuery = 'SELECT COUNT(*) as count FROM users';
    const params: any[] = [];

    if (search) {
      query += ' WHERE email LIKE ? OR phone LIKE ?';
      countQuery += ' WHERE email LIKE ? OR phone LIKE ?';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const users = await c.env.DB.prepare(query).bind(...params).all<any>();
    const countParams = search ? [`%${search}%`, `%${search}%`] : [];
    const totalResult = await c.env.DB.prepare(countQuery).bind(...countParams).first<{ count: number }>();
    const total = totalResult?.count || 0;

    // Map snake_case DB columns to camelCase for frontend
    const items = (users.results || []).map((u: any) => ({
      id: u.id,
      email: u.email,
      phone: u.phone,
      country: u.country,
      kycLevel: u.kyc_level,
      kycStatus: u.kyc_status,
      emailVerified: Boolean(u.email_verified),
      phoneVerified: Boolean(u.phone_verified),
      twoFactorEnabled: Boolean(u.two_factor_enabled),
      createdAt: u.created_at,
    }));

    return c.json({
      success: true,
      data: {
        items,
        total,
        page,
        limit,
        hasMore: offset + limit < total,
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('Users list error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors du chargement des utilisateurs',
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// GET /admin/users/:id
admin.get('/users/:id', requirePermission('users', 'view'), async (c) => {
  try {
    const { id } = c.req.param();

    // D1 batch: run all 4 queries in a single roundtrip
    const [userResult, walletResult, transactionsResult, kycDocsResult] = await c.env.DB.batch([
      c.env.DB.prepare('SELECT id, email, phone, email_verified, phone_verified, country, kyc_level, kyc_status, two_factor_enabled, first_name, last_name, suspended, suspended_at, suspended_until, suspension_reason, last_login_at, created_at, updated_at FROM users WHERE id = ?').bind(id),
      c.env.DB.prepare('SELECT id, user_id, token_balance, cash_balance, total_bought, total_spent, created_at, updated_at FROM wallets WHERE user_id = ?').bind(id),
      c.env.DB.prepare('SELECT id, user_id, wallet_id, type, status, token_amount, cash_amount, price_per_gram, fees, payment_method, payment_reference, failure_reason, created_at, completed_at FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').bind(id),
      c.env.DB.prepare('SELECT id, user_id, document_type, document_number, first_name, last_name, date_of_birth, nationality, address, city, front_image_url, back_image_url, selfie_url, status, rejection_reason, reviewed_by, reviewed_at, document_expiry_date, created_at, updated_at FROM kyc_documents WHERE user_id = ? ORDER BY created_at DESC').bind(id),
    ]);

    const user = userResult.results?.[0] as any;
    if (!user) {
      return c.json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'Utilisateur non trouvé',
        },
        requestId: crypto.randomUUID(),
      }, 404);
    }

    const wallet = walletResult.results?.[0] as any || null;
    const transactions = transactionsResult as any;
    const kycDocs = kycDocsResult as any;

    return c.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        country: user.country,
        kycLevel: user.kyc_level,
        kycStatus: user.kyc_status,
        emailVerified: Boolean(user.email_verified),
        phoneVerified: Boolean(user.phone_verified),
        twoFactorEnabled: Boolean(user.two_factor_enabled),
        createdAt: user.created_at,
        wallet: wallet ? {
          tokenBalance: wallet.token_balance,
          cashBalance: wallet.cash_balance,
        } : null,
        transactions: (transactions.results || []).map((t: any) => ({
          id: t.id,
          type: t.type,
          status: t.status,
          tokenAmount: t.token_amount,
          cashAmount: t.cash_amount,
          fees: t.fees,
          createdAt: t.created_at,
        })),
        kycDocuments: (kycDocs.results || []).map((d: any) => ({
          id: d.id,
          documentType: d.document_type,
          documentNumber: d.document_number,
          verificationStatus: d.status,
          createdAt: d.created_at,
        })),
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('User detail error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors du chargement de l\'utilisateur',
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// PATCH /admin/users/:id/kyc
admin.patch('/users/:id/kyc', requirePermission('kyc', 'approve'), async (c) => {
  try {
    const { id } = c.req.param();
    const body = await c.req.json();
    const { action, reason } = body;

    if (!action || !['approve', 'reject'].includes(action)) {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_ACTION',
          message: 'Action invalide',
        },
        requestId: crypto.randomUUID(),
      }, 400);
    }

    const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';
    const newKycLevel = action === 'approve' ? 'VERIFIED' : 'BASIC';

    await c.env.DB
      .prepare('UPDATE users SET kyc_status = ?, kyc_level = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .bind(newStatus, newKycLevel, id)
      .run();

    // Log admin action
    await c.env.DB
      .prepare('INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))')
      // Action EXPLICITE, pas construite par gabarit : `KYC_${action.toUpperCase()}`
      // rendait la valeur ecrite invisible a la lecture comme au controle, et
      // c'est ainsi que la liste de purge a pu diverger sans que rien ne le dise.
      .bind(crypto.randomUUID(), c.get('adminId'), action === 'approve' ? 'KYC_APPROVE' : 'KYC_REJECT', 'user', id, JSON.stringify({ reason }))
      .run();

    return c.json({
      success: true,
      message: action === 'approve' ? 'KYC approuvé' : 'KYC rejeté',
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('KYC update error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors de la mise à jour KYC',
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// GET /admin/kyc/pending - List pending KYC submissions
admin.get('/kyc/pending', requirePermission('kyc', 'view'), async (c) => {
  const requestId = crypto.randomUUID();
  try {
    const { page, limit, offset } = parsePagination({ page: c.req.query('page'), limit: c.req.query('limit') });

    // Get users with SUBMITTED kyc_status and their KYC documents
    const submissions = await c.env.DB
      .prepare(`
        SELECT u.id as user_id, u.email, u.phone, u.kyc_level,
               kd.id as doc_id, kd.document_type, kd.document_number,
               kd.first_name, kd.last_name, kd.date_of_birth,
               kd.front_image_url, kd.back_image_url, kd.selfie_url,
               kd.created_at as submitted_at
        FROM users u
        LEFT JOIN kyc_documents kd ON kd.user_id = u.id
        WHERE u.kyc_status = 'SUBMITTED'
        ORDER BY kd.created_at DESC
        LIMIT ? OFFSET ?
      `)
      .bind(limit, offset)
      .all<any>();

    const totalResult = await c.env.DB
      .prepare(`SELECT COUNT(*) as count FROM users WHERE kyc_status = 'SUBMITTED'`)
      .first<{ count: number }>();
    const total = totalResult?.count || 0;

    const items = (submissions.results || []).map((s: any) => ({
      id: s.doc_id || s.user_id,
      userId: s.user_id,
      email: s.email,
      phone: s.phone,
      firstName: s.first_name || '',
      lastName: s.last_name || '',
      dateOfBirth: s.date_of_birth || '',
      documentType: s.document_type || '',
      documentNumber: s.document_number || '',
      frontImageUrl: s.front_image_url || '',
      backImageUrl: s.back_image_url || null,
      selfieUrl: s.selfie_url || '',
      submittedAt: s.submitted_at || '',
      kycLevel: s.kyc_level,
    }));

    return c.json({
      success: true,
      data: {
        items,
        total,
        page,
        limit,
        hasMore: offset + limit < total,
      },
      requestId,
    });
  } catch (error) {
    console.error('KYC pending list error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors du chargement des demandes KYC' },
      requestId,
    }, 500);
  }
});

// GET /admin/kyc/:id - Get KYC submission details
admin.get('/kyc/:id', requirePermission('kyc', 'view'), async (c) => {
  const requestId = crypto.randomUUID();
  const { id } = c.req.param();

  try {
    // Try to find by doc_id first, then by user_id
    let doc = await c.env.DB
      .prepare('SELECT id, user_id, document_type, document_number, first_name, last_name, date_of_birth, nationality, address, city, front_image_url, back_image_url, selfie_url, status, rejection_reason, reviewed_by, reviewed_at, document_expiry_date, created_at, updated_at FROM kyc_documents WHERE id = ?')
      .bind(id)
      .first<any>();

    if (!doc) {
      doc = await c.env.DB
        .prepare('SELECT id, user_id, document_type, document_number, first_name, last_name, date_of_birth, nationality, address, city, front_image_url, back_image_url, selfie_url, status, rejection_reason, reviewed_by, reviewed_at, document_expiry_date, created_at, updated_at FROM kyc_documents WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
        .bind(id)
        .first<any>();
    }

    if (!doc) {
      return c.json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Soumission KYC non trouvée' },
        requestId,
      }, 404);
    }

    const user = await c.env.DB
      .prepare('SELECT id, email, phone, kyc_level, kyc_status FROM users WHERE id = ?')
      .bind(doc.user_id)
      .first<any>();

    // Get previous submissions
    const previousDocs = await c.env.DB
      .prepare('SELECT id, status, rejection_reason, created_at, reviewed_at FROM kyc_documents WHERE user_id = ? ORDER BY created_at DESC')
      .bind(doc.user_id)
      .all<any>();

    return c.json({
      success: true,
      data: {
        id: doc.id,
        userId: doc.user_id,
        email: user?.email || '',
        phone: user?.phone || '',
        firstName: doc.first_name || '',
        lastName: doc.last_name || '',
        dateOfBirth: doc.date_of_birth || '',
        documentType: doc.document_type || '',
        documentNumber: doc.document_number || '',
        frontImageUrl: doc.front_image_url || '',
        backImageUrl: doc.back_image_url || null,
        selfieUrl: doc.selfie_url || '',
        submittedAt: doc.created_at,
        currentKycLevel: user?.kyc_level || 'BASIC',
        previousSubmissions: (previousDocs.results || []).map((d: any) => ({
          id: d.id,
          status: d.status,
          rejectionReason: d.rejection_reason,
          submittedAt: d.created_at,
          reviewedAt: d.reviewed_at,
        })),
      },
      requestId,
    });
  } catch (error) {
    console.error('KYC detail error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors du chargement de la soumission KYC' },
      requestId,
    }, 500);
  }
});

// POST /admin/kyc/:id/review - Approve or reject a KYC submission
admin.post('/kyc/:id/review', requirePermission('kyc', 'approve'), async (c) => {
  const requestId = crypto.randomUUID();
  const { id } = c.req.param();

  try {
    const body = await c.req.json();
    const { action, newLevel, rejectionReason } = body;

    if (!action || !['approve', 'reject'].includes(action)) {
      return c.json({
        success: false,
        error: { code: 'INVALID_ACTION', message: 'Action invalide. Utilisez "approve" ou "reject".' },
        requestId,
      }, 400);
    }

    // Find the KYC document
    let doc = await c.env.DB
      .prepare('SELECT id, user_id, document_type, document_number, first_name, last_name, date_of_birth, nationality, address, city, front_image_url, back_image_url, selfie_url, status, rejection_reason, reviewed_by, reviewed_at, document_expiry_date, created_at, updated_at FROM kyc_documents WHERE id = ?')
      .bind(id)
      .first<any>();

    if (!doc) {
      doc = await c.env.DB
        .prepare('SELECT id, user_id, document_type, document_number, first_name, last_name, date_of_birth, nationality, address, city, front_image_url, back_image_url, selfie_url, status, rejection_reason, reviewed_by, reviewed_at, document_expiry_date, created_at, updated_at FROM kyc_documents WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
        .bind(id)
        .first<any>();
    }

    if (!doc) {
      return c.json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Soumission KYC non trouvée' },
        requestId,
      }, 404);
    }

    const userId = doc.user_id;

    if (action === 'approve') {
      const kycLevel = newLevel || 'VERIFIED';

      // Update user KYC status
      await c.env.DB
        .prepare(`UPDATE users SET kyc_status = 'APPROVED', kyc_level = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(kycLevel, userId)
        .run();

      // Update document status
      await c.env.DB
        .prepare(`UPDATE kyc_documents SET status = 'VERIFIED', reviewed_at = datetime('now') WHERE id = ?`)
        .bind(doc.id)
        .run();
    } else {
      // Reject
      await c.env.DB
        .prepare(`UPDATE users SET kyc_status = 'REJECTED', updated_at = datetime('now') WHERE id = ?`)
        .bind(userId)
        .run();

      await c.env.DB
        .prepare(`UPDATE kyc_documents SET status = 'REJECTED', rejection_reason = ?, reviewed_at = datetime('now') WHERE id = ?`)
        .bind(rejectionReason || '', doc.id)
        .run();
    }

    // Audit log
    await c.env.DB
      .prepare(`INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at) VALUES (?, ?, ?, 'kyc', ?, ?, datetime('now'))`)
      .bind(
        crypto.randomUUID(),
        c.get('adminId'),
        action === 'approve' ? 'KYC_APPROVE' : 'KYC_REJECT',
        doc.id,
        JSON.stringify({ newLevel, rejectionReason })
      )
      .run();

    // Notify the user of the decision (email). Non-blocking: a notification
    // failure must not fail the review.
    try {
      const reviewedUser = await c.env.DB
        .prepare('SELECT email FROM users WHERE id = ?')
        .bind(userId)
        .first<{ email: string }>();
      if (reviewedUser?.email) {
        const notificationService = new NotificationService(c.env.DB, {
          resendApiKey: c.env.RESEND_API_KEY,
          sendgridApiKey: c.env.SENDGRID_API_KEY,
          twilioAccountSid: c.env.TWILIO_ACCOUNT_SID,
          twilioAuthToken: c.env.TWILIO_AUTH_TOKEN,
          twilioPhoneNumber: c.env.TWILIO_PHONE_NUMBER,
        });
        const fullName = [doc.first_name, doc.last_name].filter(Boolean).join(' ') || 'Client';
        const notify = action === 'approve'
          ? notificationService.sendKycApproved(reviewedUser.email, fullName, newLevel || 'VERIFIED')
          : notificationService.sendKycRejected(reviewedUser.email, fullName, rejectionReason || 'Document non conforme');
        c.executionCtx.waitUntil(notify.catch((e) => console.error('KYC notification failed:', e)));
      }
    } catch (e) {
      console.error('KYC notification setup failed:', e);
    }

    return c.json({
      success: true,
      data: {
        message: action === 'approve'
          ? `KYC approuvé avec le niveau ${newLevel || 'VERIFIED'}`
          : 'KYC rejeté',
      },
      requestId,
    });
  } catch (error) {
    console.error('KYC review error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors de la revue KYC' },
      requestId,
    }, 500);
  }
});

// POST /admin/users/:id/suspend - Suspend a user account
admin.post('/users/:id/suspend', requirePermission('users', 'update'), async (c) => {
  const requestId = crypto.randomUUID();
  const { id } = c.req.param();

  try {
    const body = await c.req.json();
    const { reason, duration } = body; // duration in hours, null for indefinite

    // Check user exists
    const user = await c.env.DB
      .prepare('SELECT id, email, phone, email_verified, phone_verified, country, kyc_level, kyc_status, two_factor_enabled, first_name, last_name, suspended, suspended_at, suspended_until, suspension_reason, last_login_at, created_at, updated_at FROM users WHERE id = ?')
      .bind(id)
      .first<any>();

    if (!user) {
      return c.json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'Utilisateur non trouvé' },
        requestId,
      }, 404);
    }

    // Check if already suspended
    if (user.suspended) {
      return c.json({
        success: false,
        error: { code: 'USER_ALREADY_SUSPENDED', message: 'Utilisateur déjà suspendu' },
        requestId,
      }, 400);
    }

    // Calculate suspension end time
    const suspendedUntil = duration
      ? new Date(Date.now() + duration * 60 * 60 * 1000).toISOString()
      : null;

    // Update user
    await c.env.DB
      .prepare(`
        UPDATE users
        SET suspended = 1,
            suspended_at = datetime('now'),
            suspended_until = ?,
            suspension_reason = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `)
      .bind(suspendedUntil, reason || 'Non spécifiée', id)
      .run();

    // Invalidate all active sessions
    await c.env.DB
      .prepare('DELETE FROM sessions WHERE user_id = ?')
      .bind(id)
      .run();

    // Log admin action
    await c.env.DB
      .prepare(`
        INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at)
        VALUES (?, ?, 'USER_SUSPENDED', 'user', ?, ?, datetime('now'))
      `)
      .bind(crypto.randomUUID(), c.get('adminId'), id, JSON.stringify({ reason, duration, suspendedUntil }))
      .run();

    // Send notification to user
    const notificationService = new NotificationService(c.env.DB, {
      resendApiKey: c.env.RESEND_API_KEY,
      twilioAccountSid: c.env.TWILIO_ACCOUNT_SID,
      twilioAuthToken: c.env.TWILIO_AUTH_TOKEN,
      twilioPhoneNumber: c.env.TWILIO_PHONE_NUMBER,
    });

    notificationService.sendEmail({
      to: user.email,
      subject: 'Compte suspendu - TNC Trading',
      html: `
        <p>Votre compte TNC Trading a été suspendu.</p>
        <p><strong>Raison:</strong> ${reason || 'Non spécifiée'}</p>
        ${suspendedUntil ? `<p><strong>Durée:</strong> jusqu'au ${new Date(suspendedUntil).toLocaleDateString('fr-FR')}</p>` : '<p><strong>Durée:</strong> Indéfinie</p>'}
        <p>Pour plus d'informations, contactez le support.</p>
      `,
    }).catch(err => console.error('Failed to send suspension email:', err));

    return c.json({
      success: true,
      data: {
        message: 'Utilisateur suspendu',
        suspendedUntil,
      },
      requestId,
    });
  } catch (error) {
    console.error('Suspend user error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors de la suspension' },
      requestId,
    }, 500);
  }
});

// POST /admin/users/:id/unsuspend - Reactivate a suspended user
admin.post('/users/:id/unsuspend', requirePermission('users', 'update'), async (c) => {
  const requestId = crypto.randomUUID();
  const { id } = c.req.param();

  try {
    const body = await c.req.json().catch(() => ({}));
    const { reason } = body;

    // Check user exists and is suspended
    const user = await c.env.DB
      .prepare('SELECT id, email, phone, email_verified, phone_verified, country, kyc_level, kyc_status, two_factor_enabled, first_name, last_name, suspended, suspended_at, suspended_until, suspension_reason, last_login_at, created_at, updated_at FROM users WHERE id = ?')
      .bind(id)
      .first<any>();

    if (!user) {
      return c.json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'Utilisateur non trouvé' },
        requestId,
      }, 404);
    }

    if (!user.suspended) {
      return c.json({
        success: false,
        error: { code: 'USER_NOT_SUSPENDED', message: 'Utilisateur non suspendu' },
        requestId,
      }, 400);
    }

    // Reactivate user
    await c.env.DB
      .prepare(`
        UPDATE users
        SET suspended = 0,
            suspended_at = NULL,
            suspended_until = NULL,
            suspension_reason = NULL,
            updated_at = datetime('now')
        WHERE id = ?
      `)
      .bind(id)
      .run();

    // Log admin action
    await c.env.DB
      .prepare(`
        INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at)
        VALUES (?, ?, 'USER_UNSUSPENDED', 'user', ?, ?, datetime('now'))
      `)
      .bind(crypto.randomUUID(), c.get('adminId'), id, JSON.stringify({ reason }))
      .run();

    // Send notification to user
    const notificationService = new NotificationService(c.env.DB, {
      resendApiKey: c.env.RESEND_API_KEY,
      twilioAccountSid: c.env.TWILIO_ACCOUNT_SID,
      twilioAuthToken: c.env.TWILIO_AUTH_TOKEN,
      twilioPhoneNumber: c.env.TWILIO_PHONE_NUMBER,
    });

    notificationService.sendEmail({
      to: user.email,
      subject: 'Compte réactivé - TNC Trading',
      html: `
        <p>Votre compte TNC Trading a été réactivé.</p>
        <p>Vous pouvez désormais vous reconnecter et utiliser nos services.</p>
      `,
    }).catch(err => console.error('Failed to send unsuspend email:', err));

    return c.json({
      success: true,
      data: { message: 'Utilisateur réactivé' },
      requestId,
    });
  } catch (error) {
    console.error('Unsuspend user error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors de la réactivation' },
      requestId,
    }, 500);
  }
});

// GET /admin/users/:id/audit - Get user audit trail
admin.get('/users/:id/audit', requirePermission('users', 'view'), async (c) => {
  const requestId = crypto.randomUUID();
  const { id } = c.req.param();

  try {
    const { page, limit, offset } = parsePagination({ page: c.req.query('page'), limit: c.req.query('limit') || '50' });

    // Get user audit logs
    const auditLogs = await c.env.DB
      .prepare(`
        SELECT al.*, a.email as admin_email, a.name as admin_name
        FROM audit_logs al
        LEFT JOIN admins a ON al.admin_id = a.id
        WHERE al.user_id = ? OR (al.entity_type = 'user' AND al.entity_id = ?)
        ORDER BY al.created_at DESC
        LIMIT ? OFFSET ?
      `)
      .bind(id, id, limit, offset)
      .all<any>();

    // Get user transactions for activity
    const transactions = await c.env.DB
      .prepare(`
        SELECT id, type, status, cash_amount, token_amount, created_at, completed_at
        FROM transactions
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .bind(id, limit)
      .all<any>();

    // Get login history from sessions/security logs
    const loginHistory = await c.env.DB
      .prepare(`
        SELECT al.action, al.ip_address, al.created_at, al.new_value
        FROM audit_logs al
        WHERE al.user_id = ? AND al.action IN ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'PASSWORD_CHANGED', '2FA_ENABLED', '2FA_DISABLED')
        ORDER BY al.created_at DESC
        LIMIT ?
      `)
      .bind(id, limit)
      .all<any>();

    const totalResult = await c.env.DB
      .prepare(`
        SELECT COUNT(*) as count FROM audit_logs
        WHERE user_id = ? OR (entity_type = 'user' AND entity_id = ?)
      `)
      .bind(id, id)
      .first<{ count: number }>();

    return c.json({
      success: true,
      data: {
        auditLogs: auditLogs.results || [],
        transactions: transactions.results || [],
        loginHistory: loginHistory.results || [],
        total: totalResult?.count || 0,
        page,
        limit,
      },
      requestId,
    });
  } catch (error) {
    console.error('User audit error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors du chargement de l\'audit' },
      requestId,
    }, 500);
  }
});

// GET /admin/audit-logs - Global audit logs
admin.get('/audit-logs', requirePermission('audit', 'view'), async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const { page, limit, offset } = parsePagination({ page: c.req.query('page'), limit: c.req.query('limit') || '50' });
    const action = c.req.query('action');
    const entityType = c.req.query('entityType');
    const adminId = c.req.query('adminId');
    const startDate = c.req.query('startDate');
    const endDate = c.req.query('endDate');

    let query = `
      SELECT al.*, a.email as admin_email, a.name as admin_name, u.email as user_email
      FROM audit_logs al
      LEFT JOIN admins a ON al.admin_id = a.id
      LEFT JOIN users u ON al.user_id = u.id
      WHERE 1=1
    `;
    let countQuery = 'SELECT COUNT(*) as count FROM audit_logs WHERE 1=1';
    const params: any[] = [];
    const countParams: any[] = [];

    if (action) {
      query += ' AND al.action = ?';
      countQuery += ' AND action = ?';
      params.push(action);
      countParams.push(action);
    }

    if (entityType) {
      query += ' AND al.entity_type = ?';
      countQuery += ' AND entity_type = ?';
      params.push(entityType);
      countParams.push(entityType);
    }

    if (adminId) {
      query += ' AND al.admin_id = ?';
      countQuery += ' AND admin_id = ?';
      params.push(adminId);
      countParams.push(adminId);
    }

    if (startDate) {
      query += ' AND al.created_at >= ?';
      countQuery += ' AND created_at >= ?';
      params.push(startDate);
      countParams.push(startDate);
    }

    if (endDate) {
      query += ' AND al.created_at <= ?';
      countQuery += ' AND created_at <= ?';
      params.push(endDate);
      countParams.push(endDate);
    }

    query += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const auditLogs = await c.env.DB.prepare(query).bind(...params).all<any>();
    const totalResult = await c.env.DB.prepare(countQuery).bind(...countParams).first<{ count: number }>();

    return c.json({
      success: true,
      data: {
        items: auditLogs.results || [],
        total: totalResult?.count || 0,
        page,
        limit,
      },
      requestId,
    });
  } catch (error) {
    console.error('Audit logs error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors du chargement des logs' },
      requestId,
    }, 500);
  }
});

// POST /admin/bulk/kyc-approve - Bulk approve KYC submissions
admin.post('/bulk/kyc-approve', requirePermission('kyc', 'approve'), async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const body = await c.req.json();
    const { userIds, reason } = body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return c.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Liste d\'utilisateurs requise' },
        requestId,
      }, 400);
    }

    if (userIds.length > 100) {
      return c.json({
        success: false,
        error: { code: 'TOO_MANY_USERS', message: 'Maximum 100 utilisateurs par requête' },
        requestId,
      }, 400);
    }

    const results: { userId: string; success: boolean; message: string }[] = [];

    for (const userId of userIds) {
      try {
        await c.env.DB
          .prepare(`
            UPDATE users
            SET kyc_status = 'APPROVED', kyc_level = 'VERIFIED', updated_at = datetime('now')
            WHERE id = ? AND kyc_status = 'SUBMITTED'
          `)
          .bind(userId)
          .run();

        await c.env.DB
          .prepare(`
            INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at)
            VALUES (?, ?, 'KYC_BULK_APPROVE', 'user', ?, ?, datetime('now'))
          `)
          .bind(crypto.randomUUID(), c.get('adminId'), userId, JSON.stringify({ reason }))
          .run();

        results.push({ userId, success: true, message: 'KYC approuvé' });
      } catch (err) {
        results.push({ userId, success: false, message: 'Erreur' });
      }
    }

    const successCount = results.filter(r => r.success).length;

    return c.json({
      success: true,
      data: {
        results,
        summary: { total: results.length, succeeded: successCount, failed: results.length - successCount },
      } satisfies BulkKycApproveData,
      requestId,
    });
  } catch (error) {
    console.error('Bulk KYC approve error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors de l\'approbation en masse' },
      requestId,
    }, 500);
  }
});

// GET /admin/suspended-users - List all suspended users
admin.get('/suspended-users', requirePermission('users', 'view'), async (c) => {
  const requestId = crypto.randomUUID();

  try {
    // SECURITY: Add pagination to prevent unbounded queries
    const { page, limit, offset } = parsePagination({ page: c.req.query('page'), limit: c.req.query('limit') });

    const suspendedUsers = await c.env.DB
      .prepare(`
        SELECT id, email, phone, suspended_at, suspended_until, suspension_reason, kyc_level
        FROM users
        WHERE suspended = 1
        ORDER BY suspended_at DESC
        LIMIT ? OFFSET ?
      `)
      .bind(limit, offset)
      .all<any>();

    const totalResult = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM users WHERE suspended = 1')
      .first<{ count: number }>();

    const total = totalResult?.count || 0;

    return c.json({
      success: true,
      data: {
        items: suspendedUsers.results || [],
        total,
        page,
        limit,
        hasMore: offset + (suspendedUsers.results?.length || 0) < total,
      } satisfies SuspendedUsersData,
      requestId,
    });
  } catch (error) {
    console.error('Suspended users error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors du chargement' },
      requestId,
    }, 500);
  }
});

// GET /admin/transactions
admin.get('/transactions', requirePermission('transactions', 'view'), async (c) => {
  try {
    const { page, limit, offset } = parsePagination({ page: c.req.query('page'), limit: c.req.query('limit') });
    const type = c.req.query('type');

    let query = 'SELECT t.*, u.email as user_email FROM transactions t LEFT JOIN users u ON t.user_id = u.id';
    let countQuery = 'SELECT COUNT(*) as count FROM transactions';
    const params: any[] = [];
    const countParams: any[] = [];

    if (type) {
      query += ' WHERE t.type = ?';
      countQuery += ' WHERE type = ?';
      params.push(type);
      countParams.push(type);
    }

    query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const transactions = await c.env.DB.prepare(query).bind(...params).all<any>();
    const totalResult = await c.env.DB.prepare(countQuery).bind(...countParams).first<{ count: number }>();

    const items = (transactions.results || []).map((tx: any) => ({
      id: tx.id,
      userId: tx.user_id,
      userEmail: tx.user_email,
      type: tx.type,
      status: tx.status,
      tokenAmount: tx.token_amount,
      cashAmount: tx.cash_amount,
      fees: tx.fees,
      createdAt: tx.created_at,
    }));

    return c.json({
      success: true,
      data: {
        items,
        total: totalResult?.count || 0,
        page,
        limit,
        hasMore: (totalResult?.count || 0) > page * limit,
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('Transactions list error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors du chargement des transactions',
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// GET /admin/stock
admin.get('/stock', requirePermission('stock', 'view'), async (c) => {
  try {
    const stock = await c.env.DB
      .prepare('SELECT id, total_allocated, tokens_issued, available_stock, low_stock_threshold, last_audit_date, last_audit_result, audited_by, updated_at FROM gold_stock ORDER BY updated_at DESC LIMIT 1')
      .first<any>();

    // Une seule source pour tous les chiffres de reserve (ADR 012). La somme des
    // portefeuilles excluait les grammes places en location, alors que le jeton
    // correspondant est bel et bien emis.
    const reserve = chiffresReserve(stock);

    return c.json({
      success: true,
      data: {
        totalAllocated: reserve.alloueG,
        tokensIssued: reserve.emisG,
        availableStock: reserve.disponibleG,
        lastAuditDate: stock?.last_audit_date,
        lastAuditResult: stock?.last_audit_result,
        utilisationRate: reserve.utilisation,
      } satisfies AdminStockData,
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('Stock error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors du chargement du stock',
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// POST /admin/stock/adjust
admin.post('/stock/adjust', requirePermission('stock', 'update'), async (c) => {
  try {
    const body = await c.req.json();
    const { amount, reason } = body;

    // Get current stock
    let stock = await c.env.DB
      .prepare('SELECT id, total_allocated, tokens_issued, available_stock, low_stock_threshold, last_audit_date, last_audit_result, audited_by, updated_at FROM gold_stock ORDER BY updated_at DESC LIMIT 1')
      .first<any>();

    // La regle vit dans `lib/stock-invariant` : elle y est testee contre un vrai
    // SQLite, plutot que reproduite dans un test qui prouverait sa copie.
    const verdict = verifierAjustementStock(amount, stock);
    if (!verdict.ok) {
      return c.json({
        success: false,
        error: { code: verdict.code, message: verdict.message, details: verdict.details },
        requestId: crypto.randomUUID(),
      }, verdict.status);
    }

    const newTotal = verdict.newTotal;

    /**
     * Ecriture et trace dans le MEME lot.
     *
     * C'etaient deux `.run()` successifs : un echec entre les deux ajustait la
     * reserve nationale sans laisser de trace de qui l'avait fait.
     */
    const ajustement = stock
      ? c.env.DB
          .prepare("UPDATE gold_stock SET total_allocated = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(newTotal, stock.id)
      : c.env.DB
          .prepare("INSERT INTO gold_stock (id, total_allocated, tokens_issued, updated_at) VALUES (?, ?, 0, datetime('now'))")
          .bind('main', newTotal);

    await c.env.DB.batch([
      ajustement,
      c.env.DB
        .prepare("INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))")
        .bind(crypto.randomUUID(), c.get('adminId'), 'STOCK_ADJUST', 'stock', 'main', JSON.stringify({ amount, reason, newTotal })),
    ]);

    return c.json({
      success: true,
      message: 'Stock ajusté avec succès',
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('Stock adjust error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors de l\'ajustement du stock',
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// GET /admin/withdrawals
admin.get('/withdrawals', requirePermission('withdrawals', 'view'), async (c) => {
  try {
    const status = c.req.query('status') || 'PENDING';

    const withdrawals = await c.env.DB
      .prepare(`
        SELECT t.*, u.email as user_email, u.phone as user_phone
        FROM transactions t
        LEFT JOIN users u ON t.user_id = u.id
        WHERE t.type = 'WITHDRAWAL' AND t.status = ?
        ORDER BY t.created_at DESC
      `)
      .bind(status)
      .all<any>();

    const items = (withdrawals.results || []).map((w: any) => ({
      id: w.id,
      userId: w.user_id,
      userEmail: w.user_email,
      amount: w.cash_amount,
      paymentMethod: w.payout_method || w.payment_method,
      phoneNumber: w.user_phone,
      status: w.status,
      createdAt: w.created_at,
    }));

    return c.json({
      success: true,
      data: {
        items,
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('Withdrawals list error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors du chargement des retraits',
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// PATCH /admin/withdrawals/:id
admin.patch('/withdrawals/:id', requirePermission('withdrawals', 'approve'), async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const { id } = c.req.param();
    const body = await c.req.json();
    const { action, reason } = body;

    if (!action || !['approve', 'reject'].includes(action)) {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_ACTION',
          message: 'Action invalide',
        },
        requestId,
      }, 400);
    }

    // Get the withdrawal transaction with details
    const transaction = await c.env.DB
      .prepare(`
        SELECT t.*, u.email, u.phone, w.phone_number, w.bank_account, w.net_amount
        FROM transactions t
        LEFT JOIN users u ON t.user_id = u.id
        LEFT JOIN withdrawals w ON w.transaction_id = t.id
        WHERE t.id = ? AND t.type = 'WITHDRAWAL'
      `)
      .bind(id)
      .first<any>();

    if (!transaction) {
      return c.json({
        success: false,
        error: {
          code: 'WITHDRAWAL_NOT_FOUND',
          message: 'Retrait non trouvé',
        },
        requestId,
      }, 404);
    }

    if (transaction.status !== 'PENDING') {
      return c.json({
        success: false,
        error: {
          code: 'WITHDRAWAL_ALREADY_PROCESSED',
          message: 'Ce retrait a déjà été traité',
        },
        requestId,
      }, 400);
    }

    const notificationService = new NotificationService(c.env.DB, {
      resendApiKey: c.env.RESEND_API_KEY,
      sendgridApiKey: c.env.SENDGRID_API_KEY,
      twilioAccountSid: c.env.TWILIO_ACCOUNT_SID,
      twilioAuthToken: c.env.TWILIO_AUTH_TOKEN,
      twilioPhoneNumber: c.env.TWILIO_PHONE_NUMBER,
    });

    if (action === 'approve') {
      // Initialize payment service for payout
      const paymentService = new PaymentService(c.env.DB, c.env.CACHE, {
        orangeMoneyApiKey: c.env.ORANGE_MONEY_API_KEY,
        orangeMoneyMerchantId: c.env.ORANGE_MONEY_MERCHANT_ID,
        moovApiKey: c.env.MOOV_MONEY_API_KEY,
        moovMerchantId: c.env.MOOV_MERCHANT_ID,
        webhookSecret: c.env.WEBHOOK_SECRET,
      });

      // Get recipient phone/account
      const recipient = transaction.phone_number || transaction.payment_reference;
      const netAmount = transaction.net_amount || (transaction.cash_amount - (transaction.fees || 0));

      // Execute payout based on payment method
      let payoutResult;
      if (transaction.payment_method !== 'bank') {
        payoutResult = await paymentService.initiateWithdrawalPayout(
          transaction.payment_method as 'orange_money' | 'moov_money',
          netAmount,
          recipient,
          transaction.id
        );

        if (!payoutResult.success) {
          // Update transaction status to FAILED
          await c.env.DB
            .prepare(`
              UPDATE transactions
              SET status = 'FAILED', failure_reason = ?, completed_at = datetime('now')
              WHERE id = ?
            `)
            .bind(payoutResult.error || 'Payout failed', id)
            .run();

          return c.json({
            success: false,
            error: {
              code: 'PAYOUT_FAILED',
              message: payoutResult.error || 'Échec de l\'exécution du payout',
            },
            requestId,
          }, 400);
        }
      }

      // Update transaction status to PROCESSING (awaiting confirmation) or COMPLETED for bank
      const newStatus = transaction.payment_method === 'bank' ? 'COMPLETED' : 'PROCESSING';

      /**
       * Les deux ecritures dans le MEME lot, sous la MEME garde.
       *
       * C'etaient deux validations distinctes : un echec sur la seconde laissait
       * la transaction avancee et le retrait encore `PENDING`. Chaque instruction
       * porte donc `status = 'PENDING'`, et le basculement de la transaction vient
       * EN DERNIER — une mise a jour qui ne matche aucune ligne n'est pas une
       * erreur et n'interrompt pas le lot, donc la garde doit etre portee partout.
       */
      const resultatsApprobation = await c.env.DB.batch([
        c.env.DB
          .prepare(`
            UPDATE withdrawals
            SET status = ?, provider_reference = ?, completed_at = datetime('now')
            WHERE transaction_id = ?
              AND EXISTS (SELECT 1 FROM transactions WHERE id = ? AND status = 'PENDING')
          `)
          .bind(newStatus, payoutResult?.transactionId || 'MANUAL', id, id),
        c.env.DB
          .prepare(`
            UPDATE transactions
            SET status = ?,
                external_reference = ?,
                completed_at = CASE WHEN ? = 'COMPLETED' THEN datetime('now') ELSE NULL END
            WHERE id = ? AND status = 'PENDING'
          `)
          .bind(newStatus, payoutResult?.transactionId || null, newStatus, id),
      ]);

      if ((resultatsApprobation[resultatsApprobation.length - 1].meta?.changes ?? 0) === 0) {
        return c.json({
          success: false,
          error: { code: 'WITHDRAWAL_ALREADY_PROCESSED', message: 'Ce retrait a déjà été traité' },
          requestId: crypto.randomUUID(),
        }, 409);
      }

      // Send notification to user
      notificationService.sendWithdrawalApproved(
        transaction.email,
        netAmount,
        transaction.payment_method
      ).catch(err => console.error('Failed to send withdrawal approved email:', err));

      if (transaction.phone) {
        notificationService.sendWithdrawalApprovedSms(transaction.phone, netAmount)
          .catch(err => console.error('Failed to send withdrawal approved SMS:', err));
      }

    } else {
      /**
       * Remboursement, retrait et transaction dans le MEME lot, sous la MEME garde.
       *
       * C'etaient trois validations successives. La garde amont
       * (`status !== 'PENDING'` -> refus) bloque un rejeu sequentiel, mais elle
       * est LUE avant d'ecrire : si le remboursement passait et que le marquage
       * echouait, la transaction restait `PENDING`, la reprise franchissait la
       * garde et remboursait UNE SECONDE FOIS.
       *
       * Ici, chaque instruction porte `status = 'PENDING'` et le basculement vient
       * en dernier : le second essai ne touche aucune ligne, donc ne rembourse rien.
       */
      const motifRejet = reason || "Rejeté par l'administrateur";
      const resultatsRejet = await c.env.DB.batch([
        c.env.DB
          .prepare(`
            UPDATE wallets
            SET cash_balance = cash_balance + ?, updated_at = datetime('now')
            WHERE user_id = ?
              AND EXISTS (SELECT 1 FROM transactions WHERE id = ? AND status = 'PENDING')
          `)
          .bind(transaction.cash_amount, transaction.user_id, id),
        c.env.DB
          .prepare(`
            UPDATE withdrawals
            SET status = 'REJECTED', failure_reason = ?, completed_at = datetime('now')
            WHERE transaction_id = ?
              AND EXISTS (SELECT 1 FROM transactions WHERE id = ? AND status = 'PENDING')
          `)
          .bind(reason || 'Rejeté', id, id),
        c.env.DB
          .prepare(`
            UPDATE transactions
            SET status = 'CANCELLED', failure_reason = ?, completed_at = datetime('now')
            WHERE id = ? AND status = 'PENDING'
          `)
          .bind(motifRejet, id),
      ]);

      if ((resultatsRejet[resultatsRejet.length - 1].meta?.changes ?? 0) === 0) {
        return c.json({
          success: false,
          error: { code: 'WITHDRAWAL_ALREADY_PROCESSED', message: 'Ce retrait a déjà été traité' },
          requestId: crypto.randomUUID(),
        }, 409);
      }

      // Send rejection notification
      notificationService.sendEmail({
        to: transaction.email,
        subject: 'Demande de retrait rejetée - TNC Trading',
        html: `
          <p>Votre demande de retrait de ${transaction.cash_amount.toLocaleString('fr-FR')} XOF a été rejetée.</p>
          <p><strong>Raison:</strong> ${reason || 'Non spécifiée'}</p>
          <p>Le montant a été recrédité sur votre compte TNC Trading.</p>
        `,
      }).catch(err => console.error('Failed to send rejection email:', err));
    }

    // Log admin action
    await c.env.DB
      .prepare(`
        INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at)
        VALUES (?, ?, ?, 'transaction', ?, ?, datetime('now'))
      `)
      .bind(
        crypto.randomUUID(),
        c.get('adminId'),
        action === 'approve' ? 'WITHDRAWAL_APPROVE' : 'WITHDRAWAL_REJECT',
        id,
        JSON.stringify({ reason, amount: transaction.cash_amount })
      )
      .run();

    return c.json({
      success: true,
      data: {
        message: action === 'approve' ? 'Retrait approuvé et payout initié' : 'Retrait rejeté et montant recrédité',
        status: action === 'approve' ? (transaction.payment_method === 'bank' ? 'COMPLETED' : 'PROCESSING') : 'CANCELLED',
      },
      requestId,
    });
  } catch (error) {
    console.error('Withdrawal update error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors du traitement du retrait',
      },
      requestId,
    }, 500);
  }
});

// GET /admin/reports/por - Proof of Reserve (Enhanced)
admin.get('/reports/por', requirePermission('stock', 'view'), async (c) => {
  try {
    const stock = await c.env.DB
      .prepare('SELECT id, total_allocated, tokens_issued, gold_on_loan, last_audit_date, last_audit_result, updated_at FROM gold_stock ORDER BY updated_at DESC LIMIT 1')
      .first<any>();

    // La repartition porte bien sur les PORTEFEUILLES : la somme des soldes y est
    // la bonne mesure, contrairement aux jetons emis (ADR 012).
    const walletDistribution = await c.env.DB
      .prepare(`
        SELECT
          CASE
            WHEN token_balance = 0 THEN 'empty'
            WHEN token_balance < 10 THEN 'small'
            WHEN token_balance < 100 THEN 'medium'
            WHEN token_balance < 1000 THEN 'large'
            ELSE 'whale'
          END as range,
          COUNT(*) as count,
          COALESCE(SUM(token_balance), 0) as totalTokens
        FROM wallets
        GROUP BY range
        ORDER BY totalTokens DESC
      `)
      .all<{ range: string; count: number; totalTokens: number }>();

    // Les trois fenetres en une passe : trois requetes separees pourraient tomber
    // de part et d'autre d'une transaction en cours et ne pas se recouper.
    const fenetres = await c.env.DB
      .prepare(`
        SELECT
          CASE WHEN created_at > datetime('now', '-1 day') THEN '24h'
               WHEN created_at > datetime('now', '-7 days') THEN '7d'
               ELSE '30d' END as fenetre,
          type,
          COUNT(*) as count,
          COALESCE(SUM(cash_amount), 0) as volume
        FROM transactions
        WHERE status = 'COMPLETED'
          AND type IN ('BUY', 'SELL')
          AND created_at > datetime('now', '-30 days')
        GROUP BY fenetre, type
      `)
      .all<{ fenetre: string; type: string; count: number; volume: number }>();

    const holdersResult = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM wallets WHERE token_balance > 0')
      .first<{ count: number }>();

    const avgHoldingResult = await c.env.DB
      .prepare('SELECT AVG(token_balance) as avg FROM wallets WHERE token_balance > 0')
      .first<{ avg: number }>();

    const prix = await c.env.DB
      .prepare('SELECT price_xof, buy_price, sell_price, spread_buy, spread_sell, source, timestamp FROM gold_prices ORDER BY timestamp DESC LIMIT 1')
      .first<{ price_xof: number; buy_price: number; sell_price: number; spread_buy: number; spread_sell: number; source: string; timestamp: string }>();

    const attestation = await new AttestationService(c.env.DB).getLatest();

    const reserve = chiffresReserve(stock);

    /**
     * Les fenetres sont IMBRIQUEES : ce qui est tombe dans « 24h » appartient
     * aussi aux 7 et 30 jours. Le regroupement SQL les rend disjointes, on les
     * recompose ici.
     */
    const cumul = (...cles: string[]) => {
      const lignes = (fenetres.results || []).filter((r) => cles.includes(r.fenetre));
      return {
        buys: lignes.filter((r) => r.type === 'BUY').reduce((n, r) => n + r.count, 0),
        sells: lignes.filter((r) => r.type === 'SELL').reduce((n, r) => n + r.count, 0),
        volumeXof: Math.round(lignes.reduce((n, r) => n + (r.volume || 0), 0)),
      };
    };

    return c.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        goldStock: {
          totalAllocated: reserve.alloueG,
          tokensIssued: reserve.emisG,
          availableStock: reserve.disponibleG,
          goldVaulted: reserve.enCoffreG,
          goldOnLoan: reserve.preteG,
          coverageRatio: reserve.couverture,
          utilisationRate: reserve.utilisation,
          isCovered: reserve.invariantTenu,
          fullyVaulted: reserve.entierementEnCoffre,
        },
        tokenHolders: {
          totalHolders: holdersResult?.count || 0,
          averageHolding: avgHoldingResult?.avg || 0,
          distribution: walletDistribution.results || [],
        },
        transactions: {
          last24h: cumul('24h'),
          last7d: cumul('24h', '7d'),
          last30d: cumul('24h', '7d', '30d'),
        },
        // `null` plutot qu'un prix a zero : aucun releve n'est une information,
        // un cours nul est un mensonge.
        pricing: prix
          ? {
              priceXof: prix.price_xof,
              buyPrice: prix.buy_price,
              sellPrice: prix.sell_price,
              spreadBuy: prix.spread_buy,
              spreadSell: prix.spread_sell,
              source: prix.source,
              timestamp: prix.timestamp,
            }
          : null,
        audit: {
          lastAuditDate: stock?.last_audit_date ?? null,
          lastAuditResult: stock?.last_audit_result ?? null,
          nextAuditDue: stock?.last_audit_date
            ? new Date(new Date(stock.last_audit_date).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
            : null,
        },
        // L'empreinte PUBLIEE, celle de l'attestation signee — pas un condense
        // recalcule pour l'occasion, qui ne prouverait rien de verifiable.
        attestation: attestation
          ? {
              sequence: attestation.sequence,
              digest: attestation.digest,
              signedAt: attestation.created_at,
              signed: attestation.signature !== null,
              anchorTxHash: attestation.anchor_tx_hash,
            }
          : null,
      } satisfies AdminProofOfReserveData,
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('PoR report error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors de la génération du rapport',
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// GET /admin/reports/por.pdf — the same Proof of Reserve, as a document
admin.get('/reports/por.pdf', requirePermission('stock', 'view'), async (c) => {
  const stock = await c.env.DB
    .prepare('SELECT total_allocated, tokens_issued, gold_on_loan, last_audit_date FROM gold_stock WHERE id = ?')
    .bind(GOLD_STOCK_ID)
    .first<{ total_allocated: number; tokens_issued: number; gold_on_loan: number | null; last_audit_date: string | null }>();

  if (!stock) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Aucun stock enregistré' },
      requestId: crypto.randomUUID(),
    }, 404);
  }

  // Meme source que la route JSON et que le portail Etat (ADR 012) : le PDF
  // recalculait sa propre version de « en coffre » et de l'invariant.
  const reserve = chiffresReserve(stock);
  const g = (n: number) => `${n.toFixed(3)} g`;

  const loans = await c.env.DB
    .prepare(
      `SELECT counterparty, weight_g, due_at FROM gold_loans WHERE status = 'ACTIVE'
       ORDER BY started_at ASC, counterparty ASC`
    )
    .all<{ counterparty: string; weight_g: number; due_at: string | null }>();

  const lots = await c.env.DB
    .prepare(
      `SELECT reference, refined_weight_g, audited_at FROM gold_consignments
       WHERE status = 'AUDIT_VALIDATED' ORDER BY audited_at DESC LIMIT 20`
    )
    .all<{ reference: string; refined_weight_g: number; audited_at: string }>();

  const attestation = await new AttestationService(c.env.DB).getLatest();

  const blocks: PdfBlock[] = [
    { type: 'heading', text: 'Couverture' },
    {
      type: 'keyValue',
      rows: [
        ['Or alloué', g(reserve.alloueG)],
        ['Tokens en circulation', g(reserve.emisG)],
        ['Dont or en coffre', g(reserve.enCoffreG)],
        ['Dont or prêté', g(reserve.preteG)],
        ['Tokens émis <= or alloué', reserve.invariantTenu ? 'Oui' : 'NON'],
        ['Tokens émis <= or en coffre', reserve.entierementEnCoffre ? 'Oui' : 'Non'],
        ['Dernier audit physique', stock.last_audit_date || 'Non renseigné'],
      ],
    },
  ];

  // The distinction that a reader must not miss: lent gold is owed, not held.
  if (reserve.preteG > 0) {
    blocks.push({
      type: 'note',
      text:
        "Une partie de la réserve est prêtée. L'or reste dû à la plateforme mais n'est pas " +
        'physiquement présent : la couverture correspondante dépend du remboursement de la ' +
        'contrepartie.',
    });
    blocks.push({
      type: 'table',
      columns: ['Contrepartie', 'Poids', 'Échéance'],
      rows: (loans.results || []).map((l) => [l.counterparty, g(l.weight_g), l.due_at || '—']),
    });
  }

  if ((lots.results || []).length) {
    blocks.push({ type: 'heading', text: 'Derniers lots audités' });
    blocks.push({
      type: 'table',
      columns: ['Référence', 'Poids raffiné', 'Date'],
      rows: lots.results!.map((l) => [l.reference, g(l.refined_weight_g), l.audited_at?.slice(0, 10) || '—']),
    });
  }

  blocks.push({ type: 'heading', text: 'Attestation vérifiable' });
  blocks.push(
    attestation
      ? {
          type: 'keyValue',
          rows: [
            ['Attestation', `#${attestation.sequence}`],
            ['Empreinte', attestation.digest],
            ['Ancrage', attestation.anchor_tx_hash ? `${attestation.anchor_chain} · ${attestation.anchor_tx_hash}` : 'Non ancrée'],
          ],
        }
      : { type: 'paragraph', text: 'Aucune attestation publiée à ce jour.' }
  );
  blocks.push({
    type: 'note',
    text:
      "Ce document est un état à un instant donné. Il n'est pas la preuve : la preuve est " +
      "l'attestation signée, vérifiable publiquement sur /reserve à partir de son empreinte.",
  });

  const pdf = renderPdf({
    title: 'Preuve de réserve',
    subtitle: `TNC Trading — ${new Date().toLocaleString('fr-FR')}`,
    footer: 'Document généré automatiquement — vérification publique sur /reserve',
    blocks,
  });

  return new Response(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="proof-of-reserve-${new Date().toISOString().slice(0, 10)}.pdf"`,
    },
  });
});

// ============================================
// READINESS — can this deployment actually demonstrate what it implements?
// ============================================

// GET /admin/readiness?probe=true
admin.get('/readiness', requirePermission('integrations', 'view'), async (c) => {
  const requestId = crypto.randomUUID();
  // Probing is opt-in: it performs real outbound calls (read-only, and never to
  // a payment gateway), so it must be an explicit request rather than a side
  // effect of opening a dashboard.
  const probe = c.req.query('probe') === 'true';

  const service = new ReadinessService(c.env as never);
  const report = await service.report(probe);

  // Audit trail: a readiness probe is an outbound action on production systems.
  if (probe) {
    await c.env.DB
      .prepare(
        `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at)
         VALUES (?, ?, 'READINESS_PROBE', 'system', 'readiness', ?, datetime('now'))`
      )
      .bind(crypto.randomUUID(), c.get('adminId'), JSON.stringify(report.summary))
      .run();
  }

  return c.json({ success: true, data: report, requestId });
});

// ============================================
// PRODUCER KYB (entity behind a producer account)
// Gated by the `kyc` module: a KYB is identity verification for a legal entity,
// which is exactly the KYC_REVIEWER's job.
// ============================================

// GET /admin/producers?status=&page=&limit=
admin.get('/producers', requirePermission('kyc', 'view'), async (c) => {
  const requestId = crypto.randomUUID();
  const { page, limit, offset } = parsePagination(c.req.query());
  const status = c.req.query('status');
  const service = new ProducerProfileService(c.env.DB);
  const { items, total } = await service.list({ status, limit, offset });
  return c.json({ success: true, data: { items, meta: { page, limit, total } }, requestId });
});

// GET /admin/producers/:id
admin.get('/producers/:id', requirePermission('kyc', 'view'), async (c) => {
  const requestId = crypto.randomUUID();
  const service = new ProducerProfileService(c.env.DB);
  const profile = await service.getById(c.req.param('id'));
  if (!profile) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Dossier non trouvé' }, requestId }, 404);
  }
  return c.json({ success: true, data: profile, requestId });
});

/**
 * Notify a user in-app and on their devices, without ever failing the operation
 * that triggered it: an admin decision must not be rolled back because a phone
 * is unreachable.
 */
async function notifyProducer(
  c: Context<AppEnv>,
  userId: string,
  n: { type: NotificationType; title: string; body: string; data?: Record<string, string> }
): Promise<void> {
  try {
    const configService = new ConfigService(c.env.DB, c.env.CACHE);
    const notifications = new NotificationService(c.env.DB, {}, undefined, configService);
    await notifications.notifyUser({ userId, ...n });
  } catch (error) {
    console.error('Notification failed', String(error));
  }
}

function kybError(c: Context<AppEnv>, r: { ok?: boolean; error?: string; from?: string }) {
  const requestId = crypto.randomUUID();
  if (r.error === 'NOT_FOUND') {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Dossier non trouvé' }, requestId }, 404);
  }
  if (r.error === 'INVALID_TRANSITION') {
    return c.json({ success: false, error: { code: 'INVALID_TRANSITION', message: `Dossier déjà traité (${r.from})` }, requestId }, 409);
  }
  return c.json({ success: false, error: { code: 'CONFLICT', message: 'Opération non aboutie, veuillez réessayer.' }, requestId }, 409);
}

// POST /admin/producers/:id/approve — grants the configured KYC level
admin.post('/producers/:id/approve', requirePermission('kyc', 'approve'), async (c) => {
  const requestId = crypto.randomUUID();
  const cfg = new ConfigService(c.env.DB, c.env.CACHE);
  const configured = await cfg.get('producer_kyb_granted_level', 'STANDARD');
  // Only a level that can actually sell is meaningful here — a consignment is
  // paid in tokens, and BASIC cannot sell them.
  const grantedLevel = configured === 'VERIFIED' ? 'VERIFIED' : 'STANDARD';
  const service = new ProducerProfileService(c.env.DB);
  const r = await service.approve(c.req.param('id'), { id: c.get('adminId') as string }, grantedLevel);
  if (!r.ok) return kybError(c, r);

  await notifyProducer(c, r.profile.user_id, {
    type: 'KYC',
    title: 'Dossier producteur validé',
    body: "Votre dossier a été validé. Vous pouvez désormais consigner vos lots d'or.",
  });

  return c.json({ success: true, data: r.profile, requestId });
});

// POST /admin/producers/:id/reject
admin.post('/producers/:id/reject', requirePermission('kyc', 'reject'), async (c) => {
  const requestId = crypto.randomUUID();
  const body = await c.req.json().catch(() => ({}));
  const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'Dossier incomplet';
  const service = new ProducerProfileService(c.env.DB);
  const r = await service.reject(c.req.param('id'), { id: c.get('adminId') as string }, reason);
  if (!r.ok) return kybError(c, r);

  await notifyProducer(c, r.profile.user_id, {
    type: 'KYC',
    title: 'Dossier producteur à corriger',
    body: `Votre dossier n'a pas été validé : ${reason}`,
  });

  return c.json({ success: true, data: r.profile, requestId });
});

// ============================================
// GOLD CONSIGNMENTS (export workflow)
// ============================================

function consignmentError(c: Context<AppEnv>, r: { ok?: boolean; error?: string; from?: string }) {
  const requestId = crypto.randomUUID();
  if (r.error === 'NOT_FOUND') {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Lot non trouvé' }, requestId }, 404);
  }
  if (r.error === 'INVALID_TRANSITION') {
    return c.json({ success: false, error: { code: 'INVALID_TRANSITION', message: `Transition invalide depuis ${r.from}` }, requestId }, 409);
  }
  return c.json({ success: false, error: { code: 'CONFLICT', message: 'Opération non aboutie, veuillez réessayer' }, requestId }, 409);
}

function currentAdmin(c: Context<AppEnv>) {
  return { id: c.get('adminId') as string, role: c.get('adminRole') as string };
}

// GET /admin/consignments?status=&page=&limit=
admin.get('/consignments', requirePermission('consignments', 'view'), async (c) => {
  const requestId = crypto.randomUUID();
  const { page, limit, offset } = parsePagination(c.req.query());
  const status = c.req.query('status');
  const service = new ConsignmentService(c.env.DB);
  const { items, total } = await service.listAll({ status, limit, offset });
  return c.json({ success: true, data: { items, meta: { page, limit, total } }, requestId });
});

// GET /admin/consignments/:id  (detail + event timeline)
admin.get('/consignments/:id', requirePermission('consignments', 'view'), async (c) => {
  const requestId = crypto.randomUUID();
  const { id } = c.req.param();
  const service = new ConsignmentService(c.env.DB);
  const consignment = await service.getById(id);
  if (!consignment) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Lot non trouvé' }, requestId }, 404);
  }
  const events = await service.listEvents(id);
  // La répartition fait partie de l'histoire du lot : sans elle, le support ne
  // peut pas répondre à « ma location ne s'est pas ouverte ».
  const disposition = await new DispositionService(c.env.DB).getByConsignment(id);
  return c.json({ success: true, data: { consignment, events, disposition }, requestId });
});

// GET /admin/dispositions?status=  (répartitions de lots)
//
// Une répartition PARTIAL veut dire qu'une jambe financière a échoué. Le
// producteur le voit sur son écran s'il regarde ; la plateforme, elle, n'avait
// aucun moyen de l'apprendre. Un échec d'argent que personne ne surveille finit
// par se découvrir par un appel au support, ou pas du tout.
admin.get('/dispositions', requirePermission('consignments', 'view'), async (c) => {
  const requestId = crypto.randomUUID();
  const status = c.req.query('status');
  const { page, limit, offset } = parsePagination({
    page: c.req.query('page'),
    limit: c.req.query('limit') || '50',
  });

  // Par défaut, seulement ce qui demande une intervention. Lister tout par
  // défaut noierait les quelques lignes qui comptent.
  const where = status
    ? 'WHERE d.status = ?'
    : "WHERE d.status IN ('PARTIAL', 'FAILED', 'PENDING')";
  const binds: unknown[] = status ? [status] : [];

  const rows = await c.env.DB.prepare(
    `SELECT d.*, c.reference, c.producer_id
     FROM lot_dispositions d
     LEFT JOIN gold_consignments c ON c.id = d.consignment_id
     ${where}
     ORDER BY d.created_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(...binds, limit, offset)
    .all();

  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) AS c FROM lot_dispositions d ${where}`
  )
    .bind(...binds)
    .first<{ c: number }>();

  return c.json({
    success: true,
    data: {
      items: rows.results || [],
      meta: { page, limit, total: total?.c || 0 },
      // Dit explicitement, sinon un back-office vide se lit « tout va bien »
      // alors qu'il veut dire « filtre par défaut ».
      filter: status || 'PARTIAL, FAILED, PENDING (défaut)',
    },
    requestId,
  });
});

// GET /admin/storage-fees/outstanding  (arriérés de frais de garde)
//
// Aucun recouvrement n'est automatisé (ADR 005) : encore faut-il pouvoir dire
// qui doit quoi. Sans cette vue, la seule façon de le savoir serait d'interroger
// la base à la main.
admin.get('/storage-fees/outstanding', requirePermission('transactions', 'view'), async (c) => {
  const requestId = crypto.randomUUID();

  const rows = await c.env.DB.prepare(
    `SELECT f.user_id,
            COUNT(*) AS days_outstanding,
            SUM(f.amount_xof) AS total_xof,
            MIN(f.accrual_date) AS oldest,
            MAX(f.accrual_date) AS newest,
            w.cash_balance,
            w.token_balance
     FROM storage_fee_accruals f
     LEFT JOIN wallets w ON w.user_id = f.user_id
     WHERE f.status = 'OUTSTANDING'
     GROUP BY f.user_id
     ORDER BY total_xof DESC
     LIMIT 200`
  ).all<{ total_xof: number }>();

  const items = rows.results || [];

  return c.json({
    success: true,
    data: {
      items,
      totalXof: Math.round(items.reduce((sum, r) => sum + (r.total_xof || 0), 0)),
      // Le solde espèces est joint volontairement : un arriéré sur un compte
      // approvisionné signale un prélèvement en panne, pas un débiteur.
      notice:
        "Un arriéré sur un compte au solde suffisant n'est pas un impayé commercial : c'est le job de prélèvement qui n'a pas tourné.",
    },
    requestId,
  });
});

// GET /admin/consignments/:id/statement.pdf  (settlement statement for the lot)
//
// Same document the producer downloads, byte for byte. A back-office that could
// see a different statement from the one the producer holds would be useless in
// a dispute, which is the moment it exists for.
admin.get('/consignments/:id/statement.pdf', requirePermission('consignments', 'view'), async (c) => {
  const { id } = c.req.param();
  const service = new ConsignmentService(c.env.DB);
  const consignment = await service.getById(id);
  if (!consignment) return c.notFound();

  const statements = new SettlementStatementService(
    c.env.DB,
    new ConfigService(c.env.DB, c.env.CACHE)
  );
  const pdf = await statements.pdfFor(id);
  if (!pdf) return c.notFound();

  return new Response(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${statementFilename(consignment.reference)}"`,
    },
  });
});

// GET /admin/consignments/:id/photos/:idx  (stream a lot photo)
admin.get('/consignments/:id/photos/:idx', requirePermission('consignments', 'view'), async (c) => {
  const { id, idx } = c.req.param();
  const service = new ConsignmentService(c.env.DB);
  const consignment = await service.getById(id);
  if (!consignment) return c.notFound();
  return streamConsignmentPhoto(c, consignment, idx);
});

// POST /admin/consignments/:id/forwarder-validate  (transitaire)
admin.post('/consignments/:id/forwarder-validate', requirePermission('consignments', 'update'), async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json().catch(() => ({}));
  const service = new ConsignmentService(c.env.DB);
  const r = await service.forwarderValidate(id, currentAdmin(c), body?.note);
  if (!r.ok) return consignmentError(c, r);
  return c.json({ success: true, data: r.consignment, requestId: crypto.randomUUID() });
});

// POST /admin/consignments/:id/transit  (transport started)
admin.post('/consignments/:id/transit', requirePermission('consignments', 'update'), async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json().catch(() => ({}));
  const service = new ConsignmentService(c.env.DB);
  const r = await service.startTransit(id, currentAdmin(c), body?.note);
  if (!r.ok) return consignmentError(c, r);
  return c.json({ success: true, data: r.consignment, requestId: crypto.randomUUID() });
});

// POST /admin/consignments/:id/arrive-dubai
admin.post('/consignments/:id/arrive-dubai', requirePermission('consignments', 'update'), async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json().catch(() => ({}));
  const service = new ConsignmentService(c.env.DB);
  const r = await service.arriveDubai(id, currentAdmin(c), body?.note);
  if (!r.ok) return consignmentError(c, r);
  return c.json({ success: true, data: r.consignment, requestId: crypto.randomUUID() });
});

// POST /admin/consignments/:id/audit-validate  (Dubai audit → allocate stock)
const auditValidateSchema = z.object({
  refinedWeightG: z.number().positive().max(1_000_000),
  refineryLot: z.string().max(128).optional(),
  lbmaCertificate: z.string().max(256).optional(),
});
admin.post('/consignments/:id/audit-validate', requirePermission('consignments', 'approve'), async (c) => {
  const { id } = c.req.param();
  const requestId = crypto.randomUUID();
  const parsed = auditValidateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message || 'Données invalides' }, requestId }, 400);
  }
  // Share of the refined weight paid to the producer in tokens (see 0018).
  const cfg = new ConfigService(c.env.DB, c.env.CACHE);
  const producerShare = await cfg.getNumber('consignment_producer_share', 1);
  const service = new ConsignmentService(c.env.DB);
  const r = await service.auditValidate(id, currentAdmin(c), { ...parsed.data, producerShare });
  if (!r.ok) return consignmentError(c, r);

  // The producer has just been paid in tokens — worth telling him, and one of
  // the few events that genuinely justifies interrupting someone.
  const credited = r.consignment.producer_tokens_credited;
  if (credited) {
    await notifyProducer(c, r.consignment.producer_id, {
      type: 'TRANSACTION',
      title: 'Lot validé et payé',
      body: `Votre lot ${r.consignment.reference} a été validé à Dubaï. ${credited} g ont été crédités en tokens sur votre portefeuille.`,
      data: { consignmentReference: r.consignment.reference, creditedGrams: String(credited) },
    });
  }

  return c.json({ success: true, data: r.consignment, requestId });
});

// POST /admin/consignments/:id/reject
admin.post('/consignments/:id/reject', requirePermission('consignments', 'reject'), async (c) => {
  const { id } = c.req.param();
  const requestId = crypto.randomUUID();
  const body = await c.req.json().catch(() => ({}));
  const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'Rejeté';
  const service = new ConsignmentService(c.env.DB);
  const r = await service.reject(id, currentAdmin(c), reason);
  if (!r.ok) return consignmentError(c, r);
  return c.json({ success: true, data: r.consignment, requestId });
});

export const adminRoutes = admin;
