import { Hono } from 'hono';
import type { Env } from '../types/env';
import { AuthService } from '../services/auth.service';
import { PaymentService } from '../services/payment.service';
import { NotificationService } from '../services/notification.service';
import { ReconciliationService } from '../services/reconciliation.service';
import { requirePermission } from '../middleware/rbac';
import { resolvePermissions } from '../lib/rbac';
import { ConfigService } from '../services/config.service';

const admin = new Hono<{ Bindings: Env }>();

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
async function adminJwtMiddleware(c: any, next: any) {
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

    // Check if this is an admin (by email)
    const adminUser = await c.env.DB
      .prepare('SELECT * FROM admins WHERE email = ? AND active = 1')
      .bind(payload.email)
      .first();

    if (!adminUser) {
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

    await next();
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

// POST /admin/login - Admin login
admin.post('/login', async (c) => {
  try {
    const body = await c.req.json();
    const { email, password } = body;

    if (!email || !password) {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Email et mot de passe requis',
        },
        requestId: crypto.randomUUID(),
      }, 400);
    }

    // Find admin
    const adminUser = await c.env.DB
      .prepare('SELECT * FROM admins WHERE email = ? AND active = 1')
      .bind(email)
      .first<any>();

    if (!adminUser) {
      return c.json({
        success: false,
        error: {
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Email ou mot de passe incorrect',
        },
        requestId: crypto.randomUUID(),
      }, 401);
    }

    // Verify password
    const authService = new AuthService(c.env.JWT_SECRET);
    const isValid = await authService.verifyPassword(password, adminUser.password_hash);

    if (!isValid) {
      return c.json({
        success: false,
        error: {
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Email ou mot de passe incorrect',
        },
        requestId: crypto.randomUUID(),
      }, 401);
    }

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
      },
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

    let query = 'SELECT * FROM users';
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
      c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id),
      c.env.DB.prepare('SELECT * FROM wallets WHERE user_id = ?').bind(id),
      c.env.DB.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').bind(id),
      c.env.DB.prepare('SELECT * FROM kyc_documents WHERE user_id = ? ORDER BY created_at DESC').bind(id),
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
          verificationStatus: d.verification_status,
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
      .bind(crypto.randomUUID(), c.get('adminId'), `KYC_${action.toUpperCase()}`, 'user', id, JSON.stringify({ reason }))
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
      .prepare('SELECT * FROM kyc_documents WHERE id = ?')
      .bind(id)
      .first<any>();

    if (!doc) {
      doc = await c.env.DB
        .prepare('SELECT * FROM kyc_documents WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
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
      .prepare('SELECT id, verification_status, rejection_reason, created_at, verified_at FROM kyc_documents WHERE user_id = ? ORDER BY created_at DESC')
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
          status: d.verification_status,
          rejectionReason: d.rejection_reason,
          submittedAt: d.created_at,
          reviewedAt: d.verified_at,
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
      .prepare('SELECT * FROM kyc_documents WHERE id = ?')
      .bind(id)
      .first<any>();

    if (!doc) {
      doc = await c.env.DB
        .prepare('SELECT * FROM kyc_documents WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
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
        .prepare(`UPDATE kyc_documents SET verification_status = 'VERIFIED', verified_at = datetime('now') WHERE id = ?`)
        .bind(doc.id)
        .run();
    } else {
      // Reject
      await c.env.DB
        .prepare(`UPDATE users SET kyc_status = 'REJECTED', updated_at = datetime('now') WHERE id = ?`)
        .bind(userId)
        .run();

      await c.env.DB
        .prepare(`UPDATE kyc_documents SET verification_status = 'REJECTED', rejection_reason = ?, verified_at = datetime('now') WHERE id = ?`)
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
      .prepare('SELECT * FROM users WHERE id = ?')
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
      .prepare('SELECT * FROM users WHERE id = ?')
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
      },
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
    const suspendedUsers = await c.env.DB
      .prepare(`
        SELECT id, email, phone, suspended_at, suspended_until, suspension_reason, kyc_level
        FROM users
        WHERE suspended = 1
        ORDER BY suspended_at DESC
      `)
      .all<any>();

    return c.json({
      success: true,
      data: {
        items: suspendedUsers.results || [],
        total: suspendedUsers.results?.length || 0,
      },
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
      .prepare('SELECT * FROM gold_stock ORDER BY updated_at DESC LIMIT 1')
      .first<any>();

    // Get total tokens in circulation
    const tokensResult = await c.env.DB
      .prepare('SELECT COALESCE(SUM(token_balance), 0) as total FROM wallets')
      .first<{ total: number }>();

    return c.json({
      success: true,
      data: {
        totalAllocated: stock?.total_allocated || 0,
        tokensIssued: tokensResult?.total || 0,
        availableStock: (stock?.total_allocated || 0) - (tokensResult?.total || 0),
        lastAuditDate: stock?.last_audit_date,
        lastAuditResult: stock?.last_audit_result,
        coverage: stock?.total_allocated ? (tokensResult?.total || 0) / stock.total_allocated : 0,
      },
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

    if (typeof amount !== 'number') {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Montant invalide',
        },
        requestId: crypto.randomUUID(),
      }, 400);
    }

    // Get current stock
    let stock = await c.env.DB
      .prepare('SELECT * FROM gold_stock ORDER BY updated_at DESC LIMIT 1')
      .first<any>();

    const newTotal = (stock?.total_allocated || 0) + amount;

    if (stock) {
      await c.env.DB
        .prepare('UPDATE gold_stock SET total_allocated = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .bind(newTotal, stock.id)
        .run();
    } else {
      await c.env.DB
        .prepare('INSERT INTO gold_stock (id, total_allocated, tokens_issued, updated_at) VALUES (?, ?, 0, datetime(\'now\'))')
        .bind('main', newTotal)
        .run();
    }

    // Log admin action
    await c.env.DB
      .prepare('INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))')
      .bind(crypto.randomUUID(), c.get('adminId'), 'STOCK_ADJUST', 'stock', 'main', JSON.stringify({ amount, reason }))
      .run();

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
      await c.env.DB
        .prepare(`
          UPDATE transactions
          SET status = ?,
              external_reference = ?,
              completed_at = CASE WHEN ? = 'COMPLETED' THEN datetime('now') ELSE NULL END
          WHERE id = ?
        `)
        .bind(newStatus, payoutResult?.transactionId || null, newStatus, id)
        .run();

      // Update withdrawal record
      await c.env.DB
        .prepare(`
          UPDATE withdrawals
          SET status = ?, provider_reference = ?, processed_at = datetime('now')
          WHERE transaction_id = ?
        `)
        .bind(newStatus, payoutResult?.transactionId || 'MANUAL', id)
        .run();

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
      // Reject withdrawal - refund the amount to wallet
      await c.env.DB
        .prepare(`
          UPDATE wallets
          SET cash_balance = cash_balance + ?, updated_at = datetime('now')
          WHERE user_id = ?
        `)
        .bind(transaction.cash_amount, transaction.user_id)
        .run();

      // Update transaction status to CANCELLED
      await c.env.DB
        .prepare(`
          UPDATE transactions
          SET status = 'CANCELLED', failure_reason = ?, completed_at = datetime('now')
          WHERE id = ?
        `)
        .bind(reason || 'Rejeté par l\'administrateur', id)
        .run();

      // Update withdrawal record
      await c.env.DB
        .prepare(`
          UPDATE withdrawals
          SET status = 'CANCELLED', rejection_reason = ?, processed_at = datetime('now')
          WHERE transaction_id = ?
        `)
        .bind(reason || 'Rejeté', id)
        .run();

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
        `WITHDRAWAL_${action.toUpperCase()}`,
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
    // Get gold stock
    const stock = await c.env.DB
      .prepare('SELECT * FROM gold_stock ORDER BY updated_at DESC LIMIT 1')
      .first<any>();

    // Get total tokens in circulation
    const tokensResult = await c.env.DB
      .prepare('SELECT COALESCE(SUM(token_balance), 0) as total FROM wallets')
      .first<{ total: number }>();

    // Get wallet distribution by tier
    const walletDistribution = await c.env.DB
      .prepare(`
        SELECT
          CASE
            WHEN token_balance = 0 THEN 'empty'
            WHEN token_balance < 10 THEN 'small'
            WHEN token_balance < 100 THEN 'medium'
            WHEN token_balance < 1000 THEN 'large'
            ELSE 'whale'
          END as tier,
          COUNT(*) as count,
          COALESCE(SUM(token_balance), 0) as total_tokens
        FROM wallets
        GROUP BY tier
        ORDER BY total_tokens DESC
      `)
      .all<{ tier: string; count: number; total_tokens: number }>();

    // Get transaction summary (last 30 days)
    const transactionSummary = await c.env.DB
      .prepare(`
        SELECT
          type,
          COUNT(*) as count,
          COALESCE(SUM(cash_amount), 0) as total_amount,
          COALESCE(SUM(token_amount), 0) as total_tokens
        FROM transactions
        WHERE status = 'COMPLETED' AND created_at > datetime('now', '-30 days')
        GROUP BY type
      `)
      .all<{ type: string; count: number; total_amount: number; total_tokens: number }>();

    // Get user statistics
    const userStats = await c.env.DB
      .prepare(`
        SELECT
          kyc_level,
          COUNT(*) as count
        FROM users
        GROUP BY kyc_level
      `)
      .all<{ kyc_level: string; count: number }>();

    // Get total users with holdings
    const holdersResult = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM wallets WHERE token_balance > 0')
      .first<{ count: number }>();

    // Get average holding
    const avgHoldingResult = await c.env.DB
      .prepare('SELECT AVG(token_balance) as avg FROM wallets WHERE token_balance > 0')
      .first<{ avg: number }>();

    const goldAllocated = stock?.total_allocated || 0;
    const tokensInCirculation = tokensResult?.total || 0;

    return c.json({
      success: true,
      data: {
        reportDate: new Date().toISOString(),
        reportType: 'PROOF_OF_RESERVE',

        // Core PoR metrics
        goldAllocated,
        tokensInCirculation,
        availableStock: goldAllocated - tokensInCirculation,
        coverageRatio: tokensInCirculation > 0 ? goldAllocated / tokensInCirculation : 1,
        isCovered: goldAllocated >= tokensInCirculation,

        // Audit information
        lastAuditDate: stock?.last_audit_date,
        lastAuditResult: stock?.last_audit_result,

        // Wallet distribution
        walletDistribution: walletDistribution.results || [],
        totalHolders: holdersResult?.count || 0,
        averageHolding: avgHoldingResult?.avg || 0,

        // Transaction summary (30 days)
        transactionSummary: transactionSummary.results || [],

        // User breakdown by KYC level
        usersByKycLevel: userStats.results || [],

        // Certification status
        certificationStatus: {
          isFullyBacked: goldAllocated >= tokensInCirculation,
          coveragePercentage: tokensInCirculation > 0
            ? Math.round((goldAllocated / tokensInCirculation) * 10000) / 100
            : 100,
          lastVerified: stock?.last_audit_date || null,
          nextAuditDue: stock?.last_audit_date
            ? new Date(new Date(stock.last_audit_date).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
            : null,
        },
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

// ============================================
// RECONCILIATION ENDPOINTS
// ============================================

// GET /admin/reconciliation/stuck - Get stuck transactions
admin.get('/reconciliation/stuck', requirePermission('reconciliation', 'view'), async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const thresholdMinutes = parseInt(c.req.query('threshold') || '60');
    const reconciliationService = new ReconciliationService(c.env.DB);

    const stuckTransactions = await reconciliationService.getStuckTransactions(thresholdMinutes);

    return c.json({
      success: true,
      data: {
        items: stuckTransactions,
        total: stuckTransactions.length,
        thresholdMinutes,
      },
      requestId,
    });
  } catch (error) {
    console.error('Get stuck transactions error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors de la récupération des transactions bloquées',
      },
      requestId,
    }, 500);
  }
});

// GET /admin/reconciliation/pending - Get transactions pending reconciliation
admin.get('/reconciliation/pending', requirePermission('reconciliation', 'view'), async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const reconciliationService = new ReconciliationService(c.env.DB);
    const pendingTransactions = await reconciliationService.getPendingReconciliation();

    return c.json({
      success: true,
      data: {
        items: pendingTransactions,
        total: pendingTransactions.length,
      },
      requestId,
    });
  } catch (error) {
    console.error('Get pending reconciliation error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors de la récupération des transactions en attente',
      },
      requestId,
    }, 500);
  }
});

// POST /admin/reconciliation/transaction/:id - Reconcile a transaction
admin.post('/reconciliation/transaction/:id', requirePermission('reconciliation', 'update'), async (c) => {
  const requestId = crypto.randomUUID();
  const { id } = c.req.param();

  try {
    const body = await c.req.json();
    const { action, externalReference, reason } = body;

    if (!action || !['complete', 'fail', 'cancel'].includes(action)) {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_ACTION',
          message: 'Action invalide (complete, fail, cancel)',
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

    const reconciliationService = new ReconciliationService(c.env.DB, notificationService);
    const result = await reconciliationService.reconcileTransaction(
      id,
      action,
      externalReference,
      reason,
      c.get('adminId')
    );

    if (!result.reconciled) {
      return c.json({
        success: false,
        error: {
          code: 'RECONCILIATION_FAILED',
          message: result.message,
        },
        requestId,
      }, 400);
    }

    return c.json({
      success: true,
      data: result,
      requestId,
    });
  } catch (error) {
    console.error('Reconcile transaction error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors de la réconciliation',
      },
      requestId,
    }, 500);
  }
});

