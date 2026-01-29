/**
 * TNC Trading API - Main Entry Point
 * Cloudflare Workers with HonoJS
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { timing } from 'hono/timing';
import { prettyJSON } from 'hono/pretty-json';
// Note: compression is handled by Cloudflare edge — do NOT use hono/compress on Workers (causes double-encoding)

// Types
import type { Env, AppEnv } from './types/env';

// Middleware
import { authMiddleware } from './middleware/auth';
import { rateLimiter } from './middleware/rate-limiter';
import { errorHandler } from './middleware/error-handler';
import { analyticsMiddleware } from './middleware/analytics';

// Routes
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { marketRoutes } from './routes/market';
import { walletRoutes } from './routes/wallet';
import { adminRoutes } from './routes/admin';
import { stateRoutes } from './routes/state';
import { webhookRoutes } from './routes/webhooks';
import { verifyRoutes } from './routes/verify';
import { setupRoutes } from './routes/setup';
import { realtimeRoutes } from './routes/realtime';

// Create Hono app
const app = new Hono<AppEnv>();

// ============================================
// Global Middleware
// ============================================

// Environment validation — fail fast if critical secrets are missing
// Note: API keys (GOLD_API_KEY, TWILIO_*, RESEND_*, etc.) are now configured
// via the admin UI in the config table, not as environment secrets.
app.use('*', async (c, next) => {
  const env = c.env;

  // Only these core bindings must be present at startup
  // All other API keys are configured via super admin interface
  const requiredBindings: Array<{ key: keyof Env; name: string }> = [
    { key: 'DB', name: 'D1 database binding' },
    { key: 'JWT_SECRET', name: 'JWT secret' },
    { key: 'ENCRYPTION_KEY', name: 'Encryption key' },
  ];

  // Validate required bindings
  for (const { key, name } of requiredBindings) {
    if (!env[key]) {
      console.error(`FATAL: ${name} (${key}) is not set`);
      return c.json({
        success: false,
        error: { code: 'CONFIG_ERROR', message: 'Server misconfigured' }
      }, 500);
    }
  }

  await next();
});

// Compression is handled by Cloudflare edge — no app-level compress() needed

// Request logging
app.use('*', logger());

// Request timing
app.use('*', timing());

// Pretty JSON in development
app.use('*', prettyJSON());

// CSRF Origin validation for mutation requests
app.use('*', async (c, next) => {
  const method = c.req.method;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const origin = c.req.header('Origin');
    const referer = c.req.header('Referer');

    // Allow webhook routes (authenticated via signature, not origin)
    if (c.req.path.includes('/webhooks/')) {
      return next();
    }

    // Validate origin matches allowed origins
    if (origin) {
      // Origins are loaded from env (comma-separated) with sensible defaults
      const envOrigins = c.env.ALLOWED_ORIGINS || '';
      const allowedOrigins = envOrigins
        ? envOrigins.split(',').map((o: string) => o.trim())
        : [
            'http://localhost:5173',
            'http://localhost:3000',
            'http://localhost:5174',
            'http://localhost:5175',
            'https://bf.tnc.trading',
            'https://bf-admin.tnc.trading',
            'https://bf-state.tnc.trading',
            'https://tnc-trading-web.pages.dev',
            'https://tnc-trading-admin.pages.dev',
            'https://tnc-trading-state-portal.pages.dev',
            // Staging URLs
            'https://tnc-trading-web-staging.pages.dev',
            'https://tnc-trading-admin-staging.pages.dev',
            'https://tnc-trading-state-staging.pages.dev',
          ];
      const pagesDevPattern = /^https:\/\/[a-z0-9]+\.tnc-trading-(web|admin|state-portal)(-dev)?\.pages\.dev$/;
      const isAllowed = allowedOrigins.includes(origin)
        || pagesDevPattern.test(origin)
        || origin === 'https://tnc-trading-web.pages.dev'
        || origin === 'https://tnc-trading-admin.pages.dev'
        || origin === 'https://tnc-trading-state-portal.pages.dev'
        || origin.endsWith('.tnc-trading-web-dev.pages.dev')
        || origin.endsWith('.tnc-trading-admin-dev.pages.dev')
        || origin.endsWith('.tnc-trading-state-portal-dev.pages.dev')
        || origin.endsWith('.tnc-trading-web.pages.dev')
        || origin.endsWith('.tnc-trading-admin.pages.dev')
        || origin.endsWith('.tnc-trading-state-portal.pages.dev')
        // Staging preview URLs
        || origin.endsWith('.tnc-trading-web-staging.pages.dev')
        || origin.endsWith('.tnc-trading-admin-staging.pages.dev')
        || origin.endsWith('.tnc-trading-state-staging.pages.dev');

      if (!isAllowed) {
        return c.json({
          success: false,
          error: {
            code: 'CSRF_ORIGIN_REJECTED',
            message: 'Origin non autorisée',
          },
          requestId: crypto.randomUUID(),
        }, 403);
      }
    }
  }
  return next();
});

// Security headers
app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    fontSrc: ["'self'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    connectSrc: ["'self'", 'https://bf-api.tnc.trading', 'https://tnc-trading-api.yassine-techini.workers.dev'],
  },
  xFrameOptions: 'DENY',
  xContentTypeOptions: 'nosniff',
  referrerPolicy: 'strict-origin-when-cross-origin',
}));

// CORS — origins from env (comma-separated) with fallback defaults
app.use('*', cors({
  origin: (origin, c) => {
    const envOrigins = c.env.ALLOWED_ORIGINS || '';
    const allowedOrigins = envOrigins
      ? envOrigins.split(',').map((o: string) => o.trim())
      : [
          'http://localhost:5173',
          'http://localhost:3000',
          'http://localhost:5174',
          'http://localhost:5175',
          'https://bf.tnc.trading',
          'https://bf-admin.tnc.trading',
          'https://bf-state.tnc.trading',
          'https://tnc-trading-web.pages.dev',
          'https://tnc-trading-admin.pages.dev',
          'https://tnc-trading-state-portal.pages.dev',
        ];

    // Allow exact matches
    if (!origin || allowedOrigins.includes(origin)) {
      return origin || '*';
    }

    // Allow Cloudflare Pages preview deployments (e.g., https://abc123.tnc-trading-admin.pages.dev)
    const pagesDevPattern = /^https:\/\/[a-z0-9]+\.tnc-trading-(web|admin|state)(-dev)?\.pages\.dev$/;
    if (pagesDevPattern.test(origin)) {
      return origin;
    }

    return null;
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposeHeaders: ['X-Request-ID', 'X-RateLimit-Remaining'],
  maxAge: 86400, // 24h — configurable via CORS_MAX_AGE env var if Env interface extended
}));

// Rate limiting
app.use('/api/*', rateLimiter);

// Analytics tracking (fire-and-forget, after response)
app.use('/api/*', analyticsMiddleware);

// Global error handler
app.onError(errorHandler);

// ============================================
// Health Check
// ============================================

app.get('/', (c) => {
  return c.json({
    name: 'TNC Trading API',
    version: '1.0.0',
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: c.env.ENVIRONMENT || 'development',
  });
});

// ============================================
// API Routes
// ============================================

const api = new Hono<AppEnv>();

// Public routes (no auth required)
api.route('/auth', authRoutes);

// Protected routes (auth handled by routes)
api.use('/users/*', authMiddleware);
api.use('/wallet/*', authMiddleware);
api.route('/users', userRoutes);
api.route('/market', marketRoutes);  // Market has mixed public/protected routes
api.route('/wallet', walletRoutes);

// Admin routes (Cloudflare Access auth)
api.route('/admin', adminRoutes);

// State portal routes (Cloudflare Access auth)
api.route('/state', stateRoutes);

// Webhook routes (signature verification)
api.route('/webhooks', webhookRoutes);

// Public certificate verification (no auth required)
api.route('/verify', verifyRoutes);

// Setup routes (for initial configuration)
api.route('/setup', setupRoutes);

// Realtime routes (WebSocket and Durable Objects)
api.route('/realtime', realtimeRoutes);

// Mount API routes
app.route('/api/v1', api);

// ============================================
// 404 Handler
// ============================================

app.notFound((c) => {
  return c.json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${c.req.method} ${c.req.path} not found`,
    },
    requestId: c.req.header('X-Request-ID') || crypto.randomUUID(),
  }, 404);
});

// ============================================
// Export
// ============================================

// Import scheduled handler
import { handleScheduled, type ScheduledController } from './scheduled';

// Import notification service for queue consumer
import { NotificationService, type NotificationQueueMessage } from './services/notification.service';

// Import alert service for queue consumer
import { AlertService, type AlertQueueMessage } from './services/alert.service';

// Import config service for runtime configuration
import { ConfigService } from './services/config.service';

// Import tail handler for log archival
import { handleTail, type TraceItem } from './tail-handler';

// Export as module with fetch, scheduled, queue, and tail handlers
export default {
  fetch: app.fetch,

  // Scheduled handler for cron triggers
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    await handleScheduled(controller, env, ctx);
  },

  // Queue consumer for async notifications and alerts
  async queue(
    batch: MessageBatch<NotificationQueueMessage | AlertQueueMessage>,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    // Initialize config service for runtime configuration
    const configService = new ConfigService(env.DB, env.CACHE);

    // Initialize services with config service for runtime API key loading
    // Env values serve as fallback if not configured in DB
    const notificationService = new NotificationService(env.DB, {
      resendApiKey: env.RESEND_API_KEY,
      sendgridApiKey: env.SENDGRID_API_KEY,
      twilioAccountSid: env.TWILIO_ACCOUNT_SID,
      twilioAuthToken: env.TWILIO_AUTH_TOKEN,
      twilioPhoneNumber: env.TWILIO_PHONE_NUMBER,
      fcmServerKey: env.FCM_SERVER_KEY,
    }, undefined, configService);

    const alertService = new AlertService(env.DB, undefined, {
      resendApiKey: env.RESEND_API_KEY,
      twilioAccountSid: env.TWILIO_ACCOUNT_SID,
      twilioAuthToken: env.TWILIO_AUTH_TOKEN,
      twilioPhoneNumber: env.TWILIO_PHONE_NUMBER,
      alertEmailRecipients: env.ALERT_EMAIL_RECIPIENTS,
      alertSmsRecipients: env.ALERT_SMS_RECIPIENTS,
    }, configService);

    for (const message of batch.messages) {
      try {
        const body = message.body;

        // Route based on message type
        if ('type' in body && body.type === 'ALERT_TRIGGER') {
          await alertService.processQueueMessage(body as AlertQueueMessage);
        } else {
          await notificationService.processNotification(body as NotificationQueueMessage);
        }

        message.ack();
      } catch (error) {
        console.error('Queue message processing failed:', error);
        message.retry();
      }
    }
  },

  // Tail handler for log archival
  async tail(
    events: TraceItem[],
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    await handleTail(events, env, ctx);
  },
};

// Export Durable Objects
export { PriceTracker } from './durable-objects/price-tracker';
export { TransactionSession } from './durable-objects/transaction-session';
export { AnalyticsHub } from './durable-objects/analytics-hub';
