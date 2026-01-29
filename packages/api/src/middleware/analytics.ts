/**
 * Analytics Middleware
 * Instruments all API requests for tracking in Cloudflare Analytics Engine
 */

import type { Context, Next } from 'hono';
import type { AppEnv } from '../types/env';
import { AnalyticsService } from '../services/analytics.service';

/**
 * Analytics middleware that tracks all API requests
 * Uses fire-and-forget pattern to avoid blocking responses
 */
export const analyticsMiddleware = async (c: Context<AppEnv>, next: Next) => {
  const start = Date.now();

  // Execute the request
  await next();

  // Calculate duration
  const duration = Date.now() - start;

  // Get request details
  const method = c.req.method;
  const path = c.req.path;
  const statusCode = c.res.status;

  // Get user info from context (set by auth middleware)
  const userId = c.get('userId') as string | undefined;
  const kycLevel = c.get('kycLevel') as string | undefined;

  // Get request metadata
  const userAgent = c.req.header('User-Agent');
  const country = c.req.header('CF-IPCountry') || 'BF';

  // Get error code if present
  let errorCode: string | undefined;
  if (statusCode >= 400) {
    try {
      // Try to get error code from response body
      const body = c.res.clone();
      const json = await body.json() as { error?: { code?: string } };
      errorCode = json?.error?.code;
    } catch {
      // Ignore parsing errors
    }
  }

  // Track the request (fire-and-forget)
  try {
    const analytics = new AnalyticsService(c.env.ANALYTICS, c.env.ENVIRONMENT || 'development');

    // Don't await - fire and forget
    analytics.trackApiRequest({
      method,
      path,
      statusCode,
      durationMs: duration,
      userId,
      errorCode,
      country,
      userAgent,
      kycLevel,
    }).catch((err) => {
      console.error('[Analytics Middleware] Failed to track request:', err);
    });
  } catch (error) {
    // Silently fail - analytics should never break the API
    console.error('[Analytics Middleware] Error:', error);
  }
};

/**
 * Transaction analytics helper
 * Call this from transaction routes to track business events
 */
export async function trackTransactionEvent(
  c: Context<AppEnv>,
  data: {
    type: 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL';
    status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
    tokenAmount?: number;
    cashAmountXof: number;
    pricePerGram?: number;
    fees?: number;
    paymentMethod?: string;
    failureReason?: string;
    processingTimeMs?: number;
    isFirstTransaction?: boolean;
  }
): Promise<void> {
  const userId = c.get('userId') as string;
  const kycLevel = c.get('kycLevel') as string | undefined;
  const country = c.req.header('CF-IPCountry') || 'BF';

  try {
    const analytics = new AnalyticsService(c.env.ANALYTICS, c.env.ENVIRONMENT || 'development');

    await analytics.trackTransaction({
      ...data,
      userId,
      country,
      kycLevel,
    });
  } catch (error) {
    console.error('[Analytics] Failed to track transaction:', error);
  }
}

/**
 * User event analytics helper
 * Call this from auth/user routes to track user actions
 */
export async function trackUserAnalyticsEvent(
  c: Context<AppEnv>,
  data: {
    action: 'REGISTER' | 'LOGIN' | 'LOGOUT' | 'KYC_SUBMIT' | 'KYC_APPROVED' | 'KYC_REJECTED' | '2FA_ENABLE' | '2FA_DISABLE' | 'PASSWORD_CHANGE' | 'PASSWORD_RESET';
    status: 'SUCCESS' | 'FAILED';
    failureReason?: string;
    deviceType?: string;
    kycDocumentType?: string;
    referralSource?: string;
    sessionDurationSeconds?: number;
    loginAttempts?: number;
  }
): Promise<void> {
  const userId = c.get('userId') as string | undefined;
  const country = c.req.header('CF-IPCountry') || 'BF';

  try {
    const analytics = new AnalyticsService(c.env.ANALYTICS, c.env.ENVIRONMENT || 'development');

    await analytics.trackUserEvent({
      ...data,
      userId,
      country,
    });
  } catch (error) {
    console.error('[Analytics] Failed to track user event:', error);
  }
}

/**
 * System event analytics helper
 * Call this for system-level events (errors, jobs, etc.)
 */
export function trackSystemAnalyticsEvent(
  c: Context<AppEnv>,
  data: {
    name: 'RATE_LIMIT_HIT' | 'ERROR' | 'QUEUE_PROCESS' | 'SCHEDULED_JOB' | 'PRICE_UPDATE' | 'STOCK_ALERT' | 'SECURITY_EVENT';
    severity: 'info' | 'warning' | 'error' | 'critical';
    component?: string;
    errorCode?: string;
    jobName?: string;
    count?: number;
    durationMs?: number;
    memoryUsedMb?: number;
    queueDepth?: number;
    message?: string;
  }
): void {
  try {
    const analytics = new AnalyticsService(c.env.ANALYTICS, c.env.ENVIRONMENT || 'development');
    analytics.trackSystemEvent(data);
  } catch (error) {
    console.error('[Analytics] Failed to track system event:', error);
  }
}

/**
 * Price update analytics helper
 * Call this when gold prices are updated
 */
export function trackPriceUpdateEvent(
  c: Context<AppEnv>,
  data: {
    source: string;
    trigger: 'cron' | 'manual' | 'webhook';
    priceUsd: number;
    priceXof: number;
    buyPrice: number;
    sellPrice: number;
    exchangeRate: number;
    spreadBuy: number;
    spreadSell: number;
    priceChangePercent: number;
    fetchLatencyMs?: number;
  }
): void {
  try {
    const analytics = new AnalyticsService(c.env.ANALYTICS, c.env.ENVIRONMENT || 'development');
    analytics.trackPriceUpdate(data);
  } catch (error) {
    console.error('[Analytics] Failed to track price update:', error);
  }
}
