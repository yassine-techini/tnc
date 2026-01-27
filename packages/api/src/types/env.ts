/**
 * Cloudflare Workers Environment Bindings
 */

export interface Env {
  // Environment
  ENVIRONMENT: 'development' | 'staging' | 'production';
  
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
  
  // Secrets
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;
  
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

  // Exchange Rate API
  EXCHANGE_RATE_API_KEY: string;

  // Cloudflare Access (for admin/state portals)
  CF_ACCESS_TEAM_DOMAIN?: string;  // e.g., 'tnc-trading' (without .cloudflareaccess.com)
  CF_ACCESS_AUDIENCE?: string;      // Application audience tag for admin
  CF_ACCESS_STATE_AUDIENCE?: string; // Application audience tag for state portal
}

// Context type for Hono
export interface Context {
  Bindings: Env;
  Variables: {
    userId?: string;
    user?: User;
    requestId: string;
  };
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
