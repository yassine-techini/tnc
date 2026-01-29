/**
 * Admin Analytics Routes
 * Real-time metrics, log search, and alert management
 */

import { Hono } from 'hono';
import type { AppEnv } from '../../types/env';
import { requirePermission } from '../../middleware/rbac';
import { LogArchiverService } from '../../services/log-archiver.service';

const analytics = new Hono<AppEnv>();

// ============================================
// REAL-TIME METRICS (via Durable Object)
// ============================================

/**
 * GET /admin/analytics/realtime
 * Get real-time metrics from AnalyticsHub Durable Object
 */
analytics.get('/realtime', requirePermission('analytics', 'view'), async (c) => {
  const requestId = crypto.randomUUID();

  try {
    // Get AnalyticsHub Durable Object
    const hubId = c.env.ANALYTICS_HUB.idFromName('global');
    const hub = c.env.ANALYTICS_HUB.get(hubId);

    // Request metrics from Durable Object
    const response = await hub.fetch(new Request('https://internal/metrics'));

    if (!response.ok) {
      return c.json({
        success: false,
        error: { code: 'ANALYTICS_ERROR', message: 'Impossible de récupérer les métriques' },
        requestId,
      }, 500);
    }

    const data = await response.json();

    return c.json({
      success: true,
      data,
      requestId,
    });
  } catch (error) {
    console.error('[Analytics] Realtime metrics error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' },
      requestId,
    }, 500);
  }
});

/**
 * GET /admin/analytics/history
 * Get historical metrics from AnalyticsHub
 */
analytics.get('/history', requirePermission('analytics', 'view'), async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const period = c.req.query('period') || '24h';

    // Get AnalyticsHub Durable Object
    const hubId = c.env.ANALYTICS_HUB.idFromName('global');
    const hub = c.env.ANALYTICS_HUB.get(hubId);

    // Request history from Durable Object
    const response = await hub.fetch(new Request(`https://internal/history?period=${period}`));

    if (!response.ok) {
      return c.json({
        success: false,
        error: { code: 'ANALYTICS_ERROR', message: 'Impossible de récupérer l\'historique' },
        requestId,
      }, 500);
    }

    const data = await response.json();

    return c.json({
      success: true,
      data,
      requestId,
    });
  } catch (error) {
    console.error('[Analytics] History error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' },
      requestId,
    }, 500);
  }
});

// ============================================
// LOG SEARCH
// ============================================

/**
 * GET /admin/analytics/logs
 * Search archived logs
 */
analytics.get('/logs', requirePermission('logs', 'view'), async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const query = c.req.query();

    // Parse filters
    const filters = {
      startDate: query.startDate,
      endDate: query.endDate,
      level: query.level,
      category: query.category,
      action: query.action,
      userId: query.userId,
      requestId: query.requestId,
      entityType: query.entityType,
      entityId: query.entityId,
      search: query.search,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    };

    const logArchiver = new LogArchiverService(
      c.env.DB,
      c.env.LOGS_STORAGE,
      c.env.ENVIRONMENT || 'development'
    );

    const result = await logArchiver.searchLogs(filters);

    return c.json({
      success: true,
      data: result,
      requestId,
    });
  } catch (error) {
    console.error('[Analytics] Log search error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' },
      requestId,
    }, 500);
  }
});

/**
 * GET /admin/analytics/logs/:id
 * Get full log content
 */
analytics.get('/logs/:id', requirePermission('logs', 'view'), async (c) => {
  const requestId = crypto.randomUUID();
  const logId = c.req.param('id');

  try {
    const logArchiver = new LogArchiverService(
      c.env.DB,
      c.env.LOGS_STORAGE,
      c.env.ENVIRONMENT || 'development'
    );

    const log = await logArchiver.getLogContent(logId);

    if (!log) {
      return c.json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Log non trouvé' },
        requestId,
      }, 404);
    }

    return c.json({
      success: true,
      data: log,
      requestId,
    });
  } catch (error) {
    console.error('[Analytics] Get log error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' },
      requestId,
    }, 500);
  }
});

