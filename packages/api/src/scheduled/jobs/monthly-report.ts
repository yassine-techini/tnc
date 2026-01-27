/**
 * Monthly Report Job
 * Generates comprehensive monthly reports for state portal
 */

import type { Env } from '../../types/env';

interface MonthlyReport {
  id: string;
  month: string;
  year: number;
  generatedAt: string;
  summary: {
    totalUsers: number;
    newUsers: number;
    activeUsers: number;
    verifiedUsers: number;
  };
  trading: {
    totalBuyTransactions: number;
    totalSellTransactions: number;
    totalBuyVolume: number;
    totalSellVolume: number;
    totalTokensBought: number;
    totalTokensSold: number;
    totalFeesCollected: number;
    averageBuyPrice: number;
    averageSellPrice: number;
  };
  deposits: {
    totalDeposits: number;
    totalDepositAmount: number;
    byMethod: { [key: string]: { count: number; amount: number } };
  };
  withdrawals: {
    totalWithdrawals: number;
    totalWithdrawalAmount: number;
    totalWithdrawalFees: number;
    byMethod: { [key: string]: { count: number; amount: number } };
  };
  kyc: {
    totalSubmissions: number;
    approved: number;
    rejected: number;
    pending: number;
  };
  stock: {
    openingStock: number;
    closingStock: number;
    tokensIssued: number;
    tokensRedeemed: number;
  };
}

