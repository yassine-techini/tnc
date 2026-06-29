/**
 * Cloudflare Workers Environment Bindings
 */

export interface Env {
  // Environment
  ENVIRONMENT: 'development' | 'staging' | 'production';
  ALLOWED_ORIGINS?: string;

  // Cloudflare D1 Database
  DB: D1Database;
  
  // Cloudflare KV Namespace (Cache)
  CACHE: KVNamespace;
  
  // Cloudflare R2 Bucket (Storage)
  STORAGE: R2Bucket;
  
  // Cloudflare Queues
  NOTIFICATION_QUEUE: Queue;
  
  // Durable Objects
  PRICE_TRACKER: DurableObjectNamespace;
  TRANSACTION_SESSION: DurableObjectNamespace;
  ANALYTICS_HUB: DurableObjectNamespace;

  // Analytics Engine
  ANALYTICS: AnalyticsEngineDataset;

  // Logs Storage (R2)
  LOGS_STORAGE: R2Bucket;

  // Alert Queue
  ALERT_QUEUE: Queue;
  
  // Secrets
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;

  // Bootstrap / setup routes (must be set to enable /setup/* in any environment)
  SETUP_SECRET?: string;
  SETUP_ADMIN_PASSWORD?: string;
  SETUP_STATE_PASSWORD?: string;
  SETUP_DEMO_PASSWORD?: string;
  
  // Gold API
  GOLD_API_KEY: string;
  
  // KYC Provider
  SMILE_IDENTITY_API_KEY: string;
  SMILE_IDENTITY_PARTNER_ID: string;
  
  // Payment Providers
  ORANGE_MONEY_API_KEY: string;
  ORANGE_MONEY_MERCHANT_ID: string;
  ORANGE_MONEY_CLIENT_ID: string;
  ORANGE_MONEY_CLIENT_SECRET: string;
  MOOV_API_KEY: string;
  MOOV_MERCHANT_ID: string;
  MOOV_MONEY_API_KEY: string;
  CINETPAY_API_KEY: string;
  CINETPAY_SITE_ID: string;
  WEBHOOK_SECRET: string;

  // Notifications
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_PHONE_NUMBER: string;
  RESEND_API_KEY: string;
  SENDGRID_API_KEY: string;
  FCM_SERVER_KEY: string;

  // Alert Recipients (comma-separated)
  ALERT_EMAIL_RECIPIENTS?: string;
  ALERT_SMS_RECIPIENTS?: string;

  // Stripe (International card payments)
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;

  // Exchange Rate API
  EXCHANGE_RATE_API_KEY: string;

  // Error Monitoring
  SENTRY_DSN?: string;

  // Cloudflare Access (for admin/state portals)
  CF_ACCESS_TEAM_DOMAIN?: string;  // e.g., 'tnc-trading' (without .cloudflareaccess.com)
  CF_ACCESS_AUDIENCE?: string;      // Application audience tag for admin
  CF_ACCESS_STATE_AUDIENCE?: string; // Application audience tag for state portal
}

// Hono context variables set by middleware
export interface AppVariables {
  userId: string;
  userEmail: string;
  kycLevel: string;
  adminId: string;
  adminEmail: string;
  adminRole: string;
  requestId: string;
  user?: User;
}

// Full Hono app environment type — use as Hono<AppEnv>
export interface AppEnv {
  Bindings: Env;
  Variables: AppVariables;
}

// User type from JWT
export interface User {
  id: string;
  email: string;
  phone: string;
  kycLevel: 'BASIC' | 'STANDARD' | 'VERIFIED';
  kycStatus: 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  twoFactorEnabled: boolean;
}