// GET /admin/reconciliation/report - Generate reconciliation report
admin.get('/reconciliation/report', requirePermission('reconciliation', 'view'), async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const periodStart = c.req.query('start') || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const periodEnd = c.req.query('end') || new Date().toISOString();

    const reconciliationService = new ReconciliationService(c.env.DB);
    const report = await reconciliationService.generateReport(periodStart, periodEnd);

    return c.json({
      success: true,
      data: report,
      requestId,
    });
  } catch (error) {
    console.error('Generate reconciliation report error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors de la génération du rapport',
      },
      requestId,
    }, 500);
  }
});

// GET /admin/reconciliation/discrepancies - Check wallet balance discrepancies
admin.get('/reconciliation/discrepancies', requirePermission('reconciliation', 'view'), async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const reconciliationService = new ReconciliationService(c.env.DB);
    const discrepancies = await reconciliationService.checkWalletDiscrepancies();

    return c.json({
      success: true,
      data: {
        items: discrepancies,
        total: discrepancies.length,
        hasDiscrepancies: discrepancies.length > 0,
      },
      requestId,
    });
  } catch (error) {
    console.error('Check discrepancies error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors de la vérification des écarts',
      },
      requestId,
    }, 500);
  }
});

// GET /admin/reconciliation/daily - Get daily transaction summary
admin.get('/reconciliation/daily', requirePermission('reconciliation', 'view'), async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const reconciliationService = new ReconciliationService(c.env.DB);
    const summary = await reconciliationService.getDailySummary();

    return c.json({
      success: true,
      data: summary,
      requestId,
    });
  } catch (error) {
    console.error('Get daily summary error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors de la récupération du résumé journalier',
      },
      requestId,
    }, 500);
  }
});

