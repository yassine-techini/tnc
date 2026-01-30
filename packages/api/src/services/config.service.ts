/**
 * ConfigService - Reads platform configuration from D1 config table with KV caching
 */

interface ConfigRow {
  key: string;
  value: string;
  description: string | null;
  updated_by: string | null;
  updated_at: string;
}

export class ConfigService {
  private static readonly CACHE_PREFIX = 'config:';
  private static readonly CACHE_TTL = 300; // 5 minutes
  private static readonly BATCH_CACHE_KEY = 'config:__all__';

  // In-memory cache for the current request (avoids repeated KV reads)
  private _memoryCache: Record<string, string> | null = null;

  constructor(
    private db: D1Database,
    private kv: KVNamespace
  ) {}

  /**
   * Load entire config into memory (batch cache).
   * This dramatically reduces KV operations from 500+/sec to ~1/5min.
   */
  private async loadBatchCache(): Promise<Record<string, string>> {
    // Return memory cache if available (within same request)
    if (this._memoryCache) return this._memoryCache;

    // Try KV batch cache
    const cached = await this.kv.get(ConfigService.BATCH_CACHE_KEY, 'json') as Record<string, string> | null;
    if (cached) {
      this._memoryCache = cached;
      return cached;
    }

    // Load from DB and cache
    try {
      const result = await this.db
        .prepare('SELECT key, value FROM config')
        .all<{ key: string; value: string }>();

      const config: Record<string, string> = {};
      for (const row of result.results || []) {
        config[row.key] = row.value;
      }

      // Cache for 5 minutes
      await this.kv.put(ConfigService.BATCH_CACHE_KEY, JSON.stringify(config), {
        expirationTtl: ConfigService.CACHE_TTL,
      });

      this._memoryCache = config;
      return config;
    } catch {
      return {};
    }
  }

  /**
   * Invalidate the batch cache (call after any config update)
   */
  private async invalidateBatchCache(): Promise<void> {
    this._memoryCache = null;
    await this.kv.delete(ConfigService.BATCH_CACHE_KEY);
  }

  /**
   * Get a single config value by key (uses batch cache for efficiency)
   */
  async get(key: string, fallback?: string): Promise<string | null> {
    // Use batch cache - dramatically reduces KV operations
    const config = await this.loadBatchCache();
    return config[key] ?? fallback ?? null;
  }

  /**
   * Get a required config value with a guaranteed fallback (never returns null)
   */
  async getRequired(key: string, fallback: string): Promise<string> {
    const config = await this.loadBatchCache();
    return config[key] ?? fallback;
  }

  /**
   * Get a config value as a number
   */
  async getNumber(key: string, fallback: number): Promise<number> {
    const value = await this.get(key);
    if (value === null) return fallback;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? fallback : parsed;
  }

  /**
   * Get multiple config values by prefix
   */
  async getByPrefix(prefix: string): Promise<Record<string, string>> {
    try {
      const result = await this.db
        .prepare('SELECT key, value FROM config WHERE key LIKE ?')
        .bind(`${prefix}%`)
        .all<{ key: string; value: string }>();

      const map: Record<string, string> = {};
      for (const row of result.results || []) {
        map[row.key] = row.value;
      }
      return map;
    } catch {
      return {};
    }
  }

  /**
   * Set a config value (admin use) - invalidates cache
   */
  async set(key: string, value: string, description?: string, updatedBy?: string): Promise<void> {
    if (description !== undefined) {
      await this.db
        .prepare(
          `INSERT INTO config (key, value, description, updated_by, updated_at)
           VALUES (?, ?, ?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = ?, description = ?, updated_by = ?, updated_at = datetime('now')`
        )
        .bind(key, value, description, updatedBy || null, value, description, updatedBy || null)
        .run();
    } else {
      await this.db
        .prepare(
          `UPDATE config SET value = ?, updated_by = ?, updated_at = datetime('now') WHERE key = ?`
        )
        .bind(value, updatedBy || null, key)
        .run();
    }

    // Invalidate both individual and batch cache
    await this.kv.delete(`${ConfigService.CACHE_PREFIX}${key}`);
    await this.invalidateBatchCache();
  }

