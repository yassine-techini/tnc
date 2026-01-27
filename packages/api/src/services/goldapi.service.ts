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

// BCEAO fixed rate (CFA Franc is pegged to Euro)
// 1 EUR = 655.957 XOF (fixed rate)
const BCEAO_EUR_XOF_RATE = 655.957;

export class GoldAPIService {
  private goldApiKey: string;
  private exchangeApiKey: string;

  constructor(
    private kv: KVNamespace,
    goldApiKey?: string,
    exchangeApiKey?: string
  ) {
    this.goldApiKey = goldApiKey || '';
    this.exchangeApiKey = exchangeApiKey || '';
  }

  /**
   * Fetch current gold price from GoldAPI.io
   */
  private async fetchFromGoldAPI(): Promise<{ priceUsd: number } | null> {
    if (!this.goldApiKey) {
      console.log('GoldAPI key not configured');
      return null;
    }

    try {
      const response = await fetch('https://www.goldapi.io/api/XAU/USD', {
        headers: {
          'x-access-token': this.goldApiKey,
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
      const response = await fetch(
        'https://api.metals.live/v1/spot/gold'
      );

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

    // Try Exchange Rate API
    if (this.exchangeApiKey) {
      try {
        const response = await fetch(
          `https://v6.exchangerate-api.com/v6/${this.exchangeApiKey}/latest/USD`
        );

        if (response.ok) {
          const data = await response.json();
          if (data.conversion_rates?.XOF) {
            const rate = data.conversion_rates.XOF;
            // Cache for 1 hour
            await this.kv.put('exchange_rate:usd_xof', rate.toString(), {
              expirationTtl: 3600,
            });
            return rate;
          }
        }
      } catch (error) {
        console.error('Exchange rate API error:', error);
      }
    }

    // Fallback: Calculate from EUR rate
    // USD/EUR is approximately 0.92, so USD/XOF = 0.92 * 655.957 ≈ 603
    // Using a more stable approximation
    try {
      const response = await fetch(
        'https://api.exchangerate.host/latest?base=USD&symbols=XOF'
      );

      if (response.ok) {
        const data = await response.json();
        if (data.rates?.XOF) {
          const rate = data.rates.XOF;
          await this.kv.put('exchange_rate:usd_xof', rate.toString(), {
            expirationTtl: 3600,
          });
          return rate;
        }
      }
    } catch (error) {
      console.error('exchangerate.host error:', error);
    }

    // Ultimate fallback: Use approximate rate (updated periodically)
    // As of 2024, USD/XOF is approximately 600-620
    const fallbackRate = 615;
    await this.kv.put('exchange_rate:usd_xof', fallbackRate.toString(), {
      expirationTtl: 3600,
    });
    return fallbackRate;
  }

  /**
   * Fetch current gold price with exchange rate
   */
  async fetchCurrentPrice(): Promise<GoldPriceData | null> {
    // Try primary source (GoldAPI)
    let goldData = await this.fetchFromGoldAPI();
    let source = 'goldapi';

    // Fallback to Metals-API
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
        // Ultimate fallback - approximate gold price per gram
        // As of 2024, gold is approximately $65-85 per gram
        goldData = { priceUsd: 75 };
        source = 'fallback';
      }
    }

    // Get exchange rate
    const exchangeRate = await this.getExchangeRate();

    // Calculate XOF price
    const priceXof = goldData.priceUsd * exchangeRate;

    // Cache the USD price
    await this.kv.put('gold_price:usd_gram', goldData.priceUsd.toString(), {
      expirationTtl: 300, // 5 minutes
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
      // Use cache if less than 5 minutes old
      if (Date.now() - data.cachedAt < 5 * 60 * 1000) {
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
        { expirationTtl: 600 } // 10 minutes max
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
    if (this.goldApiKey) {
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