// POST /admin/reconciliation/bulk - Bulk reconcile multiple transactions
admin.post('/reconciliation/bulk', requirePermission('reconciliation', 'update'), async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const body = await c.req.json();
    const { transactions } = body;

    if (!Array.isArray(transactions) || transactions.length === 0) {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Liste de transactions requise',
        },
        requestId,
      }, 400);
    }

    if (transactions.length > 50) {
      return c.json({
        success: false,
        error: {
          code: 'TOO_MANY_TRANSACTIONS',
          message: 'Maximum 50 transactions par requête',
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

    const reconciliationService = new ReconciliationService(c.env.DB, notificationService);
    const results: any[] = [];

    for (const tx of transactions) {
      if (!tx.id || !tx.action) {
        results.push({
          transactionId: tx.id || 'unknown',
          reconciled: false,
          message: 'ID et action requis',
        });
        continue;
      }

      const result = await reconciliationService.reconcileTransaction(
        tx.id,
        tx.action,
        tx.externalReference,
        tx.reason,
        c.get('adminId')
      );

      results.push(result);
    }

    const successCount = results.filter(r => r.reconciled).length;
    const failCount = results.filter(r => !r.reconciled).length;

    return c.json({
      success: true,
      data: {
        results,
        summary: {
          total: results.length,
          succeeded: successCount,
          failed: failCount,
        },
      },
      requestId,
    });
  } catch (error) {
    console.error('Bulk reconciliation error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur lors de la réconciliation en masse',
      },
      requestId,
    }, 500);
  }
});

