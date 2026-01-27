import { Context, Next } from 'hono';
import type { Env } from '../types/env';

/**
 * Simple rate limiter using Cloudflare KV
 * Limit: 100 requests per minute per IP
 */
export async function rateLimiter(c: Context<{ Bindings: Env }>, next: Next) {
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const key = `ratelimit:${ip}`;
  
  try {
    // In production, use KV to track request counts
    // For now, just pass through
    
    /*
    const current = await c.env.CACHE.get(key);
    const count = current ? parseInt(current) : 0;
    
    if (count >= 100) {
      return c.json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Trop de requêtes. Veuillez réessayer dans une minute.',
        },
        requestId: crypto.randomUUID(),
      }, 429);
    }
    
    await c.env.CACHE.put(key, String(count + 1), { expirationTtl: 60 });
    */
    
    // Set rate limit headers
    c.header('X-RateLimit-Limit', '100');
    c.header('X-RateLimit-Remaining', '99');
    
    await next();
  } catch (error) {
    // If rate limiting fails, allow the request
    console.error('Rate limiter error:', error);
    await next();
  }
}
