/**
 * GoldAPI Integration Service
 * Fetches real-time gold prices from multiple sources
 * Primary: GoldAPI.io
 * Fallback: Metals-API, static BCEAO rate
 */

export interface GoldPriceData {
  priceUsd: number;      // USD per gram
  priceXof: number;      // XOF per gram
  exchangeRate: number;  // USD/XOF rate
  source: string;
  timestamp: Date;
}

export interface GoldAPIResponse {
  timestamp: number;
  metal: string;
  currency: string;
  exchange: string;
  symbol: string;
  prev_close_price: number;
  open_price: number;
  low_price: number;
  high_price: number;
  open_time: number;
  price: number;
  ch: number;
  chp: number;
  ask: number;
  bid: number;
  price_gram_24k: number;
  price_gram_22k: number;
  price_gram_21k: number;
  price_gram_20k: number;
  price_gram_18k: number;
  price_gram_16k: number;
  price_gram_14k: number;
  price_gram_10k: number;
}

export interface ExchangeRateResponse {
  success: boolean;
  base: string;
  date: string;
  rates: {
    XOF: number;
  };
}

import { ConfigService } from './config.service';

export class GoldAPIService {
  private goldApiKeyFromEnv: string;
  private exchangeApiKeyFromEnv: string;
  private db: D1Database | null;
  private configService: ConfigService | null;
  private _cachedGoldApiKey: string | null = null;
  private _cachedExchangeApiKey: string | null = null;

  constructor(
    private kv: KVNamespace,
    goldApiKey?: string,
    exchangeApiKey?: string,
    db?: D1Database,
    configService?: ConfigService
  ) {
    this.goldApiKeyFromEnv = goldApiKey || '';
    this.exchangeApiKeyFromEnv = exchangeApiKey || '';
    this.db = db || null;
    this.configService = configService || (db ? new ConfigService(db, kv) : null);
  }

  /**
   * Get Gold API key from config (preferred) or env fallback
   */
  private async getGoldApiKey(): Promise<string> {
    if (this._cachedGoldApiKey) return this._cachedGoldApiKey;

    if (this.configService) {
      const key = await this.configService.getGoldApiKey(this.goldApiKeyFromEnv);
      this._cachedGoldApiKey = key || '';
      return this._cachedGoldApiKey;
    }
    return this.goldApiKeyFromEnv;
  }

  /**
   * Get Exchange Rate API key from config (preferred) or env fallback
   */
  private async getExchangeApiKey(): Promise<string> {
    if (this._cachedExchangeApiKey) return this._cachedExchangeApiKey;

    if (this.configService) {
      const key = await this.configService.getExchangeRateApiKey(this.exchangeApiKeyFromEnv);
      this._cachedExchangeApiKey = key || '';
      return this._cachedExchangeApiKey;
    }
    return this.exchangeApiKeyFromEnv;
  }

  /**
   * Check if a provider is enabled in the integrations table
   */
  private async isProviderEnabled(provider: string): Promise<boolean> {
    if (!this.db) return true;
    try {
      const row = await this.db
        .prepare('SELECT enabled FROM integrations WHERE provider = ?')
        .bind(provider)
        .first<{ enabled: number }>();
      return row?.enabled === 1;
    } catch {
      return true;
    }
  }