export async function generateMonthlyReport(env: Env, ctx: ExecutionContext): Promise<void> {
  console.log('[MonthlyReport] Starting monthly report generation');

  // Calculate previous month
  const now = new Date();
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const monthStart = previousMonth.toISOString().split('T')[0];
  const monthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];
  const monthName = previousMonth.toLocaleString('fr-FR', { month: 'long' });
  const year = previousMonth.getFullYear();

  try {
    // 1. User statistics
    const userStats = await env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM users WHERE date(created_at) BETWEEN ? AND ?) as new_users,
        (SELECT COUNT(DISTINCT user_id) FROM transactions WHERE date(created_at) BETWEEN ? AND ?) as active_users,
        (SELECT COUNT(*) FROM users WHERE kyc_level = 'VERIFIED') as verified_users
    `).bind(monthStart, monthEnd, monthStart, monthEnd).first<any>();

    // 2. Trading statistics
    const tradingStats = await env.DB.prepare(`
      SELECT
        SUM(CASE WHEN type = 'BUY' AND status = 'COMPLETED' THEN 1 ELSE 0 END) as buy_count,
        SUM(CASE WHEN type = 'SELL' AND status = 'COMPLETED' THEN 1 ELSE 0 END) as sell_count,
        SUM(CASE WHEN type = 'BUY' AND status = 'COMPLETED' THEN cash_amount ELSE 0 END) as buy_volume,
        SUM(CASE WHEN type = 'SELL' AND status = 'COMPLETED' THEN cash_amount ELSE 0 END) as sell_volume,
        SUM(CASE WHEN type = 'BUY' AND status = 'COMPLETED' THEN token_amount ELSE 0 END) as tokens_bought,
        SUM(CASE WHEN type = 'SELL' AND status = 'COMPLETED' THEN token_amount ELSE 0 END) as tokens_sold,
        SUM(CASE WHEN status = 'COMPLETED' THEN fees ELSE 0 END) as total_fees,
        AVG(CASE WHEN type = 'BUY' AND status = 'COMPLETED' THEN price_per_gram ELSE NULL END) as avg_buy_price,
        AVG(CASE WHEN type = 'SELL' AND status = 'COMPLETED' THEN price_per_gram ELSE NULL END) as avg_sell_price
      FROM transactions
      WHERE type IN ('BUY', 'SELL') AND date(created_at) BETWEEN ? AND ?
    `).bind(monthStart, monthEnd).first<any>();

    // 3. Deposit statistics
    const depositStats = await env.DB.prepare(`
      SELECT
        COUNT(*) as total_deposits,
        SUM(cash_amount) as total_amount,
        payment_method,
        COUNT(*) as method_count,
        SUM(cash_amount) as method_amount
      FROM transactions
      WHERE type = 'DEPOSIT' AND status = 'COMPLETED' AND date(created_at) BETWEEN ? AND ?
      GROUP BY payment_method
    `).bind(monthStart, monthEnd).all();

    const depositsByMethod: { [key: string]: { count: number; amount: number } } = {};
    let totalDeposits = 0;
    let totalDepositAmount = 0;

    for (const row of (depositStats.results as any[]) || []) {
      depositsByMethod[row.payment_method || 'unknown'] = {
        count: row.method_count,
        amount: row.method_amount,
      };
      totalDeposits += row.method_count;
      totalDepositAmount += row.method_amount || 0;
    }

    // 4. Withdrawal statistics
    const withdrawalStats = await env.DB.prepare(`
      SELECT
        w.method,
        COUNT(*) as count,
        SUM(w.amount) as amount,
        SUM(w.fees) as fees
      FROM withdrawals w
      WHERE w.status = 'COMPLETED' AND date(w.created_at) BETWEEN ? AND ?
      GROUP BY w.method
    `).bind(monthStart, monthEnd).all();

    const withdrawalsByMethod: { [key: string]: { count: number; amount: number } } = {};
    let totalWithdrawals = 0;
    let totalWithdrawalAmount = 0;
    let totalWithdrawalFees = 0;

    for (const row of (withdrawalStats.results as any[]) || []) {
      withdrawalsByMethod[row.method] = {
        count: row.count,
        amount: row.amount,
      };
      totalWithdrawals += row.count;
      totalWithdrawalAmount += row.amount || 0;
      totalWithdrawalFees += row.fees || 0;
    }

    // 5. KYC statistics
    const kycStats = await env.DB.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'VERIFIED' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN status IN ('SUBMITTED', 'PROCESSING') THEN 1 ELSE 0 END) as pending
      FROM kyc_documents
      WHERE date(created_at) BETWEEN ? AND ?
    `).bind(monthStart, monthEnd).first<any>();

    // 6. Stock statistics
    const stockStats = await env.DB.prepare(`
      SELECT total_allocated, tokens_issued FROM gold_stock WHERE id = 'main'
    `).first<any>();

    // Calculate opening stock (closing stock - net change)
    const netTokenChange = (tradingStats?.tokens_bought || 0) - (tradingStats?.tokens_sold || 0);
    const closingStock = stockStats?.tokens_issued || 0;
    const openingStock = closingStock - netTokenChange;

    // Build report
    const reportId = crypto.randomUUID();
    const report: MonthlyReport = {
      id: reportId,
      month: monthName,
      year: year,
      generatedAt: new Date().toISOString(),
      summary: {
        totalUsers: userStats?.total_users || 0,
        newUsers: userStats?.new_users || 0,
        activeUsers: userStats?.active_users || 0,
        verifiedUsers: userStats?.verified_users || 0,
      },
      trading: {
        totalBuyTransactions: tradingStats?.buy_count || 0,
        totalSellTransactions: tradingStats?.sell_count || 0,
        totalBuyVolume: tradingStats?.buy_volume || 0,
        totalSellVolume: tradingStats?.sell_volume || 0,
        totalTokensBought: tradingStats?.tokens_bought || 0,
        totalTokensSold: tradingStats?.tokens_sold || 0,
        totalFeesCollected: tradingStats?.total_fees || 0,
        averageBuyPrice: tradingStats?.avg_buy_price || 0,
        averageSellPrice: tradingStats?.avg_sell_price || 0,
      },
      deposits: {
        totalDeposits: totalDeposits,
        totalDepositAmount: totalDepositAmount,
        byMethod: depositsByMethod,
      },
      withdrawals: {
        totalWithdrawals: totalWithdrawals,
        totalWithdrawalAmount: totalWithdrawalAmount,
        totalWithdrawalFees: totalWithdrawalFees,
        byMethod: withdrawalsByMethod,
      },
      kyc: {
        totalSubmissions: kycStats?.total || 0,
        approved: kycStats?.approved || 0,
        rejected: kycStats?.rejected || 0,
        pending: kycStats?.pending || 0,
      },
      stock: {
        openingStock: openingStock,
        closingStock: closingStock,
        tokensIssued: tradingStats?.tokens_bought || 0,
        tokensRedeemed: tradingStats?.tokens_sold || 0,
      },
    };

    // Store report
    await env.DB.prepare(`
      INSERT INTO audit_logs (id, action, entity_type, entity_id, new_value, created_at)
      VALUES (?, 'MONTHLY_REPORT', 'SYSTEM', ?, ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      `${year}-${(previousMonth.getMonth() + 1).toString().padStart(2, '0')}`,
      JSON.stringify(report)
    ).run();

    // Cache for quick access
    await env.CACHE.put(
      `monthly_report:${year}-${(previousMonth.getMonth() + 1).toString().padStart(2, '0')}`,
      JSON.stringify(report),
      { expirationTtl: 86400 * 365 } // 1 year
    );

    console.log(`[MonthlyReport] Generated report for ${monthName} ${year}`, {
      newUsers: report.summary.newUsers,
      buyVolume: report.trading.totalBuyVolume,
      sellVolume: report.trading.totalSellVolume,
    });

  } catch (error) {
    console.error('[MonthlyReport] Error:', error);
    throw error;
  }
}
