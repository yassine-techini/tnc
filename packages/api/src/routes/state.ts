import { Hono, Context, Next } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types/env';
import { AuthService } from '../services/auth.service';
import { SecurityService } from '../services/security.service';
import { ConfigService } from '../services/config.service';
import { encryptTotpSecret, decryptTotpSecret } from '../lib/totp-secret';
import { isPortalToken } from '../lib/portal';

// Zod schemas for state endpoints
const StateLoginSchema = z.object({
  email: z.string().email('Email invalide'),
  password: z.string().min(1, 'Mot de passe requis'),
  totpCode: z.string().length(6).optional(),
});

const State2FASetupSchema = z.object({
  setupToken: z.string().uuid('Token invalide'),
});

const State2FAVerifySchema = z.object({
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

const state = new Hono<AppEnv>();

// JWT-based auth middleware for state portal
async function stateJwtMiddleware(c: Context<AppEnv>, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({
      success: false,
      error: {
        code: 'STATE_AUTH_REQUIRED',
        message: 'Authentification requise',
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

    // Same portal binding as the back-office: a customer or admin token must not
    // be usable here just because its email matches (see lib/portal).
    if (!isPortalToken(payload, 'state')) {
      return c.json({
        success: false,
        error: {
          code: 'STATE_ACCESS_DENIED',
          message: 'Accès portail État non autorisé',
        },
        requestId: crypto.randomUUID(),
      }, 403);
    }

    // Check if user has state operator role
    const stateUser = await c.env.DB
      .prepare('SELECT * FROM admins WHERE email = ? AND role = ? AND active = 1')
      .bind(payload.email, 'STATE_OPERATOR')
      .first<AdminRecord>();

    if (!stateUser) {
      return c.json({
        success: false,
        error: {
          code: 'STATE_ACCESS_DENIED',
          message: 'Accès portail État non autorisé',
        },
        requestId: crypto.randomUUID(),
      }, 403);
    }

    c.set('adminId', stateUser.id);
    c.set('adminEmail', payload.email);
    c.set('adminRole', 'STATE_OPERATOR');

    return next();
  } catch (error) {
    return c.json({
      success: false,
      error: {
        code: 'STATE_AUTH_FAILED',
        message: 'Authentification échouée',
      },
      requestId: crypto.randomUUID(),
    }, 401);
  }
}

// POST /state/login - State portal login with mandatory 2FA
state.post('/login', async (c) => {
  try {
    const body = await c.req.json();

    // Validate input with Zod
    const parseResult = StateLoginSchema.safeParse(body);
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

    // Find admin with STATE_OPERATOR role
    const stateUser = await c.env.DB
      .prepare('SELECT * FROM admins WHERE email = ? AND role = ? AND active = 1')
      .bind(email, 'STATE_OPERATOR')
      .first<AdminRecord>();

    if (!stateUser) {
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
    const passwordResult = await authService.verifyPasswordWithRehashCheck(password, stateUser.password_hash);

    if (!passwordResult.valid) {
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
        .bind(newHash, stateUser.id)
        .run();
    }

    // Check if 2FA is set up (mandatory for state portal)
    if (!stateUser.two_factor_secret) {
      // 2FA not set up - generate setup token and require setup
      const setupToken = crypto.randomUUID();
      await c.env.CACHE.put(
        `state_2fa_setup:${setupToken}`,
        JSON.stringify({ adminId: stateUser.id, email: stateUser.email }),
        { expirationTtl: 600 }
      );

      return c.json({
        success: false,
        error: {
          code: '2FA_SETUP_REQUIRED',
          message: 'Configuration 2FA obligatoire. Scannez le QR code pour activer.',
        },
        data: {
          setupToken,
          adminId: stateUser.id,
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
    const stateTotpSecret = await decryptTotpSecret(c.env.ENCRYPTION_KEY, stateUser.two_factor_secret);
    const isValidTotp = await securityService.verifyTotpCode(stateTotpSecret, totpCode, stateUser.id);

    if (!isValidTotp) {
      return c.json({
        success: false,
        error: {
          code: '2FA_INVALID',
          message: 'Code 2FA invalide',
        },
        requestId: crypto.randomUUID(),
      }, 401);
    }

    // Update last login
    await c.env.DB
      .prepare('UPDATE admins SET last_login_at = datetime(\'now\') WHERE id = ?')
      .bind(stateUser.id)
      .run();

    // Generate tokens
    const tokens = await authService.generateTokens({
      sub: stateUser.id,
      email: stateUser.email,
      kycLevel: 'VERIFIED',
      portal: 'state',
    });

    return c.json({
      success: true,
      data: {
        user: {
          id: stateUser.id,
          email: stateUser.email,
          name: stateUser.name,
          ministry: 'Ministère des Mines et des Carrières',
          twoFactorEnabled: true,
        },
        tokens,
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('State login error:', error);
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

// POST /state/2fa/setup - Generate 2FA setup (requires setup token)
state.post('/2fa/setup', async (c) => {
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
    const setupDataStr = await c.env.CACHE.get(`state_2fa_setup:${setupToken}`);
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
      `state_2fa_pending:${setupToken}`,
      JSON.stringify({ secret, adminId: setupData.adminId, email: setupData.email }),
      { expirationTtl: 600 }
    );

    return c.json({
      success: true,
      data: {
        secret,
        uri,
        issuer: 'TNC Portail État',
        message: 'Scannez le QR code avec votre application d\'authentification',
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('State 2FA setup error:', error);
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

// POST /state/2fa/verify - Verify and complete 2FA setup
state.post('/2fa/verify', async (c) => {
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
    const pendingDataStr = await c.env.CACHE.get(`state_2fa_pending:${setupToken}`);
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
    const encryptedStateSecret = await encryptTotpSecret(c.env.ENCRYPTION_KEY, pendingData.secret);
    await c.env.DB
      .prepare('UPDATE admins SET two_factor_secret = ?, two_factor_enabled = 1, updated_at = datetime("now") WHERE id = ?')
      .bind(encryptedStateSecret, pendingData.adminId)
      .run();

    // Clear setup tokens
    await c.env.CACHE.delete(`state_2fa_setup:${setupToken}`);
    await c.env.CACHE.delete(`state_2fa_pending:${setupToken}`);

    // Generate login tokens
    const authService = new AuthService(c.env.JWT_SECRET);
    const tokens = await authService.generateTokens({
      sub: pendingData.adminId,
      email: pendingData.email,
      kycLevel: 'VERIFIED',
      portal: 'state',
    });

    // Get admin details
    const stateUser = await c.env.DB
      .prepare('SELECT * FROM admins WHERE id = ?')
      .bind(pendingData.adminId)
      .first<AdminRecord>();

    return c.json({
      success: true,
      data: {
        message: '2FA activé avec succès',
        user: {
          id: pendingData.adminId,
          email: pendingData.email,
          name: stateUser?.name,
          ministry: 'Ministère des Mines et des Carrières',
          twoFactorEnabled: true,
        },
        tokens,
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('State 2FA verify error:', error);
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

// All following routes require state authentication
state.use('/*', stateJwtMiddleware);

// GET /state/dashboard - Overview for state portal
state.get('/dashboard', async (c) => {
  try {
    // Total users
    const totalUsersResult = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM users')
      .first<{ count: number }>();

    // Total tokens in circulation
    const totalTokensResult = await c.env.DB
      .prepare('SELECT COALESCE(SUM(token_balance), 0) as total FROM wallets')
      .first<{ total: number }>();

    // Total volume (all time)
    const totalVolumeResult = await c.env.DB
      .prepare(`SELECT COALESCE(SUM(cash_amount), 0) as total FROM transactions WHERE status = 'COMPLETED'`)
      .first<{ total: number }>();

    // Get stock info
    const stock = await c.env.DB
      .prepare('SELECT * FROM gold_stock ORDER BY updated_at DESC LIMIT 1')
      .first<any>();

    // Coverage ratio
    const coverageRatio = stock?.total_allocated
      ? (stock.total_allocated / (totalTokensResult?.total || 1))
      : 1;

    // Monthly transaction volume (current month)
    const monthlyVolumeResult = await c.env.DB
      .prepare(`SELECT COALESCE(SUM(cash_amount), 0) as total FROM transactions WHERE status = 'COMPLETED' AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`)
      .first<{ total: number }>();

    return c.json({
      success: true,
      data: {
        totalUsers: totalUsersResult?.count || 0,
        totalTokens: totalTokensResult?.total || 0,
        totalVolume: totalVolumeResult?.total || 0,
        goldAllocated: stock?.total_allocated || 0,
        // L'or PRÊTÉ, et donc absent du coffre. La page publique /reserve le
        // divulgue, l'attestation signée le divulgue, le certificat et le relevé
        // de règlement aussi — le portail de l'État était le seul à l'ignorer,
        // alors que c'est l'audience qui a alloué cet or.
        goldOnLoan: stock?.gold_on_loan || 0,
        goldVaulted: Math.max(0, (stock?.total_allocated || 0) - (stock?.gold_on_loan || 0)),
        fullyVaulted: (stock?.gold_on_loan || 0) === 0,
        coverageRatio,
        monthlyVolume: monthlyVolumeResult?.total || 0,
        lastUpdate: new Date().toISOString(),
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('State dashboard error:', error);
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

// GET /state/stock - Gold stock information
state.get('/stock', async (c) => {
  try {
    const stock = await c.env.DB
      .prepare('SELECT * FROM gold_stock ORDER BY updated_at DESC LIMIT 1')
      .first<any>();

    const tokensResult = await c.env.DB
      .prepare('SELECT COALESCE(SUM(token_balance), 0) as total FROM wallets')
      .first<{ total: number }>();

    const coverageRatio = stock?.total_allocated
      ? (stock.total_allocated / (tokensResult?.total || 1))
      : 1;

    return c.json({
      success: true,
      data: {
        totalAllocated: stock?.total_allocated || 0,
        tokensIssued: tokensResult?.total || 0,
        availableStock: (stock?.total_allocated || 0) - (tokensResult?.total || 0),
        // Alloué n'est pas détenu : la part prêtée est due par une contrepartie
        // et n'est pas physiquement en coffre.
        goldOnLoan: stock?.gold_on_loan || 0,
        goldVaulted: Math.max(0, (stock?.total_allocated || 0) - (stock?.gold_on_loan || 0)),
        fullyVaulted: (stock?.gold_on_loan || 0) === 0,
        lendingNotice:
          "Une partie de la réserve peut être prêtée pour financer le rendement de la location. L'or prêté reste dû à la plateforme mais n'est pas physiquement en coffre : la couverture correspondante dépend du remboursement de la contrepartie.",
        coverageRatio,
        lastAuditDate: stock?.last_audit_date,
        lastAuditResult: stock?.last_audit_result,
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('State stock error:', error);
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

// GET /state/reports/por - Proof of Reserve report
/**
 * GET /state/consignments — lot traceability.
 *
 * The RBAC map already granted STATE_OPERATOR `consignments: ['view','export']`;
 * only the endpoint was missing. This is the "certified route" the State is
 * meant to be able to inspect: where each lot came from, whether its origin was
 * device-verified or merely declared, and which origin documents back it.
 *
 * Deliberately withholds the producer's identity: the State supervises the
 * gold flow, not the individuals behind it. Aggregates and lot references only.
 */
state.get('/consignments', async (c) => {
  const requestId = crypto.randomUUID();
  const status = c.req.query('status');
  const page = Math.max(1, Math.floor(Number(c.req.query('page')) || 1));
  const limit = Math.min(100, Math.max(1, Math.floor(Number(c.req.query('limit')) || 25)));

  const where = status ? 'WHERE c.status = ?' : '';
  const binds: unknown[] = status ? [status] : [];

  const count = await c.env.DB
    .prepare(`SELECT COUNT(*) as c FROM gold_consignments c ${where}`)
    .bind(...binds)
    .first<{ c: number }>();

  const rows = await c.env.DB
    .prepare(
      `SELECT c.id, c.reference, c.status, c.weight_declared_g, c.purity_declared, c.gold_type,
              c.origin_country, c.origin_zone, c.origin_verified,
              c.origin_gps_lat, c.origin_gps_lng,
              c.refined_weight_g, c.audited_at, c.created_at,
              (SELECT COUNT(*) FROM consignment_documents d WHERE d.consignment_id = c.id) AS document_count
       FROM gold_consignments c
       ${where}
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...binds, limit, (page - 1) * limit)
    .all();

  return c.json({
    success: true,
    data: { items: rows.results || [], meta: { page, limit, total: count?.c || 0 } },
    requestId,
  });
});

// GET /state/consignments/:id — one lot, its trail and its origin documents
state.get('/consignments/:id', async (c) => {
  const requestId = crypto.randomUUID();
  const id = c.req.param('id');

  const consignment = await c.env.DB
    .prepare(
      `SELECT id, reference, status, weight_declared_g, purity_declared, gold_type,
              origin_country, origin_zone, origin_verified, origin_gps_lat, origin_gps_lng,
              refined_weight_g, refinery_lot, lbma_certificate, audited_at, created_at
       FROM gold_consignments WHERE id = ?`
    )
    .bind(id)
    .first();

  if (!consignment) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Lot non trouvé' }, requestId }, 404);
  }

  const events = await c.env.DB
    .prepare(
      `SELECT from_status, to_status, actor_role, note, created_at
       FROM consignment_events WHERE consignment_id = ? ORDER BY created_at ASC`
    )
    .bind(id)
    .all();

  // Metadata only: the State sees WHICH documents exist and who issued them,
  // not their contents, which stay encrypted at rest.
  const documents = await c.env.DB
    .prepare(
      `SELECT doc_type, issuer, reference, issued_at, created_at
       FROM consignment_documents WHERE consignment_id = ? ORDER BY created_at ASC`
    )
    .bind(id)
    .all();

  return c.json({
    success: true,
    data: { consignment, events: events.results || [], documents: documents.results || [] },
    requestId,
  });
});

state.get('/reports/por', async (c) => {
  try {
    const stock = await c.env.DB
      .prepare('SELECT * FROM gold_stock ORDER BY updated_at DESC LIMIT 1')
      .first<any>();

    const tokensResult = await c.env.DB
      .prepare('SELECT COALESCE(SUM(token_balance), 0) as total FROM wallets')
      .first<{ total: number }>();

    // Get wallet distribution
    const walletDistribution = await c.env.DB
      .prepare(`
        SELECT
          CASE
            WHEN token_balance = 0 THEN '0g'
            WHEN token_balance < 10 THEN '0-10g'
            WHEN token_balance < 100 THEN '10-100g'
            WHEN token_balance < 1000 THEN '100-1000g'
            ELSE '1000g+'
          END as range,
          COUNT(*) as count,
          COALESCE(SUM(token_balance), 0) as total
        FROM wallets
        GROUP BY range
        ORDER BY total DESC
      `)
      .all<any>();

    // Get transaction summary
    const transactionSummary = await c.env.DB
      .prepare(`
        SELECT
          type,
          COUNT(*) as count,
          COALESCE(SUM(cash_amount), 0) as total_cash,
          COALESCE(SUM(token_amount), 0) as total_tokens
        FROM transactions
        WHERE status = 'COMPLETED'
        GROUP BY type
      `)
      .all<any>();

    return c.json({
      success: true,
      data: {
        reportDate: new Date().toISOString(),
        goldAllocated: stock?.total_allocated || 0,
        tokensInCirculation: tokensResult?.total || 0,
        coverageRatio: stock?.total_allocated ? (stock.total_allocated / (tokensResult?.total || 1)) : 1,
        lastAuditDate: stock?.last_audit_date,
        lastAuditResult: stock?.last_audit_result,
        walletDistribution: walletDistribution.results || [],
        transactionSummary: transactionSummary.results || [],
        // Derived from real coverage + audit state, not hardcoded.
        certificationStatus: (stock?.total_allocated || 0) >= (tokensResult?.total || 0)
          ? (stock?.last_audit_date ? 'CERTIFIED' : 'PENDING_AUDIT')
          : 'UNDER_COLLATERALIZED',
      },
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

// GET /state/reports/monthly - Monthly report
state.get('/reports/monthly', async (c) => {
  try {
    const month = c.req.query('month') || new Date().toISOString().slice(0, 7);

    // Transaction stats for the month
    const txStats = await c.env.DB
      .prepare(`
        SELECT
          type,
          COUNT(*) as count,
          COALESCE(SUM(cash_amount), 0) as total_cash,
          COALESCE(SUM(token_amount), 0) as total_tokens,
          COALESCE(SUM(fees), 0) as total_fees
        FROM transactions
        WHERE status = 'COMPLETED' AND strftime('%Y-%m', created_at) = ?
        GROUP BY type
      `)
      .bind(month)
      .all<any>();

    // New users for the month
    const newUsersResult = await c.env.DB
      .prepare(`SELECT COUNT(*) as count FROM users WHERE strftime('%Y-%m', created_at) = ?`)
      .bind(month)
      .first<{ count: number }>();

    // KYC verifications for the month
    const kycStats = await c.env.DB
      .prepare(`
        SELECT kyc_level, COUNT(*) as count
        FROM users
        WHERE strftime('%Y-%m', updated_at) = ?
        GROUP BY kyc_level
      `)
      .bind(month)
      .all<any>();

    // Détenteurs ayant transigé dans le mois. Agrégat : un COMPTE de comptes
    // distincts, jamais une liste — le portail État ne voit pas qui.
    const activeUsersResult = await c.env.DB
      .prepare(`
        SELECT COUNT(DISTINCT user_id) as count
        FROM transactions
        WHERE status = 'COMPLETED' AND strftime('%Y-%m', created_at) = ?
      `)
      .bind(month)
      .first<{ count: number }>();

    // Cours moyen du mois, au comptant.
    const averagePriceResult = await c.env.DB
      .prepare(`
        SELECT AVG(price_xof) as avg
        FROM gold_prices
        WHERE strftime('%Y-%m', timestamp) = ?
      `)
      .bind(month)
      .first<{ avg: number | null }>();

    // Get current stock status
    const stock = await c.env.DB
      .prepare('SELECT * FROM gold_stock ORDER BY updated_at DESC LIMIT 1')
      .first<any>();

    const tokensResult = await c.env.DB
      .prepare('SELECT COALESCE(SUM(token_balance), 0) as total FROM wallets')
      .first<{ total: number }>();

    return c.json({
      success: true,
      data: {
        month,
        reportGeneratedAt: new Date().toISOString(),
        transactionStats: txStats.results || [],
        newUsers: newUsersResult?.count || 0,
        activeUsers: activeUsersResult?.count || 0,
        // null quand aucun prix n'a été relevé ce mois-là : l'écran affiche
        // « — », il n'invente pas un cours moyen de zéro.
        averagePrice: averagePriceResult?.avg ?? null,
        kycStats: kycStats.results || [],
        stockStatus: {
          goldAllocated: stock?.total_allocated || 0,
          tokensInCirculation: tokensResult?.total || 0,
          coverageRatio: stock?.total_allocated ? (stock.total_allocated / (tokensResult?.total || 1)) : 1,
        },
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('Monthly report error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors de la génération du rapport mensuel',
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// GET /state/price/history - Price history for charts
state.get('/price/history', async (c) => {
  try {
    // SECURITY: Validate days parameter with bounds (1-365)
    const days = Math.max(1, Math.min(365, parseInt(c.req.query('days') || '30', 10) || 30));

    const prices = await c.env.DB
      .prepare(`
        SELECT
          date(timestamp) as date,
          AVG(price_xof) as priceXof,
          SUM(CASE WHEN type IN ('BUY', 'SELL') THEN cash_amount ELSE 0 END) as volume
        FROM gold_prices gp
        LEFT JOIN transactions t ON date(gp.timestamp) = date(t.created_at) AND t.status = 'COMPLETED'
        WHERE gp.timestamp >= datetime('now', '-' || ? || ' days')
        GROUP BY date(gp.timestamp)
        ORDER BY date ASC
      `)
      .bind(days)
      .all<any>();

    return c.json({
      success: true,
      data: {
        items: prices.results || [],
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('Price history error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors du chargement de l\'historique des prix',
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// GET /state/transactions/stats - Transaction stats for charts
state.get('/transactions/stats', async (c) => {
  try {
    // SECURITY: Whitelist valid period values
    const validPeriods = ['day', 'week', 'month'] as const;
    const requestedPeriod = c.req.query('period') || 'month';
    const period = validPeriods.includes(requestedPeriod as typeof validPeriods[number])
      ? requestedPeriod
      : 'month';

    let dateFilter = "'-30 days'";
    if (period === 'week') dateFilter = "'-7 days'";
    if (period === 'day') dateFilter = "'-1 day'";

    const stats = await c.env.DB
      .prepare(`
        SELECT
          date(created_at) as date,
          SUM(CASE WHEN type = 'BUY' THEN 1 ELSE 0 END) as buyCount,
          SUM(CASE WHEN type = 'SELL' THEN 1 ELSE 0 END) as sellCount,
          SUM(CASE WHEN type = 'BUY' THEN cash_amount ELSE 0 END) as buyVolume,
          SUM(CASE WHEN type = 'SELL' THEN cash_amount ELSE 0 END) as sellVolume
        FROM transactions
        WHERE status = 'COMPLETED' AND created_at >= datetime('now', ${dateFilter})
        GROUP BY date(created_at)
        ORDER BY date ASC
      `)
      .all<any>();

    return c.json({
      success: true,
      data: {
        items: stats.results || [],
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('Transaction stats error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors du chargement des statistiques',
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

/**
 * Trace d'un export sortant du portail État.
 *
 * Un export quitte la plateforme : sans trace, personne ne peut dire qui a
 * emporté quoi ni quand. On enregistre l'appelant, les filtres et le VOLUME —
 * jamais les données elles-mêmes, sinon la piste d'audit deviendrait une
 * seconde copie de ce qu'elle est censée surveiller.
 *
 * Renvoie `false` si la trace n'a pas pu être écrite ; l'appelant décide.
 */
async function recordStateExport(
  c: Context<AppEnv>,
  p: { kind: string; rows: number; filters?: Record<string, unknown> }
): Promise<boolean> {
  try {
    await c.env.DB
      .prepare(
        `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at)
         VALUES (?, ?, 'STATE_EXPORT', 'state_export', ?, ?, datetime('now'))`
      )
      .bind(
        crypto.randomUUID(),
        c.get('adminId') ?? null,
        p.kind,
        JSON.stringify({
          kind: p.kind,
          rows: p.rows,
          filters: p.filters ?? {},
          operator: c.get('adminEmail') ?? null,
          // L'IP est celle vue par Cloudflare ; utile pour recouper avec la
          // liste d'adresses autorisées du portail.
          ip: c.req.header('CF-Connecting-IP') ?? null,
          userAgent: c.req.header('User-Agent')?.slice(0, 200) ?? null,
        })
      )
      .run();
    return true;
  } catch (error) {
    console.error('[State] Export audit write failed', String(error));
    return false;
  }
}

// GET /state/reports/por/export - Export PoR as PDF (returns JSON for now)
state.get('/reports/por/export', async (c) => {
  try {
    const stock = await c.env.DB
      .prepare('SELECT * FROM gold_stock ORDER BY updated_at DESC LIMIT 1')
      .first<any>();

    const tokensResult = await c.env.DB
      .prepare('SELECT COALESCE(SUM(token_balance), 0) as total FROM wallets')
      .first<{ total: number }>();

    const walletDistribution = await c.env.DB
      .prepare(`
        SELECT
          CASE
            WHEN token_balance = 0 THEN '0g'
            WHEN token_balance < 10 THEN '0-10g'
            WHEN token_balance < 100 THEN '10-100g'
            WHEN token_balance < 1000 THEN '100-1000g'
            ELSE '1000g+'
          END as range,
          COUNT(*) as count,
          COALESCE(SUM(token_balance), 0) as total
        FROM wallets
        GROUP BY range
      `)
      .all<any>();

    const report = {
      title: 'PROOF OF RESERVE - TNC TRADING',
      generatedAt: new Date().toISOString(),
      goldPhysical: stock?.total_allocated || 0,
      tokensIssued: tokensResult?.total || 0,
      coverageRatio: stock?.total_allocated ? (stock.total_allocated / (tokensResult?.total || 1)) : 1,
      // Derived from real coverage + audit state, not hardcoded.
      status: (stock?.total_allocated || 0) >= (tokensResult?.total || 0)
        ? (stock?.last_audit_date ? 'CERTIFIED' : 'PENDING_AUDIT')
        : 'UNDER_COLLATERALIZED',
      lastAudit: stock?.last_audit_date,
      walletDistribution: walletDistribution.results,
    };

    // Tracé sans bloquer : la preuve de réserve est de l'information publique
    // — la même est servie sans compte sur /reserve. Refuser de la remettre
    // parce qu'un journal n'a pas pu s'écrire serait disproportionné.
    await recordStateExport(c, { kind: 'por_report', rows: 1 });

    const reportJson = JSON.stringify(report, null, 2);
    return new Response(reportJson, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="por-report-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (error) {
    console.error('PoR export error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors de l\'export' },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// GET /state/reports/monthly/export - Export monthly report
state.get('/reports/monthly/export', async (c) => {
  try {
    const month = c.req.query('month') || new Date().toISOString().slice(0, 7);

    const txStats = await c.env.DB
      .prepare(`
        SELECT
          type,
          COUNT(*) as count,
          COALESCE(SUM(cash_amount), 0) as total_cash,
          COALESCE(SUM(token_amount), 0) as total_tokens,
          COALESCE(SUM(fees), 0) as total_fees
        FROM transactions
        WHERE status = 'COMPLETED' AND strftime('%Y-%m', created_at) = ?
        GROUP BY type
      `)
      .bind(month)
      .all<any>();

    const newUsersResult = await c.env.DB
      .prepare(`SELECT COUNT(*) as count FROM users WHERE strftime('%Y-%m', created_at) = ?`)
      .bind(month)
      .first<{ count: number }>();

    const report = {
      title: `RAPPORT MENSUEL - ${month}`,
      generatedAt: new Date().toISOString(),
      month,
      transactions: txStats.results,
      newUsers: newUsersResult?.count || 0,
    };

    // Agrégats mensuels : tracé sans bloquer, pour la même raison.
    await recordStateExport(c, {
      kind: 'monthly_report',
      rows: (txStats.results || []).length,
      filters: { month },
    });

    const reportJson = JSON.stringify(report, null, 2);
    return new Response(reportJson, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="monthly-report-${month}.json"`,
      },
    });
  } catch (error) {
    console.error('Monthly export error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors de l\'export' },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// GET /state/reports/data/export - Export raw data as CSV
state.get('/reports/data/export', async (c) => {
  try {
    const start = c.req.query('start');
    const end = c.req.query('end');

    let query = `
      SELECT
        t.id,
        t.type,
        t.status,
        t.token_amount,
        t.cash_amount,
        t.price_per_gram,
        t.fees,
        t.created_at,
        -- PAS d'adresse e-mail. Le portail État existe pour donner des
        -- agrégats ; cet export livrait un fichier NOMINATIF de qui détient de
        -- l'or dans le pays, ce que le cloisonnement des portails est censé
        -- empêcher (voir lib/portal.ts).
        --
        -- La référence ci-dessous est PSEUDONYME, pas anonyme : elle permet de
        -- regrouper les lignes d'un même détenteur — donc de compter des
        -- détenteurs distincts, ce dont une statistique a besoin — sans
        -- désigner personne. Le dire plutôt que de laisser croire à un
        -- anonymat qui n'existe pas.
        substr(t.user_id, 1, 8) AS holder_ref,
        u.kyc_level
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      WHERE t.status = 'COMPLETED'
    `;

    const params: string[] = [];
    if (start) {
      query += ' AND t.created_at >= ?';
      params.push(start);
    }
    if (end) {
      query += ' AND t.created_at <= ?';
      params.push(end);
    }

    const configService = new ConfigService(c.env.DB, c.env.CACHE);
    const rawExportLimit = await configService.getNumber('export_max_rows', 10000);
    // SECURITY: Clamp exportLimit to safe range [1, 100000] to prevent SQL injection
    const exportLimit = Math.max(1, Math.min(Math.floor(rawExportLimit), 100000));
    query += ` ORDER BY t.created_at DESC LIMIT ${exportLimit}`;

    const result = await c.env.DB.prepare(query).bind(...params).all<any>();
    const transactions = result.results || [];

    // FAIL-CLOSED, contrairement aux deux exports d'agrégats ci-dessus.
    //
    // Celui-ci sort des données transaction par transaction. Elles sont
    // pseudonymisées, mais leur volume et leur régularité en font une matière
    // sensible : un export qu'on ne peut pas tracer est un export dont personne
    // ne saura jamais qu'il a eu lieu. On préfère le refuser.
    if (!(await recordStateExport(c, {
      kind: 'transactions_csv',
      rows: transactions.length,
      filters: { start: start ?? null, end: end ?? null, limit: exportLimit },
    }))) {
      return c.json({
        success: false,
        error: {
          code: 'EXPORT_NOT_TRACEABLE',
          message: "Export impossible : la trace d'audit n'a pas pu être enregistrée",
        },
        requestId: crypto.randomUUID(),
      }, 503);
    }

    // Generate CSV
    const headers = ['ID', 'Type', 'Status', 'Token Amount', 'Cash Amount', 'Price/g', 'Fees', 'Created At', 'Holder Ref', 'KYC Level'];
    const rows = transactions.map((t: any) => [
      t.id,
      t.type,
      t.status,
      t.token_amount,
      t.cash_amount,
      t.price_per_gram,
      t.fees,
      t.created_at,
      t.holder_ref,
      t.kyc_level,
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map((cell: any) => `"${cell || ''}"`).join(',')),
    ].join('\n');

    return new Response('\ufeff' + csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="tnc-data-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    console.error('Data export error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors de l\'export' },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

export const stateRoutes = state;