  /**
   * Fetch current gold price from GoldAPI.io
   */
  private async fetchFromGoldAPI(): Promise<{ priceUsd: number } | null> {
    const goldApiKey = await this.getGoldApiKey();
    if (!goldApiKey) {
      console.log('GoldAPI key not configured');
      return null;
    }

    try {
      const goldApiBaseUrl = this.configService
        ? await this.configService.get('gold_api_base_url', 'https://www.goldapi.io/api')
        : 'https://www.goldapi.io/api';
      const response = await fetch(`${goldApiBaseUrl}/XAU/USD`, {
        headers: {
          'x-access-token': goldApiKey,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error('GoldAPI error:', response.status);
        return null;
      }

      const data: GoldAPIResponse = await response.json();

      // GoldAPI returns price per troy ounce, convert to grams
      // 1 troy ounce = 31.1035 grams
      const pricePerGram = data.price / 31.1035;

      return { priceUsd: pricePerGram };
    } catch (error) {
      console.error('GoldAPI fetch error:', error);
      return null;
    }
  }

  /**
   * Fetch gold price from Metals-API (fallback)
   */
  private async fetchFromMetalsAPI(): Promise<{ priceUsd: number } | null> {
    try {
      // Free tier API - limited requests
      const metalsApiUrl = this.configService
        ? await this.configService.get('metals_api_url', 'https://api.metals.live/v1/spot/gold') ?? 'https://api.metals.live/v1/spot/gold'
        : 'https://api.metals.live/v1/spot/gold';
      const response = await fetch(metalsApiUrl);

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      // Returns array with price per troy ounce
      if (Array.isArray(data) && data.length > 0 && data[0].price) {
        const pricePerGram = data[0].price / 31.1035;
        return { priceUsd: pricePerGram };
      }

      return null;
    } catch (error) {
      console.error('Metals-API fetch error:', error);
      return null;
    }
  }

  /**
   * Get USD/XOF exchange rate
   * Uses multiple sources with fallback to calculated rate via EUR
   */
  private async getExchangeRate(): Promise<number> {
    // Try to get from cache first
    const cachedRate = await this.kv.get('exchange_rate:usd_xof');
    if (cachedRate) {
      return parseFloat(cachedRate);
    }

    // Load configurable values
    const exchangeRateApiUrl = this.configService
      ? await this.configService.get('exchange_rate_api_url', 'https://v6.exchangerate-api.com/v6')
      : 'https://v6.exchangerate-api.com/v6';
    const exchangeRateFallbackUrl = this.configService
      ? await this.configService.get('exchange_rate_fallback_url', 'https://api.exchangerate.host/latest?base=USD&symbols=XOF')
      : 'https://api.exchangerate.host/latest?base=USD&symbols=XOF';
    const exchangeRateCacheTtl = this.configService
      ? await this.configService.getNumber('exchange_rate_cache_ttl', 3600)
      : 3600;

    // Try Exchange Rate API
    const exchangeApiKey = await this.getExchangeApiKey();
    if (exchangeApiKey) {
      try {
        const response = await fetch(
          `${exchangeRateApiUrl}/${exchangeApiKey}/latest/USD`
        );

        if (response.ok) {
          const data = await response.json() as { conversion_rates?: Record<string, number> };
          if (data.conversion_rates?.XOF) {
            const rate = data.conversion_rates.XOF;
            await this.kv.put('exchange_rate:usd_xof', rate.toString(), {
              expirationTtl: exchangeRateCacheTtl,
            });
            return rate;
          }
        }
      } catch (error) {
        console.error('Exchange rate API error:', error);
      }
    }

    // Fallback: Calculate from EUR rate
    try {
      const response = await fetch(exchangeRateFallbackUrl);

      if (response.ok) {
        const data = await response.json() as { rates?: Record<string, number> };
        if (data.rates?.XOF) {
          const rate = data.rates.XOF;
          await this.kv.put('exchange_rate:usd_xof', rate.toString(), {
            expirationTtl: exchangeRateCacheTtl,
          });
          return rate;
        }
      }
    } catch (error) {
      console.error('exchangerate.host error:', error);
    }

    // Ultimate fallback: Use configurable approximate rate
    const fallbackRate = this.configService
      ? await this.configService.getNumber('fallback_exchange_rate', 615)
      : 615;
    await this.kv.put('exchange_rate:usd_xof', fallbackRate.toString(), {
      expirationTtl: exchangeRateCacheTtl,
    });
    return fallbackRate;
  }

  /**
   * Fetch current gold price with exchange rate
   */
  async fetchCurrentPrice(): Promise<GoldPriceData | null> {
    // Try primary source (GoldAPI) if enabled
    let goldData: { priceUsd: number } | null = null;
    let source = 'goldapi';

    if (await this.isProviderEnabled('goldapi')) {
      goldData = await this.fetchFromGoldAPI();
    }

    // Fallback to Metals-API (free, no integration toggle needed)
    if (!goldData) {
      goldData = await this.fetchFromMetalsAPI();
      source = 'metals-api';
    }

    // If still no data, use cached or fallback
    if (!goldData) {
      const cachedPrice = await this.kv.get('gold_price:usd_gram');
      if (cachedPrice) {
        goldData = { priceUsd: parseFloat(cachedPrice) };
        source = 'cache';
      } else {
        // Ultimate fallback - configurable approximate gold price per gram
        const fallbackPrice = this.configService
          ? await this.configService.getNumber('fallback_gold_price_usd', 75)
          : 75;
        goldData = { priceUsd: fallbackPrice };
        source = 'fallback';
      }
    }

    // Get exchange rate
    const exchangeRate = await this.getExchangeRate();

    // Calculate XOF price
    const priceXof = goldData.priceUsd * exchangeRate;

    // Cache the USD price
    const goldPriceCacheTtl = this.configService
      ? await this.configService.getNumber('gold_price_cache_ttl', 300)
      : 300;
    await this.kv.put('gold_price:usd_gram', goldData.priceUsd.toString(), {
      expirationTtl: goldPriceCacheTtl,
    });

    return {
      priceUsd: Math.round(goldData.priceUsd * 100) / 100,
      priceXof: Math.round(priceXof),
      exchangeRate: Math.round(exchangeRate * 100) / 100,
      source,
      timestamp: new Date(),
    };
  }

  /**
   * Get price with caching strategy
   * Checks cache first, fetches if expired
   */
  async getPrice(): Promise<GoldPriceData | null> {
    // Check for recent price in cache
    const cachedData = await this.kv.get('gold_price:current_full', 'json');
    if (cachedData) {
      const data = cachedData as GoldPriceData & { cachedAt: number };
      // Use cache if less than configured TTL old
      const cacheTtlMs = this.configService
        ? (await this.configService.getNumber('gold_price_cache_ttl', 300)) * 1000
        : 300 * 1000;
      if (Date.now() - data.cachedAt < cacheTtlMs) {
        return {
          ...data,
          timestamp: new Date(data.timestamp),
        };
      }
    }

    // Fetch fresh price
    const freshPrice = await this.fetchCurrentPrice();

    if (freshPrice) {
      // Cache the full data
      await this.kv.put(
        'gold_price:current_full',
        JSON.stringify({
          ...freshPrice,
          timestamp: freshPrice.timestamp.toISOString(),
          cachedAt: Date.now(),
        }),
        { expirationTtl: this.configService
          ? await this.configService.getNumber('gold_price_full_cache_ttl', 600)
          : 600 }
      );
    }

    return freshPrice;
  }

  /**
   * Force refresh price (bypass cache)
   */
  async forceRefresh(): Promise<GoldPriceData | null> {
    await this.kv.delete('gold_price:current_full');
    return this.fetchCurrentPrice();
  }

  /**
   * Check API health status
   */
  async checkHealth(): Promise<{
    goldApi: boolean;
    exchangeApi: boolean;
    cached: boolean;
  }> {
    const health = {
      goldApi: false,
      exchangeApi: false,
      cached: false,
    };

    // Check GoldAPI
    const goldApiKey = await this.getGoldApiKey();
    if (goldApiKey) {
      const goldData = await this.fetchFromGoldAPI();
      health.goldApi = goldData !== null;
    }

    // Check exchange rate
    const cachedRate = await this.kv.get('exchange_rate:usd_xof');
    health.exchangeApi = cachedRate !== null;

    // Check cache
    const cachedPrice = await this.kv.get('gold_price:current_full');
    health.cached = cachedPrice !== null;

    return health;
  }
}
