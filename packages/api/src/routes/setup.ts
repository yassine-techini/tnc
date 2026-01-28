import { Hono } from 'hono';
import type { Env } from '../types/env';
import { AuthService } from '../services/auth.service';
import { ConfigService } from '../services/config.service';

const setup = new Hono<{ Bindings: Env }>();

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

    // Hash default passwords (no special characters for shell compatibility)
    const adminPasswordHash = await authService.hashPassword('AdminPass2024');
    const statePasswordHash = await authService.hashPassword('StatePass2024');

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

    // Initialize gold stock if not exists
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
      message: 'Initialisation réussie',
      data: {
        admins: [
          { email: 'admin@tnc-trading.com', password: 'AdminPass2024', role: 'SUPER_ADMIN' },
          { email: 'etat@mines.gov.bf', password: 'StatePass2024', role: 'STATE_OPERATOR' },
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
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// POST /setup/seed-demo - Seed demo users for testing
setup.post('/seed-demo', async (c) => {
  try {
    const authService = new AuthService(c.env.JWT_SECRET);

    // Demo password for all demo accounts
    const demoPasswordHash = await authService.hashPassword('DemoPass2024');

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
          await authService.hashPassword('StatePass2024')
        )
        .run();
    }

    return c.json({
      success: true,
      message: 'Comptes demo créés avec succès',
      data: {
        users: createdUsers,
        credentials: {
          webApp: {
            password: 'DemoPass2024',
            users: demoUsers.map(u => ({ email: u.email, kycLevel: u.kycLevel })),
          },
          admin: { email: 'admin@tnc-trading.com', password: 'AdminPass2024' },
          statePortal: [
            { email: 'etat@mines.gov.bf', password: 'StatePass2024' },
            { email: 'etat@finances.gov.bf', password: 'StatePass2024' },
          ],
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
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// POST /setup/reset-admin-password - Reset admin password (requires secret key)
setup.post('/reset-admin-password', async (c) => {
  try {
    const body = await c.req.json();
    const { email, newPassword, secretKey } = body;

    // Verify secret key (use JWT_SECRET as the setup key)
    if (secretKey !== c.env.JWT_SECRET) {
      return c.json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Clé secrète invalide',
        },
        requestId: crypto.randomUUID(),
      }, 403);
    }

    if (!email || !newPassword) {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Email et nouveau mot de passe requis',
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
