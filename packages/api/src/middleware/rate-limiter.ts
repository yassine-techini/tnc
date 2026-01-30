import { Context, Next } from 'hono';
import type { AppEnv } from '../types/env';
import { ConfigService } from '../services/config.service';
import { logger } from '../lib/logger';

/**
 * Rate limiter using Cloudflare KV with time-bucketed keys.
 * Three tiers: general, auth, trading — all configurable via DB config.
 *
 * Security: Fail-CLOSED for sensitive endpoints (trading, auth).
 * If KV is unavailable, block requests to prevent abuse.
 */

interface RateLimitConfig {
  windowSeconds: number;
  maxRequests: number;
  failClosed: boolean; // If true, block requests when KV is unavailable
}

// Defaults used when ConfigService is unavailable
// Trading, auth, and admin are fail-closed (block on error) for security
const DEFAULT_GENERAL: RateLimitConfig = { windowSeconds: 60, maxRequests: 100, failClosed: false };
const DEFAULT_AUTH: RateLimitConfig = { windowSeconds: 60, maxRequests: 20, failClosed: true };
const DEFAULT_TRADING: RateLimitConfig = { windowSeconds: 60, maxRequests: 10, failClosed: true };
const DEFAULT_ADMIN_AUTH: RateLimitConfig = { windowSeconds: 60, maxRequests: 5, failClosed: true };
const DEFAULT_ADMIN: RateLimitConfig = { windowSeconds: 60, maxRequests: 30, failClosed: true };

async function getTier(path: string, configService: ConfigService): Promise<RateLimitConfig> {
  // Admin auth endpoints - most restrictive (5 req/min)
  if (path.includes('/admin/login') || path.includes('/admin/2fa')) {
    const [max, window] = await Promise.all([
      configService.getNumber('rate_limit_admin_auth_max', DEFAULT_ADMIN_AUTH.maxRequests),
      configService.getNumber('rate_limit_admin_auth_window', DEFAULT_ADMIN_AUTH.windowSeconds),
    ]);
    return { maxRequests: max, windowSeconds: window, failClosed: true };
  }
  // Admin protected endpoints (30 req/min)
  if (path.includes('/admin/')) {
    const [max, window] = await Promise.all([
      configService.getNumber('rate_limit_admin_max', DEFAULT_ADMIN.maxRequests),
      configService.getNumber('rate_limit_admin_window', DEFAULT_ADMIN.windowSeconds),
    ]);
    return { maxRequests: max, windowSeconds: window, failClosed: true };
  }
  // Trading endpoints
  if (path.includes('/market/buy') || path.includes('/market/sell')) {
    const [max, window] = await Promise.all([
      configService.getNumber('rate_limit_trading_max', DEFAULT_TRADING.maxRequests),
      configService.getNumber('rate_limit_trading_window', DEFAULT_TRADING.windowSeconds),
    ]);
    return { maxRequests: max, windowSeconds: window, failClosed: true };
  }
  // User auth endpoints
  if (path.includes('/auth/login') || path.includes('/auth/register') || path.includes('/auth/forgot')) {
    const [max, window] = await Promise.all([
      configService.getNumber('rate_limit_auth_max', DEFAULT_AUTH.maxRequests),
      configService.getNumber('rate_limit_auth_window', DEFAULT_AUTH.windowSeconds),
    ]);
    return { maxRequests: max, windowSeconds: window, failClosed: true };
  }
  // General endpoints
  const [max, window] = await Promise.all([
    configService.getNumber('rate_limit_general_max', DEFAULT_GENERAL.maxRequests),
    configService.getNumber('rate_limit_general_window', DEFAULT_GENERAL.windowSeconds),
  ]);
  return { maxRequests: max, windowSeconds: window, failClosed: false };
}

/**
 * Check if path is a sensitive endpoint that should fail-closed
 */
function isSensitivePath(path: string): boolean {
  return path.includes('/admin/') ||
         path.includes('/market/buy') ||
         path.includes('/market/sell') ||
         path.includes('/auth/login') ||
         path.includes('/auth/register') ||
         path.includes('/auth/forgot');
}

export async function rateLimiter(c: Context<AppEnv>, next: Next) {
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const path = c.req.path;

  // Determine fail-closed mode early (before potential errors)
  const failClosed = isSensitivePath(path);

  try {
    const configService = new ConfigService(c.env.DB, c.env.CACHE);
    const tier = await getTier(path, configService);

    // Time-bucket key: auto-expires with KV TTL
    const bucket = Math.floor(Date.now() / (tier.windowSeconds * 1000));
    const env = c.env.ENVIRONMENT || 'development';
    const key = `${env}:ratelimit:${ip}:${bucket}`;

    const current = await c.env.CACHE.get(key);
    const count = current ? parseInt(current, 10) : 0;

    if (count >= tier.maxRequests) {
      c.header('X-RateLimit-Limit', String(tier.maxRequests));
      c.header('X-RateLimit-Remaining', '0');
      c.header('Retry-After', String(tier.windowSeconds));
      return c.json(
        {
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Trop de requêtes. Veuillez réessayer dans une minute.',
          },
          requestId: crypto.randomUUID(),
        },
        429
      );
    }

    // Increment counter (fire-and-forget for performance)
    c.executionCtx.waitUntil(
      c.env.CACHE.put(key, String(count + 1), { expirationTtl: tier.windowSeconds })
    );

    c.header('X-RateLimit-Limit', String(tier.maxRequests));
    c.header('X-RateLimit-Remaining', String(tier.maxRequests - count - 1));

    return next();
  } catch (error) {
    logger.warn('Rate limiter error', { error: String(error), path, failClosed });

    if (failClosed) {
      // SECURITY: Block sensitive endpoints when rate limiter is unavailable
      return c.json(
        {
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Service temporairement indisponible. Veuillez réessayer.',
          },
          requestId: crypto.randomUUID(),
        },
        503
      );
    }

    // Fail-open for non-sensitive endpoints only
    return next();
  }
}
