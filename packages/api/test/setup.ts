/**
 * Test Setup - Mocks and utilities for API tests
 */

import { vi } from 'vitest';

// ─── D1 Database Mock ─────────────────────────────────────
export interface MockD1Result<T = unknown> {
  results: T[];
  meta: { changes: number; duration: number };
  success: boolean;
}

export interface MockD1PreparedStatement {
  bind: (...args: unknown[]) => MockD1PreparedStatement;
  first: <T = unknown>() => Promise<T | null>;
  all: <T = unknown>() => Promise<MockD1Result<T>>;
  run: () => Promise<{ meta: { changes: number } }>;
}

export function createMockD1Database(overrides: {
  first?: unknown;
  all?: unknown[];
  changes?: number;
} = {}): D1Database {
  const mockStatement: MockD1PreparedStatement = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(overrides.first ?? null),
    all: vi.fn().mockResolvedValue({
      results: overrides.all ?? [],
      meta: { changes: 0, duration: 0 },
      success: true,
    }),
    run: vi.fn().mockResolvedValue({
      meta: { changes: overrides.changes ?? 1 },
    }),
  };

  return {
    prepare: vi.fn().mockReturnValue(mockStatement),
    dump: vi.fn(),
    batch: vi.fn(),
    exec: vi.fn(),
  } as unknown as D1Database;
}

