import { Hono } from 'hono';
import type { AppEnv } from '../types/env';
import { AuthService } from '../services/auth.service';
import { ConfigService } from '../services/config.service';

const setup = new Hono<AppEnv>();

/**
 * Constant-time string comparison to avoid leaking the setup secret via timing.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Generate a cryptographically strong random password (URL-safe, no ambiguous chars).
 */
function generatePassword(length = 24): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function unauthorized(c: any) {
  return c.json({
    success: false,
    error: { code: 'UNAUTHORIZED', message: 'Accès refusé' },
    requestId: crypto.randomUUID(),
  }, 403);
}

/**
 * Gate ALL setup routes behind a dedicated bootstrap secret.
 * - If SETUP_SECRET is not configured, setup is disabled entirely (fail-closed).
 * - The caller must present the secret via the `x-setup-token` header.
 * This replaces the previous design where these routes were fully public and
 * reused JWT_SECRET, allowing anonymous super-admin takeover.
 */
setup.use('*', async (c, next) => {
  const configured = c.env.SETUP_SECRET;
  if (!configured || configured.length < 16) {
    return c.json({
      success: false,
      error: { code: 'SETUP_DISABLED', message: 'Setup non disponible' },
      requestId: crypto.randomUUID(),
    }, 404);
  }
  const provided = c.req.header('x-setup-token') ?? '';
  if (!timingSafeEqual(provided, configured)) {
    return unauthorized(c);
  }
  await next();
});