// ============================================
// ADMIN PERMISSIONS (current admin)
// ============================================

// GET /admin/me/permissions - Get current admin's resolved permissions
admin.get('/me/permissions', async (c) => {
  const requestId = crypto.randomUUID();
  try {
    const adminId = c.get('adminId' as never) as string;
    const adminRole = c.get('adminRole' as never) as string;
    const permissions = await resolvePermissions(c.env.DB, adminId, adminRole);
    return c.json({ success: true, data: { permissions }, requestId });
  } catch (error) {
    console.error('Get permissions error:', error);
    return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur' }, requestId }, 500);
  }
});

// ============================================
// ADMIN MANAGEMENT ENDPOINTS
// ============================================

// GET /admin/admins - List all admins
admin.get('/admins', requirePermission('admins', 'view'), async (c) => {
  const requestId = crypto.randomUUID();
  try {
    const admins = await c.env.DB
      .prepare('SELECT id, email, name, role, active, last_login_at, created_at FROM admins ORDER BY created_at DESC')
      .all<any>();

    return c.json({
      success: true,
      data: {
        items: (admins.results || []).map((a: any) => ({
          id: a.id,
          email: a.email,
          name: a.name,
          role: a.role,
          active: Boolean(a.active),
          lastLoginAt: a.last_login_at,
          createdAt: a.created_at,
        })),
      },
      requestId,
    });
  } catch (error) {
    console.error('List admins error:', error);
    return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur' }, requestId }, 500);
  }
});

