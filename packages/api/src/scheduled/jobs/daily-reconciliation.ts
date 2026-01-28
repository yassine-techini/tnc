/**
 * Daily Reconciliation Job
 * Performs financial reconciliation and generates reports
 */

import type { Env } from '../../types/env';
import { ConfigService } from '../../services/config.service';

export async function dailyReconciliation(env: Env, ctx: ExecutionContext): Promise<void> {
  console.log('[DailyReconciliation] Starting daily reconciliation');

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const reportDate = yesterday.toISOString().split('T')[0];

  try {
    // 1. Calculate daily transaction summary
    const dailyStats = await env.DB.prepare(`
      SELECT
        type,
        COUNT(*) as count,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'COMPLETED' THEN token_amount ELSE 0 END) as total_tokens,
        SUM(CASE WHEN status = 'COMPLETED' THEN cash_amount ELSE 0 END) as total_cash,
        SUM(CASE WHEN status = 'COMPLETED' THEN fees ELSE 0 END) as total_fees
      FROM transactions
      WHERE date(created_at) = ?
      GROUP BY type
    `).bind(reportDate).all();

    // 2. Check wallet balance integrity
    const walletDiscrepancies = await env.DB.prepare(`
      SELECT
        w.id as wallet_id,
        w.user_id,
        w.token_balance as recorded_balance,
        COALESCE(SUM(CASE
          WHEN t.type IN ('BUY') AND t.status = 'COMPLETED' THEN t.token_amount
          WHEN t.type IN ('SELL') AND t.status = 'COMPLETED' THEN -t.token_amount
          ELSE 0
        END), 0) as calculated_balance
      FROM wallets w
      LEFT JOIN transactions t ON w.id = t.wallet_id
      GROUP BY w.id
      HAVING ABS(recorded_balance - calculated_balance) > 0.001
    `).all();

    // 3. Check gold stock integrity
    const stockCheck = await env.DB.prepare(`
      SELECT
        gs.total_allocated,
        gs.tokens_issued,
        COALESCE(SUM(w.token_balance), 0) as total_user_tokens
      FROM gold_stock gs
      LEFT JOIN wallets w ON 1=1
      WHERE gs.id = 'main'
      GROUP BY gs.id
    `).first<{
      total_allocated: number;
      tokens_issued: number;
      total_user_tokens: number;
    }>();

    // 4. Identify stuck transactions
    const stuckTransactions = await env.DB.prepare(`
      SELECT id, user_id, type, status, cash_amount, created_at
      FROM transactions
      WHERE status IN ('PENDING', 'PROCESSING')
        AND created_at < datetime('now', '-24 hours')
    `).all();

    // 5. Generate reconciliation report
    const reportId = crypto.randomUUID();
    const report = {
      id: reportId,
      date: reportDate,
      generatedAt: new Date().toISOString(),
      dailyStats: dailyStats.results,
      walletDiscrepancies: walletDiscrepancies.results,
      stockIntegrity: stockCheck ? {
        totalAllocated: stockCheck.total_allocated,
        tokensIssued: stockCheck.tokens_issued,
        totalUserTokens: stockCheck.total_user_tokens,
        isValid: Math.abs(stockCheck.tokens_issued - stockCheck.total_user_tokens) < 0.001,
      } : null,
      stuckTransactions: stuckTransactions.results,
      alerts: [] as string[],
    };

    // Add alerts for issues
    if (walletDiscrepancies.results && walletDiscrepancies.results.length > 0) {
      report.alerts.push(`${walletDiscrepancies.results.length} wallet balance discrepancies found`);
    }

    if (stockCheck && Math.abs(stockCheck.tokens_issued - stockCheck.total_user_tokens) >= 0.001) {
      report.alerts.push('Gold stock mismatch detected');
    }

    if (stuckTransactions.results && stuckTransactions.results.length > 0) {
      report.alerts.push(`${stuckTransactions.results.length} stuck transactions found`);
    }

    // Store report in audit log
    await env.DB.prepare(`
      INSERT INTO audit_logs (id, action, entity_type, entity_id, new_value, created_at)
      VALUES (?, 'DAILY_RECONCILIATION', 'SYSTEM', ?, ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      reportDate,
      JSON.stringify(report)
    ).run();

    // Cache the report for quick access
    const configService = new ConfigService(env.DB, env.CACHE);
    const reconciliationCacheTtl = await configService.getNumber('reconciliation_cache_ttl', 86400 * 7);
    await env.CACHE.put(
      `reconciliation:${reportDate}`,
      JSON.stringify(report),
      { expirationTtl: reconciliationCacheTtl }
    );

    console.log(`[DailyReconciliation] Completed for ${reportDate}`, {
      transactions: dailyStats.results?.length || 0,
      discrepancies: walletDiscrepancies.results?.length || 0,
      stuckTx: stuckTransactions.results?.length || 0,
      alerts: report.alerts.length,
    });

    // If there are critical alerts, notify admins
    if (report.alerts.length > 0) {
      ctx.waitUntil(notifyAdmins(env, report));
    }

  } catch (error) {
    console.error('[DailyReconciliation] Error:', error);
    throw error;
  }
}

async function notifyAdmins(env: Env, report: { date: string; alerts: string[] }): Promise<void> {
  try {
    // Get admin emails
    const admins = await env.DB.prepare(`
      SELECT id, email FROM admins
      WHERE role IN ('SUPER_ADMIN', 'ADMIN', 'FINANCE') AND active = 1
    `).all();

    if (!admins.results || admins.results.length === 0) {
      return;
    }

    // Create notifications for each admin
    for (const admin of admins.results) {
      await env.DB.prepare(`
        INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at)
        VALUES (?, ?, 'RECONCILIATION_ALERT', 'SYSTEM', ?, ?, datetime('now'))
      `).bind(
        crypto.randomUUID(),
        admin.id,
        report.date,
        JSON.stringify({ alerts: report.alerts })
      ).run();
    }

    console.log(`[DailyReconciliation] Notified ${admins.results.length} admins of ${report.alerts.length} alerts`);
  } catch (error) {
    console.error('[DailyReconciliation] Error notifying admins:', error);
  }
}
