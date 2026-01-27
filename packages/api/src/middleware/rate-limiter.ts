import { Context, Next } from 'hono';
import type { Env } from '../types/env';

/**
 * Rate limiter using Cloudflare KV with time-bucketed keys.
 * Three tiers: general (100/min), auth (20/min), trading (10/min).
 * Fail-open: if KV is unavailable, requests pass through.
 */

interface RateLimitConfig {
  windowSeconds: number;
  maxRequests: number;
}

const TIER_GENERAL: RateLimitConfig = { windowSeconds: 60, maxRequests: 100 };
const TIER_AUTH: RateLimitConfig = { windowSeconds: 60, maxRequests: 20 };
const TIER_TRADING: RateLimitConfig = { windowSeconds: 60, maxRequests: 10 };

function getTier(path: string): RateLimitConfig {
  if (path.includes('/market/buy') || path.includes('/market/sell')) {
    return TIER_TRADING;
  }
  if (path.includes('/auth/login') || path.includes('/auth/register') || path.includes('/auth/forgot')) {
    return TIER_AUTH;
  }
  return TIER_GENERAL;
}

export async function rateLimiter(c: Context<{ Bindings: Env }>, next: Next) {
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const path = c.req.path;
  const tier = getTier(path);

  try {
    // Time-bucket key: auto-expires with KV TTL
    const bucket = Math.floor(Date.now() / (tier.windowSeconds * 1000));
    const key = `ratelimit:${ip}:${bucket}`;

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
    // Fail-open: if KV fails, allow the request through
    console.error('Rate limiter error:', error);
    await next();
  }
}
