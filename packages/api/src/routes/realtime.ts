/**
 * Realtime Routes
 * WebSocket and Durable Object endpoints for real-time features
 */

import { Hono } from 'hono';
import type { Env, AppEnv } from '../types/env';
import { authMiddleware } from '../middleware/auth';
import { texte } from '../lib/reponse-erreur';

const realtime = new Hono<AppEnv>();

/**
 * Get Price Tracker Durable Object
 */
function getPriceTracker(env: Env) {
  const id = env.PRICE_TRACKER.idFromName('global-price-tracker');
  return env.PRICE_TRACKER.get(id);
}

/**
 * WebSocket upgrade for real-time price updates
 * GET /realtime/prices/ws
 *
 * Supports query params:
 * - userId: Optional user ID for price alerts
 */
realtime.get('/prices/ws', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.json({
      success: false,
      error: {
        code: 'WEBSOCKET_REQUIRED',
        message: texte(c, 'WEBSOCKET_REQUIRED'),
      },
    }, 400);
  }

  // Get optional userId from query or auth
  const userId = c.req.query('userId');

  // Forward the WebSocket request to the Durable Object
  const priceTracker = getPriceTracker(c.env);
  const url = new URL(c.req.url);
  url.pathname = '/ws';
  if (userId) {
    url.searchParams.set('userId', userId);
  }

  return priceTracker.fetch(new Request(url.toString(), {
    headers: c.req.raw.headers,
  }));
});

/**
 * Get current price from Durable Object (cached)
 * GET /realtime/prices/current
 */
realtime.get('/prices/current', async (c) => {
  const requestId = crypto.randomUUID();
  const priceTracker = getPriceTracker(c.env);

  const response = await priceTracker.fetch(new Request('http://do/price'));
  const price = await response.json();

  return c.json({
    success: true,
    data: price,
    requestId,
  });
});

/**
 * Get price history from Durable Object
 * GET /realtime/prices/history?period=1h|24h|7d
 */
realtime.get('/prices/history', async (c) => {
  const requestId = crypto.randomUUID();
  const period = c.req.query('period') || '1h';

  const priceTracker = getPriceTracker(c.env);
  const response = await priceTracker.fetch(
    new Request(`http://do/history?period=${period}`)
  );
  const data = await response.json();

  return c.json({
    success: true,
    data,
    requestId,
  });
});

/**
 * Get Durable Object health status
 * GET /realtime/prices/health
 */
realtime.get('/prices/health', async (c) => {
  const requestId = crypto.randomUUID();
  const priceTracker = getPriceTracker(c.env);

  const response = await priceTracker.fetch(new Request('http://do/health'));
  const health = await response.json();

  return c.json({
    success: true,
    data: health,
    requestId,
  });
});

/**
 * Subscribe to price alerts (requires auth)
 * POST /realtime/alerts
 * Body: { targetPrice: number, direction: 'above' | 'below' }
 */
realtime.post('/alerts', authMiddleware, async (c) => {
  const requestId = crypto.randomUUID();
  const userId = c.get('userId');
  const body = await c.req.json();

  if (!body.targetPrice || !body.direction) {
    return c.json({
      success: false,
      error: {
        code: 'INVALID_REQUEST',
        message: texte(c, 'INVALID_REQUEST'),
      },
      requestId,
    }, 400);
  }

  if (!['above', 'below'].includes(body.direction)) {
    return c.json({
      success: false,
      error: {
        code: 'INVALID_DIRECTION',
        message: texte(c, 'INVALID_DIRECTION'),
      },
      requestId,
    }, 400);
  }

  const priceTracker = getPriceTracker(c.env);
  await priceTracker.fetch(new Request('http://do/alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      targetPrice: body.targetPrice,
      direction: body.direction,
      createdAt: new Date().toISOString(),
    }),
  }));

  return c.json({
    success: true,
    data: {
      message: 'Alerte créée avec succès',
      targetPrice: body.targetPrice,
      direction: body.direction,
    },
    requestId,
  });
});

/**
 * Get user's price alerts (requires auth)
 * GET /realtime/alerts
 */
realtime.get('/alerts', authMiddleware, async (c) => {
  const requestId = crypto.randomUUID();
  const userId = c.get('userId');

  const priceTracker = getPriceTracker(c.env);
  const response = await priceTracker.fetch(new Request('http://do/alerts'));
  const data = await response.json() as { alerts: Array<{ userId: string }> };

  // Filter alerts for this user
  const userAlerts = data.alerts.filter(a => a.userId === userId);

  return c.json({
    success: true,
    data: { alerts: userAlerts },
    requestId,
  });
});

/**
 * Delete user's price alert (requires auth)
 * DELETE /realtime/alerts
 */
realtime.delete('/alerts', authMiddleware, async (c) => {
  const requestId = crypto.randomUUID();
  const userId = c.get('userId');

  const priceTracker = getPriceTracker(c.env);
  await priceTracker.fetch(new Request('http://do/alerts', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  }));

  return c.json({
    success: true,
    data: { message: 'Alerte supprimée' },
    requestId,
  });
});

/**
 * Start auto-refresh (admin only, development)
 * POST /realtime/prices/auto-refresh/start
 */
realtime.post('/prices/auto-refresh/start', async (c) => {
  const requestId = crypto.randomUUID();

  // Only allow in development or with proper auth
  if (c.env.ENVIRONMENT !== 'development') {
    const authHeader = c.req.header('X-Admin-Secret');
    if (authHeader !== c.env.WEBHOOK_SECRET) {
      return c.json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: texte(c, 'UNAUTHORIZED') },
        requestId,
      }, 401);
    }
  }

  const priceTracker = getPriceTracker(c.env);
  const response = await priceTracker.fetch(new Request('http://do/start', {
    method: 'POST',
  }));
  const result = await response.json();

  return c.json({
    success: true,
    data: result,
    requestId,
  });
});

/**
 * Stop auto-refresh (admin only)
 * POST /realtime/prices/auto-refresh/stop
 */
realtime.post('/prices/auto-refresh/stop', async (c) => {
  const requestId = crypto.randomUUID();

  if (c.env.ENVIRONMENT !== 'development') {
    const authHeader = c.req.header('X-Admin-Secret');
    if (authHeader !== c.env.WEBHOOK_SECRET) {
      return c.json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: texte(c, 'UNAUTHORIZED') },
        requestId,
      }, 401);
    }
  }

  const priceTracker = getPriceTracker(c.env);
  const response = await priceTracker.fetch(new Request('http://do/stop', {
    method: 'POST',
  }));
  const result = await response.json();

  return c.json({
    success: true,
    data: result,
    requestId,
  });
});

/**
 * Manually push price update to Durable Object
 * POST /realtime/prices/push
 * Used by scheduled workers or price refresh endpoint
 */
realtime.post('/prices/push', async (c) => {
  const requestId = crypto.randomUUID();

  // Verify authorization
  if (c.env.ENVIRONMENT !== 'development') {
    const authHeader = c.req.header('X-Refresh-Secret');
    if (authHeader !== c.env.WEBHOOK_SECRET) {
      return c.json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: texte(c, 'UNAUTHORIZED') },
        requestId,
      }, 401);
    }
  }

  const body = await c.req.json();
  const priceTracker = getPriceTracker(c.env);

  const response = await priceTracker.fetch(new Request('http://do/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  const result = await response.json();

  return c.json({
    success: true,
    data: result,
    requestId,
  });
});

export const realtimeRoutes = realtime;