/**
 * GET /admin/analytics/logs/stats
 * Get log statistics
 */
analytics.get('/logs/stats', requirePermission('logs', 'view'), async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const startDate = c.req.query('startDate');
    const endDate = c.req.query('endDate');

    const logArchiver = new LogArchiverService(
      c.env.DB,
      c.env.LOGS_STORAGE,
      c.env.ENVIRONMENT || 'development'
    );

    const stats = await logArchiver.getLogStats(startDate, endDate);

    return c.json({
      success: true,
      data: stats,
      requestId,
    });
  } catch (error) {
    console.error('[Analytics] Log stats error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' },
      requestId,
    }, 500);
  }
});

// ============================================
// ALERT RULES MANAGEMENT
// ============================================

/**
 * GET /admin/analytics/alerts/rules
 * List all alert rules
 */
analytics.get('/alerts/rules', requirePermission('alerts', 'view'), async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const result = await c.env.DB
      .prepare(`
        SELECT id, name, description, metric, operator, threshold, severity,
               cooldown_minutes, notify_email, notify_sms, notify_webhook,
               enabled, last_triggered_at, created_at, updated_at
        FROM alert_rules
        ORDER BY created_at DESC
      `)
      .all();

    return c.json({
      success: true,
      data: {
        rules: result.results || [],
      },
      requestId,
    });
  } catch (error) {
    console.error('[Analytics] List alert rules error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' },
      requestId,
    }, 500);
  }
});

/**
 * POST /admin/analytics/alerts/rules
 * Create a new alert rule
 */
analytics.post('/alerts/rules', requirePermission('alerts', 'create'), async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const body = await c.req.json<{
      name: string;
      description?: string;
      metric: string;
      operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
      threshold: number;
      severity: 'info' | 'warning' | 'critical';
      cooldownMinutes?: number;
      notifyEmail?: boolean;
      notifySms?: boolean;
      notifyWebhook?: string;
    }>();

    // Validation
    if (!body.name || !body.metric || !body.operator || body.threshold === undefined || !body.severity) {
      return c.json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Champs requis manquants' },
        requestId,
      }, 400);
    }

    const validOperators = ['>', '<', '>=', '<=', '==', '!='];
    if (!validOperators.includes(body.operator)) {
      return c.json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Opérateur invalide' },
        requestId,
      }, 400);
    }

    const validSeverities = ['info', 'warning', 'critical'];
    if (!validSeverities.includes(body.severity)) {
      return c.json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Sévérité invalide' },
        requestId,
      }, 400);
    }

    const ruleId = `rule_${crypto.randomUUID().slice(0, 8)}`;
    const adminId = c.get('adminId' as never) as string;

    await c.env.DB
      .prepare(`
        INSERT INTO alert_rules (
          id, name, description, metric, operator, threshold, severity,
          cooldown_minutes, notify_email, notify_sms, notify_webhook, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        ruleId,
        body.name,
        body.description || null,
        body.metric,
        body.operator,
        body.threshold,
        body.severity,
        body.cooldownMinutes || 15,
        body.notifyEmail !== false ? 1 : 0,
        body.notifySms ? 1 : 0,
        body.notifyWebhook || null,
        adminId
      )
      .run();

    return c.json({
      success: true,
      data: { id: ruleId },
      requestId,
    }, 201);
  } catch (error) {
    console.error('[Analytics] Create alert rule error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' },
      requestId,
    }, 500);
  }
});

/**
 * PATCH /admin/analytics/alerts/rules/:id
 * Update an alert rule
 */
analytics.patch('/alerts/rules/:id', requirePermission('alerts', 'update'), async (c) => {
  const requestId = crypto.randomUUID();
  const ruleId = c.req.param('id');

  try {
    // Check if rule exists
    const existing = await c.env.DB
      .prepare('SELECT id FROM alert_rules WHERE id = ?')
      .bind(ruleId)
      .first();

    if (!existing) {
      return c.json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Règle non trouvée' },
        requestId,
      }, 404);
    }

    const body = await c.req.json<{
      name?: string;
      description?: string;
      metric?: string;
      operator?: string;
      threshold?: number;
      severity?: string;
      cooldownMinutes?: number;
      notifyEmail?: boolean;
      notifySms?: boolean;
      notifyWebhook?: string;
      enabled?: boolean;
    }>();

    // Build update query dynamically
    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (body.name !== undefined) { updates.push('name = ?'); values.push(body.name); }
    if (body.description !== undefined) { updates.push('description = ?'); values.push(body.description); }
    if (body.metric !== undefined) { updates.push('metric = ?'); values.push(body.metric); }
    if (body.operator !== undefined) { updates.push('operator = ?'); values.push(body.operator); }
    if (body.threshold !== undefined) { updates.push('threshold = ?'); values.push(body.threshold); }
    if (body.severity !== undefined) { updates.push('severity = ?'); values.push(body.severity); }
    if (body.cooldownMinutes !== undefined) { updates.push('cooldown_minutes = ?'); values.push(body.cooldownMinutes); }
    if (body.notifyEmail !== undefined) { updates.push('notify_email = ?'); values.push(body.notifyEmail ? 1 : 0); }
    if (body.notifySms !== undefined) { updates.push('notify_sms = ?'); values.push(body.notifySms ? 1 : 0); }
    if (body.notifyWebhook !== undefined) { updates.push('notify_webhook = ?'); values.push(body.notifyWebhook || null); }
    if (body.enabled !== undefined) { updates.push('enabled = ?'); values.push(body.enabled ? 1 : 0); }

    if (updates.length === 0) {
      return c.json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Aucun champ à mettre à jour' },
        requestId,
      }, 400);
    }

    updates.push('updated_at = datetime(\'now\')');

    await c.env.DB
      .prepare(`UPDATE alert_rules SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values, ruleId)
      .run();

    return c.json({
      success: true,
      data: { id: ruleId },
      requestId,
    });
  } catch (error) {
    console.error('[Analytics] Update alert rule error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' },
      requestId,
    }, 500);
  }
});

