/**
 * TNC Trading API - Scheduled Jobs Handler
 * Handles cron triggers for automated tasks
 */

import type { Env } from '../types/env';
import { refreshGoldPrice } from './jobs/price-refresh';
import { dailyReconciliation } from './jobs/daily-reconciliation';
import { cleanupExpiredSessions } from './jobs/session-cleanup';
import { cleanupExpiredQuotes } from './jobs/quote-cleanup';
import { generateMonthlyReport } from './jobs/monthly-report';
import { publishReserveAttestation } from './jobs/reserve-attestation';
import { anchorLatestAttestation } from './jobs/anchor-attestation';
// NOTE: price alerts are delivered inline by refreshGoldPrice()
// (PriceAlertService.checkAndTriggerAlerts) which sends email/SMS directly.
// The former standalone jobs/price-alerts.ts pushed PRICE_ALERT_* messages to a
// queue the consumer never routed, so it was dead code and has been removed.

export interface ScheduledController {
  scheduledTime: number;
  cron: string;
  noRetry(): void;
}

/**
 * Main scheduled event handler
 * Routes cron triggers to appropriate job handlers
 */
export async function handleScheduled(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const cron = controller.cron;
  const scheduledTime = new Date(controller.scheduledTime);

  console.log(`[Scheduled] Running cron job: ${cron} at ${scheduledTime.toISOString()}`);

  try {
    switch (cron) {
      // Price refresh - every 5/15 minutes
      case '*/5 * * * *':
      case '*/15 * * * *':
        await refreshGoldPrice(env, ctx);
        break;

      // Daily reconciliation - midnight UTC
      case '0 0 * * *':
        await dailyReconciliation(env, ctx);
        break;

      // Reserve attestation - 00:30 UTC, after reconciliation has settled
      case '30 0 * * *':
        await publishReserveAttestation(env, ctx);
        break;

      // Anchor the latest attestation - 01:00 UTC, after it has been published.
      // Separate on purpose: an attestation verifies without an anchor.
      case '0 1 * * *':
        await anchorLatestAttestation(env, ctx);
        break;

      // Session cleanup - 2 AM UTC
      case '0 2 * * *':
        await cleanupExpiredSessions(env, ctx);
        break;

      // Expired quotes cleanup - 3 AM UTC
      case '0 3 * * *':
        await cleanupExpiredQuotes(env, ctx);
        break;

      // Monthly report - 1st of month at 1 AM UTC
      case '0 1 1 * *':
        await generateMonthlyReport(env, ctx);
        break;

      default:
        console.log(`[Scheduled] Unknown cron pattern: ${cron}`);
    }

    console.log(`[Scheduled] Job completed successfully: ${cron}`);
  } catch (error) {
    console.error(`[Scheduled] Job failed: ${cron}`, error);
    // Don't retry for certain errors
    if (error instanceof Error && error.message.includes('FATAL')) {
      controller.noRetry();
    }
    throw error;
  }
}
