import { Context, Next } from 'hono';
import type { AppEnv } from '../types/env';
import { ConfigService } from '../services/config.service';
import { logger } from '../lib/logger';

/**
 * Rate limiter using Cloudflare KV with time-bucketed keys.
 * Three tiers: general, auth, trading — all configurable via DB config.
 * Fail-open: if KV is unavailable, requests pass through.
 */

interface RateLimitConfig {
  windowSeconds: number;
  maxRequests: number;
}

// Defaults used when ConfigService is unavailable
const DEFAULT_GENERAL: RateLimitConfig = { windowSeconds: 60, maxRequests: 100 };
const DEFAULT_AUTH: RateLimitConfig = { windowSeconds: 60, maxRequests: 20 };
const DEFAULT_TRADING: RateLimitConfig = { windowSeconds: 60, maxRequests: 10 };

async function getTier(path: string, configService: ConfigService): Promise<RateLimitConfig> {
  if (path.includes('/market/buy') || path.includes('/market/sell')) {
    const [max, window] = await Promise.all([
      configService.getNumber('rate_limit_trading_max', DEFAULT_TRADING.maxRequests),
      configService.getNumber('rate_limit_trading_window', DEFAULT_TRADING.windowSeconds),
    ]);
    return { maxRequests: max, windowSeconds: window };
  }
  if (path.includes('/auth/login') || path.includes('/auth/register') || path.includes('/auth/forgot')) {
    const [max, window] = await Promise.all([
      configService.getNumber('rate_limit_auth_max', DEFAULT_AUTH.maxRequests),
      configService.getNumber('rate_limit_auth_window', DEFAULT_AUTH.windowSeconds),
    ]);
    return { maxRequests: max, windowSeconds: window };
  }
  const [max, window] = await Promise.all([
    configService.getNumber('rate_limit_general_max', DEFAULT_GENERAL.maxRequests),
    configService.getNumber('rate_limit_general_window', DEFAULT_GENERAL.windowSeconds),
  ]);
  return { maxRequests: max, windowSeconds: window };
}

export async function rateLimiter(c: Context<AppEnv>, next: Next) {
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const path = c.req.path;

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

    await next();
  } catch (error) {
    // Fail-open: if KV is unavailable, allow request through
    logger.warn('Rate limiter KV unavailable, allowing request', { error: String(error) });
    await next();
  }
}