/**
 * DELETE /admin/analytics/alerts/rules/:id
 * Delete an alert rule
 */
analytics.delete('/alerts/rules/:id', requirePermission('alerts', 'delete'), async (c) => {
  const requestId = crypto.randomUUID();
  const ruleId = c.req.param('id');

  try {
    const result = await c.env.DB
      .prepare('DELETE FROM alert_rules WHERE id = ?')
      .bind(ruleId)
      .run();

    if (result.meta?.changes === 0) {
      return c.json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Règle non trouvée' },
        requestId,
      }, 404);
    }

    return c.json({
      success: true,
      data: { deleted: true },
      requestId,
    });
  } catch (error) {
    console.error('[Analytics] Delete alert rule error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' },
      requestId,
    }, 500);
  }
});

// ============================================
// ALERTS HISTORY
// ============================================

/**
 * GET /admin/analytics/alerts
 * List triggered alerts with pagination
 */
analytics.get('/alerts', requirePermission('alerts', 'view'), async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const query = c.req.query();
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || '50', 10)));
    const offset = Math.max(0, parseInt(query.offset || '0', 10));
    const severity = query.severity;
    const resolved = query.resolved;

    // Build query with filters
    const conditions: string[] = ['1=1'];
    const params: (string | number)[] = [];

    if (severity) {
      conditions.push('severity = ?');
      params.push(severity);
    }

    if (resolved !== undefined) {
      conditions.push('resolved = ?');
      params.push(resolved === 'true' ? 1 : 0);
    }

    const whereClause = conditions.join(' AND ');

    // Get total count
    const countResult = await c.env.DB
      .prepare(`SELECT COUNT(*) as count FROM alerts WHERE ${whereClause}`)
      .bind(...params)
      .first<{ count: number }>();

    // Get alerts
    const alertsResult = await c.env.DB
      .prepare(`
        SELECT id, rule_id, rule_name, severity, message, current_value, threshold,
               triggered_at, acknowledged, acknowledged_by, acknowledged_at,
               resolved, resolved_at
        FROM alerts
        WHERE ${whereClause}
        ORDER BY triggered_at DESC
        LIMIT ? OFFSET ?
      `)
      .bind(...params, limit, offset)
      .all();

    return c.json({
      success: true,
      data: {
        alerts: alertsResult.results || [],
        total: countResult?.count || 0,
        limit,
        offset,
      },
      requestId,
    });
  } catch (error) {
    console.error('[Analytics] List alerts error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' },
      requestId,
    }, 500);
  }
});