// GET /admin/admins/:id - Get admin detail
admin.get('/admins/:id', requirePermission('admins', 'view'), async (c) => {
  const requestId = crypto.randomUUID();
  const { id } = c.req.param();

  try {
    const adminUser = await c.env.DB
      .prepare('SELECT id, email, name, role, active, last_login_at, created_at FROM admins WHERE id = ?')
      .bind(id)
      .first<any>();

    if (!adminUser) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Admin non trouvé' }, requestId }, 404);
    }

    // Get permission overrides
    const overrides = await c.env.DB
      .prepare('SELECT module, action, granted FROM admin_permissions WHERE admin_id = ?')
      .bind(id)
      .all<{ module: string; action: string; granted: number }>();

    // Resolve effective permissions
    const permissions = await resolvePermissions(c.env.DB, id, adminUser.role);

    return c.json({
      success: true,
      data: {
        id: adminUser.id,
        email: adminUser.email,
        name: adminUser.name,
        role: adminUser.role,
        active: Boolean(adminUser.active),
        lastLoginAt: adminUser.last_login_at,
        createdAt: adminUser.created_at,
        permissions,
        overrides: (overrides.results || []).map((o) => ({
          module: o.module,
          action: o.action,
          granted: Boolean(o.granted),
        })),
      },
      requestId,
    });
  } catch (error) {
    console.error('Admin detail error:', error);
    return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur' }, requestId }, 500);
  }
});

// POST /admin/admins - Create a new admin
admin.post('/admins', requirePermission('admins', 'create'), async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const body = await c.req.json();
    const { email, name, password, role } = body;

    if (!email || !password || !role) {
      return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'Email, mot de passe et rôle requis' }, requestId }, 400);
    }

    const validRoles = ['SUPER_ADMIN', 'ADMIN', 'KYC_REVIEWER', 'FINANCE', 'SUPPORT'];
    if (!validRoles.includes(role)) {
      return c.json({ success: false, error: { code: 'INVALID_ROLE', message: `Rôle invalide. Valeurs: ${validRoles.join(', ')}` }, requestId }, 400);
    }

    // Check duplicate
    const existing = await c.env.DB.prepare('SELECT id FROM admins WHERE email = ?').bind(email).first();
    if (existing) {
      return c.json({ success: false, error: { code: 'DUPLICATE_EMAIL', message: 'Cet email est déjà utilisé' }, requestId }, 409);
    }

    const authService = new AuthService(c.env.JWT_SECRET);
    const passwordHash = await authService.hashPassword(password);
    const id = crypto.randomUUID();

    await c.env.DB
      .prepare('INSERT INTO admins (id, email, name, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, ?, 1, datetime(\'now\'))')
      .bind(id, email, name || email.split('@')[0], passwordHash, role)
      .run();

    // Audit log
    await c.env.DB
      .prepare('INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at) VALUES (?, ?, \'ADMIN_CREATE\', \'admin\', ?, ?, datetime(\'now\'))')
      .bind(crypto.randomUUID(), c.get('adminId' as never), id, JSON.stringify({ email, role }))
      .run();

    return c.json({
      success: true,
      data: { id, email, name: name || email.split('@')[0], role },
      requestId,
    }, 201);
  } catch (error) {
    console.error('Create admin error:', error);
    return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur' }, requestId }, 500);
  }
});

