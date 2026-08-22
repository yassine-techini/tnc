import { Hono } from 'hono';
import type { AppEnv } from '../types/env';
import { AuthService } from '../services/auth.service';
import { ConfigService } from '../services/config.service';
import { texte } from '../lib/reponse-erreur';

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
    error: { code: 'UNAUTHORIZED', message: texte(c, 'UNAUTHORIZED') },
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
      error: { code: 'SETUP_DISABLED', message: texte(c, 'SETUP_DISABLED') },
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
          message: texte(c, 'ALREADY_INITIALIZED'),
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

    // Créer un compte qui peut valider un KYC, ajuster le stock national et
    // approuver un retrait ne laissait AUCUNE trace — alors que la purge du
    // registre épargnait explicitement `ADMIN_CREATED`, une action que personne
    // n'écrivait (ADR 014).
    //
    // Trace et création dans le MÊME lot : une trace écrite à part peut échouer
    // seule, et l'administrateur existerait alors sans que personne l'ait créé.
    const superAdminId = crypto.randomUUID();
    const stateOperatorId = crypto.randomUUID();

    const creerAdmin = (id: string, email: string, nom: string, role: string, hash: string) => [
      c.env.DB
        .prepare(`
          INSERT INTO admins (id, email, name, role, password_hash, active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        `)
        .bind(id, email, nom, role, hash),
      c.env.DB
        .prepare(`
          INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at)
          VALUES (?, NULL, 'ADMIN_CREATED', 'admin', ?, ?, datetime('now'))
        `)
        // `admin_id` est NULL : le bootstrap n'a pas d'auteur identifié, il est
        // porté par le secret d'installation. Le dire est plus honnête que de
        // s'attribuer l'action à soi-même.
        .bind(crypto.randomUUID(), id, JSON.stringify({ email, role, via: 'setup/init' })),
    ];

    await c.env.DB.batch([
      ...creerAdmin(superAdminId, 'admin@tnc-trading.com', 'Super Admin', 'SUPER_ADMIN', adminPasswordHash),
      ...creerAdmin(stateOperatorId, 'etat@mines.gov.bf', 'Ministère des Mines', 'STATE_OPERATOR', statePasswordHash),
    ]);

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
        message: texte(c, 'SETUP_FAILED'),
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
      error: { code: 'FORBIDDEN_IN_PRODUCTION', message: texte(c, 'FORBIDDEN_IN_PRODUCTION') },
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
        message: texte(c, 'SEED_FAILED'),
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
          message: texte(c, 'INVALID_INPUT'),
        },
        requestId: crypto.randomUUID(),
      }, 400);
    }

    const authService = new AuthService(c.env.JWT_SECRET);
    const passwordHash = await authService.hashPassword(newPassword);

    // Rendre l'accès à un compte d'administration est une action privilégiée, et
    // elle ne laissait aucune trace (ADR 014).
    //
    // La trace est gardée par la MÊME condition que la mise à jour : si aucun
    // administrateur ne porte cet e-mail, rien n'est écrit — ni le mot de passe,
    // ni une trace annonçant une réinitialisation qui n'a pas eu lieu.
    const resultats = await c.env.DB.batch([
      c.env.DB
        .prepare('UPDATE admins SET password_hash = ?, updated_at = datetime(\'now\') WHERE email = ?')
        .bind(passwordHash, email),
      c.env.DB
        .prepare(`
          INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at)
          SELECT ?, NULL, 'ADMIN_PASSWORD_RESET', 'admin', id, ?, datetime('now')
          FROM admins WHERE email = ?
        `)
        .bind(crypto.randomUUID(), JSON.stringify({ email, via: 'setup/reset-admin-password' }), email),
    ]);
    const result = resultats[0] as { meta: { changes: number } };

    if (result.meta.changes === 0) {
      return c.json({
        success: false,
        error: {
          code: 'ADMIN_NOT_FOUND',
          message: texte(c, 'ADMIN_NOT_FOUND'),
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
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

export const setupRoutes = setup;