/**
 * POST /admin/analytics/alerts/:id/acknowledge
 * Acknowledge an alert
 */
analytics.post('/alerts/:id/acknowledge', requirePermission('alerts', 'update'), async (c) => {
  const requestId = crypto.randomUUID();
  const alertId = c.req.param('id');
  const adminId = c.get('adminId' as never) as string;

  try {
    const result = await c.env.DB
      .prepare(`
        UPDATE alerts
        SET acknowledged = 1, acknowledged_by = ?, acknowledged_at = datetime('now')
        WHERE id = ? AND acknowledged = 0
      `)
      .bind(adminId, alertId)
      .run();

    if (result.meta?.changes === 0) {
      return c.json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Alerte non trouvée ou déjà acquittée' },
        requestId,
      }, 404);
    }

    return c.json({
      success: true,
      data: { acknowledged: true },
      requestId,
    });
  } catch (error) {
    console.error('[Analytics] Acknowledge alert error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' },
      requestId,
    }, 500);
  }
});

/**
 * POST /admin/analytics/alerts/:id/resolve
 * Resolve an alert
 */
analytics.post('/alerts/:id/resolve', requirePermission('alerts', 'update'), async (c) => {
  const requestId = crypto.randomUUID();
  const alertId = c.req.param('id');

  try {
    const result = await c.env.DB
      .prepare(`
        UPDATE alerts
        SET resolved = 1, resolved_at = datetime('now')
        WHERE id = ? AND resolved = 0
      `)
      .bind(alertId)
      .run();

    if (result.meta?.changes === 0) {
      return c.json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Alerte non trouvée ou déjà résolue' },
        requestId,
      }, 404);
    }

    return c.json({
      success: true,
      data: { resolved: true },
      requestId,
    });
  } catch (error) {
    console.error('[Analytics] Resolve alert error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' },
      requestId,
    }, 500);
  }
});

// ============================================
// ANALYTICS ENGINE QUERIES
// ============================================

/**
 * GET /admin/analytics/transactions
 * Query transaction analytics from Analytics Engine
 */
analytics.get('/transactions', requirePermission('analytics', 'view'), async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const query = c.req.query();
    const period = query.period || '7d';
    const groupBy = query.groupBy || 'day';

    // Calculate date range
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case '24h': startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); break;
      case '7d': startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
      case '30d': startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
      case '90d': startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); break;
      default: startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    // Query D1 for transaction summary (Analytics Engine requires GraphQL which isn't directly supported)
    // Fallback to D1 aggregation
    const result = await c.env.DB
      .prepare(`
        SELECT
          DATE(created_at) as date,
          type,
          status,
          COUNT(*) as count,
          SUM(token_amount) as total_tokens,
          SUM(cash_amount) as total_cash,
          SUM(fees) as total_fees,
          AVG(price_per_gram) as avg_price
        FROM transactions
        WHERE created_at >= ?
        GROUP BY DATE(created_at), type, status
        ORDER BY date DESC, type
      `)
      .bind(startDate.toISOString())
      .all();

    return c.json({
      success: true,
      data: {
        period,
        startDate: startDate.toISOString(),
        endDate: now.toISOString(),
        results: result.results || [],
      },
      requestId,
    });
  } catch (error) {
    console.error('[Analytics] Transaction analytics error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' },
      requestId,
    }, 500);
  }
});