// POST /setup/init - Initialize admin users (only works once)
setup.post('/init', async (c) => {
  try {
    // Check if admins already exist
    const existingAdmin = await c.env.DB
      .prepare('SELECT id FROM admins LIMIT 1')
      .first();

    if (existingAdmin) {
      return c.json({
        success: false,
        error: {
          code: 'ALREADY_INITIALIZED',
          message: 'Les administrateurs sont déjà initialisés',
        },
        requestId: crypto.randomUUID(),
      }, 400);
    }

    const authService = new AuthService(c.env.JWT_SECRET);

    // Passwords come from secrets when provided, otherwise are generated and
    // returned exactly once (the response is the only place they ever appear in
    // plaintext). They are never hardcoded.
    const adminPassword = c.env.SETUP_ADMIN_PASSWORD || generatePassword();
    const statePassword = c.env.SETUP_STATE_PASSWORD || generatePassword();
    const adminPasswordHash = await authService.hashPassword(adminPassword);
    const statePasswordHash = await authService.hashPassword(statePassword);

    // Insert super admin
    await c.env.DB
      .prepare(`
        INSERT INTO admins (id, email, name, role, password_hash, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
      `)
      .bind(
        crypto.randomUUID(),
        'admin@tnc-trading.com',
        'Super Admin',
        'SUPER_ADMIN',
        adminPasswordHash
      )
      .run();

    // Insert state operator
    await c.env.DB
      .prepare(`
        INSERT INTO admins (id, email, name, role, password_hash, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
      `)
      .bind(
        crypto.randomUUID(),
        'etat@mines.gov.bf',
        'Ministère des Mines',
        'STATE_OPERATOR',
        statePasswordHash
      )
      .run();

    // Initialize gold stock if not exists (canonical singleton id 'main')
    const existingStock = await c.env.DB
      .prepare('SELECT id FROM gold_stock LIMIT 1')
      .first();

    if (!existingStock) {
      const configService = new ConfigService(c.env.DB, c.env.CACHE);
      const initialGoldStock = await configService.getNumber('initial_gold_stock', 10000);
      await c.env.DB
        .prepare(`
          INSERT INTO gold_stock (id, total_allocated, tokens_issued, updated_at)
          VALUES ('main', ?, 0, datetime('now'))
        `)
        .bind(initialGoldStock)
        .run();
    }

    return c.json({
      success: true,
      message: 'Initialisation réussie. Conservez ces mots de passe : ils ne seront plus jamais affichés.',
      data: {
        admins: [
          { email: 'admin@tnc-trading.com', password: adminPassword, role: 'SUPER_ADMIN' },
          { email: 'etat@mines.gov.bf', password: statePassword, role: 'STATE_OPERATOR' },
        ],
        goldStock: {
          totalAllocated: 'configured via initial_gold_stock',
          tokensIssued: 0,
        },
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('Setup error:', error);
    return c.json({
      success: false,
      error: {
        code: 'SETUP_FAILED',
        message: 'Erreur lors de l\'initialisation',
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// POST /setup/seed-demo - Seed demo users for testing (non-production only)
setup.post('/seed-demo', async (c) => {
  if (c.env.ENVIRONMENT === 'production') {
    return c.json({
      success: false,
      error: { code: 'FORBIDDEN_IN_PRODUCTION', message: 'Seeding interdit en production' },
      requestId: crypto.randomUUID(),
    }, 403);
  }
  try {
    const authService = new AuthService(c.env.JWT_SECRET);

    // Demo password from secret, or generated once and returned in the response.
    const demoPassword = c.env.SETUP_DEMO_PASSWORD || generatePassword();
    const demoPasswordHash = await authService.hashPassword(demoPassword);

    // Demo users for web app
    const demoUsers = [
      { email: 'demo.basic@tnc-trading.bf', phone: '+22670000001', kycLevel: 'BASIC' },
      { email: 'demo.standard@tnc-trading.bf', phone: '+22670000002', kycLevel: 'STANDARD' },
      { email: 'demo.verified@tnc-trading.bf', phone: '+22670000003', kycLevel: 'VERIFIED' },
    ];

    const createdUsers = [];

    for (const demoUser of demoUsers) {
      // Check if user already exists
      const existing = await c.env.DB
        .prepare('SELECT id FROM users WHERE email = ?')
        .bind(demoUser.email)
        .first();

      if (existing) {
        createdUsers.push({ email: demoUser.email, status: 'already_exists' });
        continue;
      }

      const userId = crypto.randomUUID();
      const walletId = crypto.randomUUID();

      // Create user
      await c.env.DB
        .prepare(`
          INSERT INTO users (id, email, phone, password_hash, country, kyc_level, kyc_status, email_verified, phone_verified, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'BF', ?, 'APPROVED', 1, 1, datetime('now'), datetime('now'))
        `)
        .bind(userId, demoUser.email, demoUser.phone, demoPasswordHash, demoUser.kycLevel)
        .run();

      // Create wallet with some balance (configurable demo amounts)
      const configSvc = new ConfigService(c.env.DB, c.env.CACHE);
      const demoTokenVerified = await configSvc.getNumber('demo_token_balance_verified', 100);
      const demoTokenStandard = await configSvc.getNumber('demo_token_balance_standard', 50);
      const demoTokenBasic = await configSvc.getNumber('demo_token_balance_basic', 10);
      const demoCashVerified = await configSvc.getNumber('demo_cash_balance_verified', 500000);
      const demoCashStandard = await configSvc.getNumber('demo_cash_balance_standard', 250000);
      const demoCashBasic = await configSvc.getNumber('demo_cash_balance_basic', 50000);
      const tokenBalance = demoUser.kycLevel === 'VERIFIED' ? demoTokenVerified : (demoUser.kycLevel === 'STANDARD' ? demoTokenStandard : demoTokenBasic);
      const cashBalance = demoUser.kycLevel === 'VERIFIED' ? demoCashVerified : (demoUser.kycLevel === 'STANDARD' ? demoCashStandard : demoCashBasic);

      await c.env.DB
        .prepare(`
          INSERT INTO wallets (id, user_id, token_balance, cash_balance, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        `)
        .bind(walletId, userId, tokenBalance, cashBalance)
        .run();

      createdUsers.push({ email: demoUser.email, status: 'created', kycLevel: demoUser.kycLevel });
    }

    // Add additional state operator if not exists
    const existingFinances = await c.env.DB
      .prepare('SELECT id FROM admins WHERE email = ?')
      .bind('etat@finances.gov.bf')
      .first();

    if (!existingFinances) {
      await c.env.DB
        .prepare(`
          INSERT INTO admins (id, email, name, role, password_hash, active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        `)
        .bind(
          crypto.randomUUID(),
          'etat@finances.gov.bf',
          'Ministère des Finances',
          'STATE_OPERATOR',
          demoPasswordHash
        )
        .run();
    }

    return c.json({
      success: true,
      message: 'Comptes demo créés avec succès',
      data: {
        users: createdUsers,
        credentials: {
          password: demoPassword,
          note: 'Mot de passe partagé pour tous les comptes demo/état seedés. Affiché une seule fois.',
          webApp: demoUsers.map(u => ({ email: u.email, kycLevel: u.kycLevel })),
          statePortal: ['etat@finances.gov.bf'],
        },
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('Seed demo error:', error);
    return c.json({
      success: false,
      error: {
        code: 'SEED_FAILED',
        message: 'Erreur lors du seeding',
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// POST /setup/reset-admin-password - Reset admin password (gated by SETUP_SECRET)
setup.post('/reset-admin-password', async (c) => {
  try {
    const body = await c.req.json();
    const { email, newPassword } = body;

    if (!email || !newPassword || typeof newPassword !== 'string' || newPassword.length < 12) {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Email et nouveau mot de passe (≥12 caractères) requis',
        },
        requestId: crypto.randomUUID(),
      }, 400);
    }

    const authService = new AuthService(c.env.JWT_SECRET);
    const passwordHash = await authService.hashPassword(newPassword);

    const result = await c.env.DB
      .prepare('UPDATE admins SET password_hash = ?, updated_at = datetime(\'now\') WHERE email = ?')
      .bind(passwordHash, email)
      .run();

    if (result.meta.changes === 0) {
      return c.json({
        success: false,
        error: {
          code: 'ADMIN_NOT_FOUND',
          message: 'Administrateur non trouvé',
        },
        requestId: crypto.randomUUID(),
      }, 404);
    }

    return c.json({
      success: true,
      message: 'Mot de passe mis à jour',
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('Reset password error:', error);
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

export const setupRoutes = setup;