// PATCH /admin/admins/:id - Update an admin (role, active, name)
admin.patch('/admins/:id', requirePermission('admins', 'update'), async (c) => {
  const requestId = crypto.randomUUID();
  const { id } = c.req.param();

  try {
    const body = await c.req.json();
    const { role, active, name } = body;

    const adminUser = await c.env.DB.prepare('SELECT * FROM admins WHERE id = ?').bind(id).first<any>();
    if (!adminUser) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Admin non trouvé' }, requestId }, 404);
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (role !== undefined) {
      const validRoles = ['SUPER_ADMIN', 'ADMIN', 'KYC_REVIEWER', 'FINANCE', 'SUPPORT'];
      if (!validRoles.includes(role)) {
        return c.json({ success: false, error: { code: 'INVALID_ROLE', message: 'Rôle invalide' }, requestId }, 400);
      }
      updates.push('role = ?');
      params.push(role);
    }
    if (active !== undefined) {
      updates.push('active = ?');
      params.push(active ? 1 : 0);
    }
    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }

    if (updates.length === 0) {
      return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'Aucune modification' }, requestId }, 400);
    }

    params.push(id);
    await c.env.DB
      .prepare(`UPDATE admins SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...params)
      .run();

    // Audit
    await c.env.DB
      .prepare('INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, old_value, new_value, created_at) VALUES (?, ?, \'ADMIN_UPDATE\', \'admin\', ?, ?, ?, datetime(\'now\'))')
      .bind(crypto.randomUUID(), c.get('adminId' as never), id, JSON.stringify({ role: adminUser.role, active: adminUser.active, name: adminUser.name }), JSON.stringify(body))
      .run();

    return c.json({ success: true, data: { message: 'Admin mis à jour' }, requestId });
  } catch (error) {
    console.error('Update admin error:', error);
    return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur' }, requestId }, 500);
  }
});

// DELETE /admin/admins/:id - Deactivate an admin
admin.delete('/admins/:id', requirePermission('admins', 'delete'), async (c) => {
  const requestId = crypto.randomUUID();
  const { id } = c.req.param();

  try {
    // Prevent self-deactivation
    if (id === (c.get('adminId' as never) as string)) {
      return c.json({ success: false, error: { code: 'SELF_DELETE', message: 'Impossible de se désactiver soi-même' }, requestId }, 400);
    }

    await c.env.DB.prepare('UPDATE admins SET active = 0 WHERE id = ?').bind(id).run();

    await c.env.DB
      .prepare('INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, created_at) VALUES (?, ?, \'ADMIN_DELETE\', \'admin\', ?, datetime(\'now\'))')
      .bind(crypto.randomUUID(), c.get('adminId' as never), id)
      .run();

    return c.json({ success: true, data: { message: 'Admin désactivé' }, requestId });
  } catch (error) {
    console.error('Delete admin error:', error);
    return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur' }, requestId }, 500);
  }
});

// GET /admin/admins/:id/permissions - Get admin permission overrides
admin.get('/admins/:id/permissions', requirePermission('admins', 'view'), async (c) => {
  const requestId = crypto.randomUUID();
  const { id } = c.req.param();

  try {
    const overrides = await c.env.DB
      .prepare('SELECT module, action, granted FROM admin_permissions WHERE admin_id = ?')
      .bind(id)
      .all<{ module: string; action: string; granted: number }>();

    return c.json({
      success: true,
      data: {
        overrides: (overrides.results || []).map((o) => ({
          module: o.module,
          action: o.action,
          granted: Boolean(o.granted),
        })),
      },
      requestId,
    });
  } catch (error) {
    console.error('Get permissions error:', error);
    return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur' }, requestId }, 500);
  }
});

// PUT /admin/admins/:id/permissions - Replace all permission overrides for an admin
admin.put('/admins/:id/permissions', requirePermission('admins', 'update'), async (c) => {
  const requestId = crypto.randomUUID();
  const { id } = c.req.param();

  try {
    const body = await c.req.json();
    const { overrides } = body; // Array of { module, action, granted }

    if (!Array.isArray(overrides)) {
      return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'overrides doit être un tableau' }, requestId }, 400);
    }

    // Delete existing overrides
    await c.env.DB.prepare('DELETE FROM admin_permissions WHERE admin_id = ?').bind(id).run();

    // Insert new overrides
    for (const o of overrides) {
      if (!o.module || !o.action || typeof o.granted !== 'boolean') continue;
      await c.env.DB
        .prepare('INSERT INTO admin_permissions (id, admin_id, module, action, granted, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))')
        .bind(crypto.randomUUID(), id, o.module, o.action, o.granted ? 1 : 0)
        .run();
    }

    // Audit
    await c.env.DB
      .prepare('INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at) VALUES (?, ?, \'PERMISSION_UPDATE\', \'admin\', ?, ?, datetime(\'now\'))')
      .bind(crypto.randomUUID(), c.get('adminId' as never), id, JSON.stringify(overrides))
      .run();

    return c.json({ success: true, data: { message: 'Permissions mises à jour' }, requestId });
  } catch (error) {
    console.error('Update permissions error:', error);
    return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur' }, requestId }, 500);
  }
});

// ============================================
// INTEGRATIONS ENDPOINTS
// ============================================

// GET /admin/integrations - List all integrations
admin.get('/integrations', requirePermission('integrations', 'view'), async (c) => {
  const requestId = crypto.randomUUID();
  try {
    const integrations = await c.env.DB
      .prepare('SELECT * FROM integrations ORDER BY category, display_name')
      .all<any>();

    const items = (integrations.results || []).map((i: any) => ({
      id: i.id,
      provider: i.provider,
      displayName: i.display_name,
      category: i.category,
      enabled: Boolean(i.enabled),
      config: JSON.parse(i.config || '{}'),
      lastTestedAt: i.last_tested_at,
      lastTestResult: i.last_test_result,
      updatedAt: i.updated_at,
    }));

    return c.json({ success: true, data: { items }, requestId });
  } catch (error) {
    console.error('List integrations error:', error);
    return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur' }, requestId }, 500);
  }
});

// GET /admin/integrations/:provider - Get integration detail
admin.get('/integrations/:provider', requirePermission('integrations', 'view'), async (c) => {
  const requestId = crypto.randomUUID();
  const { provider } = c.req.param();

  try {
    const integration = await c.env.DB
      .prepare('SELECT * FROM integrations WHERE provider = ?')
      .bind(provider)
      .first<any>();

    if (!integration) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Intégration non trouvée' }, requestId }, 404);
    }

    // Map provider to env var names (for display — do NOT expose values)
    const secretEnvVars: Record<string, string[]> = {
      orange_money: ['ORANGE_MONEY_API_KEY', 'ORANGE_MONEY_MERCHANT_ID'],
      moov_money: ['MOOV_MONEY_API_KEY', 'MOOV_MERCHANT_ID'],
      cinetpay: ['CINETPAY_API_KEY', 'CINETPAY_SITE_ID'],
      stripe: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
      twilio: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'],
      resend: ['RESEND_API_KEY'],
      sendgrid: ['SENDGRID_API_KEY'],
      fcm: ['FCM_SERVER_KEY'],
      smile_identity: ['SMILE_IDENTITY_API_KEY', 'SMILE_IDENTITY_PARTNER_ID'],
      gold_api: ['GOLD_API_KEY'],
    };

    // Check which secrets are configured (non-empty in env)
    const envVars = secretEnvVars[provider] || [];
    const secretsStatus: Record<string, boolean> = {};
    for (const key of envVars) {
      secretsStatus[key] = Boolean((c.env as any)[key]);
    }

    return c.json({
      success: true,
      data: {
        id: integration.id,
        provider: integration.provider,
        displayName: integration.display_name,
        category: integration.category,
        enabled: Boolean(integration.enabled),
        config: JSON.parse(integration.config || '{}'),
        lastTestedAt: integration.last_tested_at,
        lastTestResult: integration.last_test_result,
        updatedAt: integration.updated_at,
        secretsStatus,
      },
      requestId,
    });
  } catch (error) {
    console.error('Integration detail error:', error);
    return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur' }, requestId }, 500);
  }
});

// PATCH /admin/integrations/:provider - Update integration config + enabled
admin.patch('/integrations/:provider', requirePermission('integrations', 'update'), async (c) => {
  const requestId = crypto.randomUUID();
  const { provider } = c.req.param();

  try {
    const body = await c.req.json();
    const { enabled, config } = body;

    const integration = await c.env.DB
      .prepare('SELECT * FROM integrations WHERE provider = ?')
      .bind(provider)
      .first<any>();

    if (!integration) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Intégration non trouvée' }, requestId }, 404);
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (enabled !== undefined) {
      updates.push('enabled = ?');
      params.push(enabled ? 1 : 0);
    }
    if (config !== undefined) {
      updates.push('config = ?');
      params.push(JSON.stringify(config));
    }

    updates.push('updated_at = datetime(\'now\')');
    updates.push('updated_by = ?');
    params.push(c.get('adminId' as never));
    params.push(provider);

    await c.env.DB
      .prepare(`UPDATE integrations SET ${updates.join(', ')} WHERE provider = ?`)
      .bind(...params)
      .run();

    // Audit
    await c.env.DB
      .prepare('INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, old_value, new_value, created_at) VALUES (?, ?, \'INTEGRATION_UPDATE\', \'integration\', ?, ?, ?, datetime(\'now\'))')
      .bind(
        crypto.randomUUID(),
        c.get('adminId' as never),
        provider,
        JSON.stringify({ enabled: Boolean(integration.enabled), config: JSON.parse(integration.config || '{}') }),
        JSON.stringify(body)
      )
      .run();

    return c.json({ success: true, data: { message: 'Intégration mise à jour' }, requestId });
  } catch (error) {
    console.error('Update integration error:', error);
    return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur' }, requestId }, 500);
  }
});

// POST /admin/integrations/:provider/test - Test integration connection
admin.post('/integrations/:provider/test', requirePermission('integrations', 'update'), async (c) => {
  const requestId = crypto.randomUUID();
  const { provider } = c.req.param();

  try {
    const integration = await c.env.DB
      .prepare('SELECT * FROM integrations WHERE provider = ?')
      .bind(provider)
      .first<any>();

    if (!integration) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Intégration non trouvée' }, requestId }, 404);
    }

    let testResult: { success: boolean; message: string } = { success: false, message: 'Test non implémenté pour ce provider' };

    // Provider-specific connection tests
    switch (provider) {
      case 'stripe': {
        const key = c.env.STRIPE_SECRET_KEY;
        if (!key) { testResult = { success: false, message: 'STRIPE_SECRET_KEY non configurée' }; break; }
        try {
          const res = await fetch('https://api.stripe.com/v1/balance', {
            headers: { Authorization: `Bearer ${key}` },
          });
          testResult = res.ok
            ? { success: true, message: 'Connexion Stripe OK' }
            : { success: false, message: `Stripe erreur: ${res.status}` };
        } catch (e: any) {
          testResult = { success: false, message: `Stripe: ${e.message}` };
        }
        break;
      }
      case 'gold_api': {
        const key = c.env.GOLD_API_KEY;
        if (!key) { testResult = { success: false, message: 'GOLD_API_KEY non configurée' }; break; }
        try {
          const res = await fetch('https://www.goldapi.io/api/XAU/USD', {
            headers: { 'x-access-token': key },
          });
          testResult = res.ok
            ? { success: true, message: 'Connexion GoldAPI OK' }
            : { success: false, message: `GoldAPI erreur: ${res.status}` };
        } catch (e: any) {
          testResult = { success: false, message: `GoldAPI: ${e.message}` };
        }
        break;
      }
      case 'resend': {
        const key = c.env.RESEND_API_KEY;
        if (!key) { testResult = { success: false, message: 'RESEND_API_KEY non configurée' }; break; }
        try {
          const res = await fetch('https://api.resend.com/api-keys', {
            headers: { Authorization: `Bearer ${key}` },
          });
          testResult = res.ok
            ? { success: true, message: 'Connexion Resend OK' }
            : { success: false, message: `Resend erreur: ${res.status}` };
        } catch (e: any) {
          testResult = { success: false, message: `Resend: ${e.message}` };
        }
        break;
      }
      case 'twilio': {
        const sid = c.env.TWILIO_ACCOUNT_SID;
        const token = c.env.TWILIO_AUTH_TOKEN;
        if (!sid || !token) { testResult = { success: false, message: 'TWILIO credentials non configurées' }; break; }
        try {
          const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
            headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}` },
          });
          testResult = res.ok
            ? { success: true, message: 'Connexion Twilio OK' }
            : { success: false, message: `Twilio erreur: ${res.status}` };
        } catch (e: any) {
          testResult = { success: false, message: `Twilio: ${e.message}` };
        }
        break;
      }
      case 'sendgrid': {
        const key = c.env.SENDGRID_API_KEY;
        if (!key) { testResult = { success: false, message: 'SENDGRID_API_KEY non configurée' }; break; }
        try {
          const res = await fetch('https://api.sendgrid.com/v3/scopes', {
            headers: { Authorization: `Bearer ${key}` },
          });
          testResult = res.ok
            ? { success: true, message: 'Connexion SendGrid OK' }
            : { success: false, message: `SendGrid erreur: ${res.status}` };
        } catch (e: any) {
          testResult = { success: false, message: `SendGrid: ${e.message}` };
        }
        break;
      }
      default: {
        // For providers without a test endpoint, check if required config fields are non-empty
        const config = JSON.parse(integration.config || '{}');
        const hasConfig = Object.values(config).some((v: any) => v && String(v).length > 0);
        testResult = hasConfig
          ? { success: true, message: 'Configuration présente (test de connexion non disponible)' }
          : { success: false, message: 'Configuration vide' };
      }
    }

    // Update test result in DB
    await c.env.DB
      .prepare('UPDATE integrations SET last_tested_at = datetime(\'now\'), last_test_result = ? WHERE provider = ?')
      .bind(testResult.success ? 'success' : 'error', provider)
      .run();

    return c.json({
      success: true,
      data: {
        provider,
        testResult: testResult.success ? 'success' : 'error',
        message: testResult.message,
        testedAt: new Date().toISOString(),
      },
      requestId,
    });
  } catch (error) {
    console.error('Test integration error:', error);
    return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur' }, requestId }, 500);
  }
});