/**
 * GET /admin/analytics/users
 * Query user analytics
 */
analytics.get('/users', requirePermission('analytics', 'view'), async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const query = c.req.query();
    const period = query.period || '30d';

    // Calculate date range
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case '7d': startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
      case '30d': startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
      case '90d': startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); break;
      case '365d': startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000); break;
      default: startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get user stats
    const [totalUsers, newUsers, byKycLevel, byCountry] = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>(),

      c.env.DB
        .prepare(`
          SELECT DATE(created_at) as date, COUNT(*) as count
          FROM users
          WHERE created_at >= ?
          GROUP BY DATE(created_at)
          ORDER BY date
        `)
        .bind(startDate.toISOString())
        .all(),

      c.env.DB
        .prepare(`
          SELECT kyc_level, kyc_status, COUNT(*) as count
          FROM users
          GROUP BY kyc_level, kyc_status
        `)
        .all(),

      c.env.DB
        .prepare(`
          SELECT country, COUNT(*) as count
          FROM users
          GROUP BY country
          ORDER BY count DESC
          LIMIT 10
        `)
        .all(),
    ]);

    return c.json({
      success: true,
      data: {
        period,
        totalUsers: totalUsers?.count || 0,
        newUsers: newUsers.results || [],
        byKycLevel: byKycLevel.results || [],
        byCountry: byCountry.results || [],
      },
      requestId,
    });
  } catch (error) {
    console.error('[Analytics] User analytics error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' },
      requestId,
    }, 500);
  }
});

/**
 * GET /admin/analytics/dashboard
 * Get complete dashboard data
 */
analytics.get('/dashboard', requirePermission('analytics', 'view'), async (c) => {
  const requestId = crypto.randomUUID();

  try {
    // Get multiple metrics in parallel
    const [
      realtimeMetrics,
      todayTransactions,
      pendingKyc,
      pendingWithdrawals,
      activeAlerts,
      goldStock,
    ] = await Promise.all([
      // Real-time metrics from Durable Object
      (async () => {
        try {
          const hubId = c.env.ANALYTICS_HUB.idFromName('global');
          const hub = c.env.ANALYTICS_HUB.get(hubId);
          const response = await hub.fetch(new Request('https://internal/metrics'));
          return response.ok ? await response.json() : null;
        } catch { return null; }
      })(),

      // Today's transaction summary
      c.env.DB
        .prepare(`
          SELECT
            type,
            status,
            COUNT(*) as count,
            SUM(cash_amount) as total_amount
          FROM transactions
          WHERE DATE(created_at) = DATE('now')
          GROUP BY type, status
        `)
        .all(),

      // Pending KYC count
      c.env.DB
        .prepare(`SELECT COUNT(*) as count FROM users WHERE kyc_status = 'SUBMITTED'`)
        .first<{ count: number }>(),

      // Pending withdrawals
      c.env.DB
        .prepare(`SELECT COUNT(*) as count FROM transactions WHERE type = 'WITHDRAWAL' AND status = 'PENDING'`)
        .first<{ count: number }>(),

      // Active alerts
      c.env.DB
        .prepare(`SELECT COUNT(*) as count FROM alerts WHERE resolved = 0`)
        .first<{ count: number }>(),

      // Gold stock
      c.env.DB
        .prepare(`SELECT * FROM gold_stock LIMIT 1`)
        .first(),
    ]);

    return c.json({
      success: true,
      data: {
        realtime: realtimeMetrics,
        todayTransactions: todayTransactions.results || [],
        pendingKyc: pendingKyc?.count || 0,
        pendingWithdrawals: pendingWithdrawals?.count || 0,
        activeAlerts: activeAlerts?.count || 0,
        goldStock,
        timestamp: new Date().toISOString(),
      },
      requestId,
    });
  } catch (error) {
    console.error('[Analytics] Dashboard error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' },
      requestId,
    }, 500);
  }
});

export { analytics as analyticsRoutes };
