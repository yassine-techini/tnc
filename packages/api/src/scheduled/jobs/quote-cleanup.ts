/**
 * Quote Cleanup Job
 * Removes expired quotes and handles pending transactions timeout
 */

import type { Env } from '../../types/env';

export async function cleanupExpiredQuotes(env: Env, ctx: ExecutionContext): Promise<void> {
  console.log('[QuoteCleanup] Starting quote cleanup');

  try {
    // 1. Mark expired quotes
    const expiredQuotes = await env.DB.prepare(`
      UPDATE quotes
      SET status = 'EXPIRED'
      WHERE status = 'PENDING' AND expires_at < datetime('now')
    `).run();

    const quoteCount = expiredQuotes.meta?.changes || 0;
    console.log(`[QuoteCleanup] Expired ${quoteCount} quotes`);

    // 2. Delete old expired quotes (older than 7 days)
    const deletedQuotes = await env.DB.prepare(`
      DELETE FROM quotes
      WHERE status = 'EXPIRED' AND expires_at < datetime('now', '-7 days')
      RETURNING id
    `).all();

    const deletedCount = deletedQuotes.results?.length || 0;
    console.log(`[QuoteCleanup] Deleted ${deletedCount} old expired quotes`);

    // 3. Handle pending transactions that have timed out (older than 2 hours for deposits)
    const timedOutDeposits = await env.DB.prepare(`
      UPDATE transactions
      SET status = 'FAILED',
          failure_reason = 'Transaction timed out - no payment confirmation received',
          updated_at = datetime('now')
      WHERE type = 'DEPOSIT'
        AND status = 'PENDING'
        AND created_at < datetime('now', '-2 hours')
    `).run();

    const depositTimeoutCount = timedOutDeposits.meta?.changes || 0;
    if (depositTimeoutCount > 0) {
      console.log(`[QuoteCleanup] Timed out ${depositTimeoutCount} pending deposits`);

      // Create notifications for timed out deposits
      ctx.waitUntil(notifyTimedOutDeposits(env));
    }

    // 4. Handle pending BUY transactions without payment (older than 30 minutes)
    const timedOutBuys = await env.DB.prepare(`
      UPDATE transactions
      SET status = 'CANCELLED',
          failure_reason = 'Order cancelled - payment not initiated within time limit',
          updated_at = datetime('now')
      WHERE type = 'BUY'
        AND status = 'PENDING'
        AND payment_reference IS NULL
        AND created_at < datetime('now', '-30 minutes')
    `).run();

    const buyTimeoutCount = timedOutBuys.meta?.changes || 0;
    if (buyTimeoutCount > 0) {
      console.log(`[QuoteCleanup] Cancelled ${buyTimeoutCount} unpaid buy orders`);
    }

    // 5. Handle stuck PROCESSING transactions (older than 24 hours)
    const stuckTransactions = await env.DB.prepare(`
      SELECT id, user_id, type, cash_amount, created_at
      FROM transactions
      WHERE status = 'PROCESSING'
        AND created_at < datetime('now', '-24 hours')
    `).all();

    if (stuckTransactions.results && stuckTransactions.results.length > 0) {
      console.warn(`[QuoteCleanup] Found ${stuckTransactions.results.length} stuck transactions - manual review required`);

      // Log for admin review
      await env.DB.prepare(`
        INSERT INTO audit_logs (id, action, entity_type, new_value, created_at)
        VALUES (?, 'STUCK_TRANSACTIONS_FOUND', 'SYSTEM', ?, datetime('now'))
      `).bind(
        crypto.randomUUID(),
        JSON.stringify({
          count: stuckTransactions.results.length,
          transactions: stuckTransactions.results.map((t: any) => ({
            id: t.id,
            userId: t.user_id,
            type: t.type,
            amount: t.cash_amount,
            createdAt: t.created_at,
          })),
        })
      ).run();
    }

    // 6. Clean old triggered price alerts (older than 30 days)
    const oldAlerts = await env.DB.prepare(`
      DELETE FROM price_alerts
      WHERE triggered = 1 AND triggered_at < datetime('now', '-30 days')
      RETURNING id
    `).all();

    const alertCount = oldAlerts.results?.length || 0;
    console.log(`[QuoteCleanup] Deleted ${alertCount} old triggered price alerts`);

    // Log summary
    const summary = {
      expiredQuotes: quoteCount,
      deletedQuotes: deletedCount,
      timedOutDeposits: depositTimeoutCount,
      cancelledBuys: buyTimeoutCount,
      stuckTransactions: stuckTransactions.results?.length || 0,
      deletedAlerts: alertCount,
    };

    await env.DB.prepare(`
      INSERT INTO audit_logs (id, action, entity_type, new_value, created_at)
      VALUES (?, 'QUOTE_CLEANUP', 'SYSTEM', ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      JSON.stringify(summary)
    ).run();

    console.log('[QuoteCleanup] Cleanup completed', summary);

  } catch (error) {
    console.error('[QuoteCleanup] Error:', error);
    throw error;
  }
}

async function notifyTimedOutDeposits(env: Env): Promise<void> {
  try {
    // Get users with recently timed out deposits
    const timedOutUsers = await env.DB.prepare(`
      SELECT DISTINCT user_id
      FROM transactions
      WHERE type = 'DEPOSIT'
        AND status = 'FAILED'
        AND failure_reason LIKE '%timed out%'
        AND updated_at > datetime('now', '-5 minutes')
    `).all();

    if (!timedOutUsers.results || timedOutUsers.results.length === 0) {
      return;
    }

    for (const user of timedOutUsers.results) {
      await env.DB.prepare(`
        INSERT INTO notifications (id, user_id, type, title, body, created_at)
        VALUES (?, ?, 'TRANSACTION', ?, ?, datetime('now'))
      `).bind(
        crypto.randomUUID(),
        user.user_id,
        'Deposit Expired',
        'Your pending deposit has expired due to no payment confirmation. Please try again if you still wish to make a deposit.'
      ).run();
    }

    console.log(`[QuoteCleanup] Notified ${timedOutUsers.results.length} users of timed out deposits`);
  } catch (error) {
    console.error('[QuoteCleanup] Error notifying users:', error);
  }
}