  /**
   * Get all config entries
   */
  async getAll(): Promise<ConfigRow[]> {
    try {
      const result = await this.db
        .prepare('SELECT key, value, description, updated_by, updated_at FROM config ORDER BY key')
        .all<ConfigRow>();
      return result.results || [];
    } catch {
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────────
  // API Keys helpers - these read from config table (set by super admin)
  // Falls back to env if provided (for backwards compatibility)
  // ─────────────────────────────────────────────────────────────

  /**
   * Get Gold API key (from config or env fallback)
   */
  async getGoldApiKey(envFallback?: string): Promise<string | null> {
    return await this.get('gold_api_key', envFallback);
  }

  /**
   * Get Exchange Rate API key
   */
  async getExchangeRateApiKey(envFallback?: string): Promise<string | null> {
    return await this.get('exchange_rate_api_key', envFallback);
  }

  /**
   * Get Twilio credentials
   */
  async getTwilioConfig(env?: { accountSid?: string; authToken?: string; phoneNumber?: string }) {
    const [accountSid, authToken, phoneNumber] = await Promise.all([
      this.get('twilio_account_sid', env?.accountSid),
      this.get('twilio_auth_token', env?.authToken),
      this.get('twilio_phone_number', env?.phoneNumber),
    ]);
    return { accountSid, authToken, phoneNumber };
  }

  /**
   * Get Resend API key
   */
  async getResendApiKey(envFallback?: string): Promise<string | null> {
    return await this.get('resend_api_key', envFallback);
  }

  /**
   * Get SendGrid API key
   */
  async getSendGridApiKey(envFallback?: string): Promise<string | null> {
    return await this.get('sendgrid_api_key', envFallback);
  }

  /**
   * Get Orange Money credentials
   */
  async getOrangeMoneyConfig(env?: { apiKey?: string; merchantId?: string; clientSecret?: string }) {
    const [apiKey, merchantId, clientSecret] = await Promise.all([
      this.get('orange_money_api_key', env?.apiKey),
      this.get('orange_money_merchant_id', env?.merchantId),
      this.get('orange_money_client_secret', env?.clientSecret),
    ]);
    return { apiKey, merchantId, clientSecret };
  }

  /**
   * Get Moov credentials
   */
  async getMoovConfig(env?: { apiKey?: string; merchantId?: string; moneyApiKey?: string }) {
    const [apiKey, merchantId, moneyApiKey] = await Promise.all([
      this.get('moov_api_key', env?.apiKey),
      this.get('moov_merchant_id', env?.merchantId),
      this.get('moov_money_api_key', env?.moneyApiKey),
    ]);
    return { apiKey, merchantId, moneyApiKey };
  }

  /**
   * Get CinetPay credentials
   */
  async getCinetPayConfig(env?: { apiKey?: string; siteId?: string }) {
    const [apiKey, siteId] = await Promise.all([
      this.get('cinetpay_api_key', env?.apiKey),
      this.get('cinetpay_site_id', env?.siteId),
    ]);
    return { apiKey, siteId };
  }

  /**
   * Get Stripe credentials
   */
  async getStripeConfig(env?: { secretKey?: string; webhookSecret?: string }) {
    const [secretKey, webhookSecret] = await Promise.all([
      this.get('stripe_secret_key', env?.secretKey),
      this.get('stripe_webhook_secret', env?.webhookSecret),
    ]);
    return { secretKey, webhookSecret };
  }

  /**
   * Get Smile Identity (KYC) credentials
   */
  async getSmileIdentityConfig(env?: { apiKey?: string; partnerId?: string }) {
    const [apiKey, partnerId] = await Promise.all([
      this.get('smile_identity_api_key', env?.apiKey),
      this.get('smile_identity_partner_id', env?.partnerId),
    ]);
    return { apiKey, partnerId };
  }

  /**
   * Get webhook secret for validating incoming webhooks
   */
  async getWebhookSecret(envFallback?: string): Promise<string | null> {
    return await this.get('webhook_secret', envFallback);
  }

  /**
   * Get FCM server key for push notifications
   */
  async getFcmServerKey(envFallback?: string): Promise<string | null> {
    return await this.get('fcm_server_key', envFallback);
  }

  /**
   * Check if platform is configured (has essential API keys)
   */
  async isPlatformConfigured(): Promise<{ configured: boolean; missing: string[] }> {
    const essentialKeys = [
      'gold_api_key',
      'twilio_account_sid',
      'twilio_auth_token',
      'resend_api_key',
    ];

    const missing: string[] = [];
    for (const key of essentialKeys) {
      const value = await this.get(key);
      if (!value) missing.push(key);
    }

    return { configured: missing.length === 0, missing };
  }
}