// ─── KV Namespace Mock ────────────────────────────────────
export function createMockKVNamespace(data: Record<string, unknown> = {}): KVNamespace {
  const store = new Map(Object.entries(data));

  return {
    get: vi.fn(async (key: string, format?: string) => {
      const value = store.get(key);
      if (value === undefined) return null;
      if (format === 'json') return value;
      return String(value);
    }),
    put: vi.fn(async (key: string, value: string | ArrayBuffer) => {
      store.set(key, typeof value === 'string' ? value : value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async () => ({
      keys: Array.from(store.keys()).map((name) => ({ name })),
      list_complete: true,
      cacheStatus: null,
    })),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

// ─── R2 Bucket Mock ───────────────────────────────────────
export function createMockR2Bucket(): R2Bucket {
  const store = new Map<string, ArrayBuffer>();

  return {
    put: vi.fn(async (key: string, value: ArrayBuffer | string) => {
      const buffer = typeof value === 'string' ? new TextEncoder().encode(value) : value;
      store.set(key, buffer);
      return { key, size: buffer.byteLength };
    }),
    get: vi.fn(async (key: string) => {
      const data = store.get(key);
      if (!data) return null;
      return {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(data));
            controller.close();
          },
        }),
        arrayBuffer: () => Promise.resolve(data),
        text: () => Promise.resolve(new TextDecoder().decode(data)),
        json: () => Promise.resolve(JSON.parse(new TextDecoder().decode(data))),
        blob: () => Promise.resolve(new Blob([data])),
      };
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    head: vi.fn(async (key: string) => {
      const data = store.get(key);
      if (!data) return null;
      return { key, size: data.byteLength };
    }),
    list: vi.fn(async () => ({
      objects: Array.from(store.entries()).map(([key, value]) => ({
        key,
        size: value.byteLength,
      })),
      truncated: false,
    })),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
  } as unknown as R2Bucket;
}

// ─── Queue Mock ───────────────────────────────────────────
export function createMockQueue(): Queue {
  const messages: unknown[] = [];

  return {
    send: vi.fn(async (message: unknown) => {
      messages.push(message);
    }),
    sendBatch: vi.fn(async (batch: { body: unknown }[]) => {
      messages.push(...batch.map((m) => m.body));
    }),
    getMessages: () => messages,
  } as unknown as Queue & { getMessages: () => unknown[] };
}

// ─── Durable Object Mock ──────────────────────────────────
export function createMockDurableObjectNamespace(): DurableObjectNamespace {
  return {
    idFromName: vi.fn((name: string) => ({ name, toString: () => name })),
    idFromString: vi.fn((id: string) => ({ id, toString: () => id })),
    newUniqueId: vi.fn(() => ({ id: crypto.randomUUID(), toString: () => crypto.randomUUID() })),
    get: vi.fn(() => ({
      fetch: vi.fn(async () => new Response(JSON.stringify({ success: true }))),
    })),
    jurisdiction: vi.fn(),
  } as unknown as DurableObjectNamespace;
}

// ─── Analytics Engine Mock ────────────────────────────────
export function createMockAnalyticsEngine(): AnalyticsEngineDataset {
  const events: unknown[] = [];

  return {
    writeDataPoint: vi.fn((event: unknown) => {
      events.push(event);
    }),
    getEvents: () => events,
  } as unknown as AnalyticsEngineDataset & { getEvents: () => unknown[] };
}

// ─── Full Environment Mock ────────────────────────────────
export interface MockEnv {
  ENVIRONMENT: 'development' | 'staging' | 'production';
  DB: D1Database;
  CACHE: KVNamespace;
  STORAGE: R2Bucket;
  LOGS_STORAGE: R2Bucket;
  NOTIFICATION_QUEUE: Queue;
  ALERT_QUEUE: Queue;
  PRICE_TRACKER: DurableObjectNamespace;
  TRANSACTION_SESSION: DurableObjectNamespace;
  ANALYTICS_HUB: DurableObjectNamespace;
  ANALYTICS: AnalyticsEngineDataset;
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;
  GOLD_API_KEY: string;
  SMILE_IDENTITY_API_KEY: string;
  SMILE_IDENTITY_PARTNER_ID: string;
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
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_PHONE_NUMBER: string;
  RESEND_API_KEY: string;
  SENDGRID_API_KEY: string;
  FCM_SERVER_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  EXCHANGE_RATE_API_KEY: string;
}

export function createMockEnv(overrides: Partial<MockEnv> = {}): MockEnv {
  return {
    ENVIRONMENT: 'development',
    DB: createMockD1Database(),
    CACHE: createMockKVNamespace(),
    STORAGE: createMockR2Bucket(),
    LOGS_STORAGE: createMockR2Bucket(),
    NOTIFICATION_QUEUE: createMockQueue(),
    ALERT_QUEUE: createMockQueue(),
    PRICE_TRACKER: createMockDurableObjectNamespace(),
    TRANSACTION_SESSION: createMockDurableObjectNamespace(),
    ANALYTICS_HUB: createMockDurableObjectNamespace(),
    ANALYTICS: createMockAnalyticsEngine(),
    JWT_SECRET: 'test-jwt-secret-key-at-least-32-chars',
    ENCRYPTION_KEY: 'test-encryption-key-32-characters',
    GOLD_API_KEY: 'test-gold-api-key',
    SMILE_IDENTITY_API_KEY: 'test-smile-key',
    SMILE_IDENTITY_PARTNER_ID: 'test-partner-id',
    ORANGE_MONEY_API_KEY: 'test-om-key',
    ORANGE_MONEY_MERCHANT_ID: 'test-om-merchant',
    ORANGE_MONEY_CLIENT_ID: 'test-om-client',
    ORANGE_MONEY_CLIENT_SECRET: 'test-om-secret',
    MOOV_API_KEY: 'test-moov-key',
    MOOV_MERCHANT_ID: 'test-moov-merchant',
    MOOV_MONEY_API_KEY: 'test-moov-money-key',
    CINETPAY_API_KEY: 'test-cinetpay-key',
    CINETPAY_SITE_ID: 'test-cinetpay-site',
    WEBHOOK_SECRET: 'test-webhook-secret',
    TWILIO_ACCOUNT_SID: 'test-twilio-sid',
    TWILIO_AUTH_TOKEN: 'test-twilio-token',
    TWILIO_PHONE_NUMBER: '+22600000000',
    RESEND_API_KEY: 'test-resend-key',
    SENDGRID_API_KEY: 'test-sendgrid-key',
    FCM_SERVER_KEY: 'test-fcm-key',
    STRIPE_SECRET_KEY: 'sk_test_1234567890',
    STRIPE_WEBHOOK_SECRET: 'whsec_test_1234567890',
    EXCHANGE_RATE_API_KEY: 'test-exchange-key',
    ...overrides,
  };
}

// ─── Test Data Factories ──────────────────────────────────
export const testData = {
  user: (overrides = {}) => ({
    id: crypto.randomUUID(),
    email: 'test@example.com',
    phone: '+22670000000',
    password_hash: '$argon2id$test$hash',
    kyc_level: 'BASIC',
    kyc_status: 'PENDING',
    email_verified: true,
    phone_verified: true,
    two_factor_enabled: false,
    country: 'BF',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }),

  wallet: (userId: string, overrides = {}) => ({
    id: crypto.randomUUID(),
    user_id: userId,
    token_balance: 0,
    cash_balance: 0,
    total_bought: 0,
    total_spent: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }),

  transaction: (userId: string, walletId: string, overrides = {}) => ({
    id: crypto.randomUUID(),
    user_id: userId,
    wallet_id: walletId,
    type: 'BUY' as const,
    status: 'PENDING' as const,
    token_amount: 1,
    cash_amount: 53000,
    price_per_gram: 53000,
    fees: 265,
    payment_method: 'orange_money',
    payment_reference: null,
    failure_reason: null,
    created_at: new Date().toISOString(),
    completed_at: null,
    ...overrides,
  }),

  goldPrice: (overrides = {}) => ({
    id: crypto.randomUUID(),
    price_usd: 85.5,
    price_xof: 52582.5,
    exchange_rate: 615,
    buy_price: 53634.15,
    sell_price: 51530.85,
    source: 'goldapi',
    timestamp: new Date().toISOString(),
    ...overrides,
  }),

  goldStock: (overrides = {}) => ({
    id: 'main',
    total_allocated: 10000,
    tokens_issued: 5000,
    low_stock_threshold: 100,
    last_audit_date: null,
    last_audit_result: null,
    audited_by: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  }),

  quote: (userId: string, overrides = {}) => ({
    id: crypto.randomUUID(),
    user_id: userId,
    type: 'BUY' as const,
    token_amount: 1,
    cash_amount: 53000,
    price_per_gram: 53000,
    fees: 265,
    total: 53265,
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    status: 'PENDING' as const,
    created_at: new Date().toISOString(),
    ...overrides,
  }),

  admin: (overrides = {}) => ({
    id: crypto.randomUUID(),
    email: 'admin@tnc-trading.com',
    password_hash: '$argon2id$test$hash',
    role: 'ADMIN',
    two_factor_enabled: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }),

  kycDocument: (userId: string, overrides = {}) => ({
    id: crypto.randomUUID(),
    user_id: userId,
    document_type: 'CNIB',
    document_number: 'B12345678',
    front_image_url: 'encrypted://documents/front.jpg',
    back_image_url: 'encrypted://documents/back.jpg',
    selfie_url: 'encrypted://documents/selfie.jpg',
    verification_status: 'PENDING',
    created_at: new Date().toISOString(),
    ...overrides,
  }),
};

// ─── HTTP Response Mock ───────────────────────────────────
export function mockFetch(responses: Record<string, unknown>) {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();

    for (const [pattern, response] of Object.entries(responses)) {
      if (url.includes(pattern)) {
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  });

  return () => {
    globalThis.fetch = originalFetch;
  };
}

// ─── Time Mock ────────────────────────────────────────────
export function mockTime(date: Date | string) {
  const timestamp = typeof date === 'string' ? new Date(date).getTime() : date.getTime();
  vi.useFakeTimers();
  vi.setSystemTime(timestamp);
  return () => vi.useRealTimers();
}