// ============================================
// CONFIG MANAGEMENT
// ============================================

// GET /admin/config - List all platform configuration
admin.get('/config', requirePermission('integrations', 'view'), async (c) => {
  const requestId = crypto.randomUUID();
  try {
    const configService = new ConfigService(c.env.DB, c.env.CACHE);
    const items = await configService.getAll();

    return c.json({
      success: true,
      data: { items },
      requestId,
    });
  } catch (error) {
    console.error('List config error:', error);
    return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur' }, requestId }, 500);
  }
});

// PATCH /admin/config/:key - Update a config value
admin.patch('/config/:key', requirePermission('integrations', 'update'), async (c) => {
  const requestId = crypto.randomUUID();
  try {
    const key = c.req.param('key');
    const body = await c.req.json<{ value: string }>();

    if (!body.value && body.value !== '0' && body.value !== '') {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Le champ value est requis' }, requestId }, 400);
    }

    const configService = new ConfigService(c.env.DB, c.env.CACHE);

    // Verify the key exists
    const existing = await c.env.DB
      .prepare('SELECT key FROM config WHERE key = ?')
      .bind(key)
      .first();

    if (!existing) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Clé de configuration non trouvée' }, requestId }, 404);
    }

    const adminId = c.get('adminId' as never) as string;
    await configService.set(key, String(body.value), undefined, adminId);

    // Audit log
    try {
      await c.env.DB.prepare(
        `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, ip_address, created_at)
         VALUES (?, ?, 'CONFIG_UPDATE', 'config', ?, ?, ?, datetime('now'))`
      ).bind(
        crypto.randomUUID(),
        adminId,
        key,
        JSON.stringify({ key, value: body.value }),
        c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
      ).run();
    } catch { /* non-blocking */ }

    return c.json({
      success: true,
      data: { key, value: body.value },
      requestId,
    });
  } catch (error) {
    console.error('Update config error:', error);
    return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur' }, requestId }, 500);
  }
});

export const adminRoutes = admin;
