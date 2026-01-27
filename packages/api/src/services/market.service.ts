/**
 * Market Service - Gold prices, quotes, and stock management
 */

export interface GoldPriceRow {
  id: string;
  price_usd: number;
  price_xof: number;
  exchange_rate: number;
  buy_price: number;
  sell_price: number;
  source: string;
  timestamp: string;
}

export interface QuoteRow {
  id: string;
  user_id: string;
  type: 'BUY' | 'SELL';
  token_amount: number;
  cash_amount: number;
  price_per_gram: number;
  fees: number;
  total: number;
  expires_at: string;
  status: 'PENDING' | 'USED' | 'EXPIRED';
  created_at: string;
}

export interface GoldStockRow {
  id: string;
  total_allocated: number;
  tokens_issued: number;
  low_stock_threshold: number;
  last_audit_date: string | null;
  last_audit_result: string | null;
  audited_by: string | null;
  updated_at: string;
}

// Business constants
const SPREAD_BUY = 0.02; // 2%
const SPREAD_SELL = 0.02; // 2%
const TRANSACTION_FEE_PERCENT = 0.005; // 0.5%
const QUOTE_EXPIRY_MINUTES = 5;

export class MarketService {
  constructor(
    private db: D1Database,
    private kv: KVNamespace
  ) {}

  /**
   * Get current gold price from cache or database
   */
  async getCurrentPrice(): Promise<GoldPriceRow | null> {
    // Try cache first
    const cached = await this.kv.get('gold_price:current', 'json');
    if (cached) {
      return cached as GoldPriceRow;
    }

    // Fall back to database
    const result = await this.db
      .prepare('SELECT * FROM gold_prices ORDER BY timestamp DESC LIMIT 1')
      .first<GoldPriceRow>();

    if (result) {
      // Cache for 1 minute
      await this.kv.put('gold_price:current', JSON.stringify(result), {
        expirationTtl: 60,
      });
    }

    return result || null;
  }

  /**
   * Get price history with downsampling and KV cache per period.
   * - 24h: raw points (~288), cached 60s
   * - 7d: hourly avg (~168), cached 5min
   * - 30d: 4-hour avg (~180), cached 15min
   * - 1y: daily avg (~365), cached 1h
   */
  async getPriceHistory(
    period: '24h' | '7d' | '30d' | '1y' = '24h'
  ): Promise<GoldPriceRow[]> {
    // Try KV cache first
    const cacheKey = `price_history:${period}`;
    const cacheTtl: Record<string, number> = { '24h': 60, '7d': 300, '30d': 900, '1y': 3600 };

    const cached = await this.kv.get(cacheKey, 'json');
    if (cached) return cached as GoldPriceRow[];

    const intervals: Record<string, string> = {
      '24h': '-1 day',
      '7d': '-7 days',
      '30d': '-30 days',
      '1y': '-1 year',
    };

    // Downsampling format per period
    const groupFormats: Record<string, string | null> = {
      '24h': null, // raw
      '7d': '%Y-%m-%d %H:00:00',       // hourly
      '30d': '%Y-%m-%d %H:00:00',      // will filter to 4h buckets below
      '1y': '%Y-%m-%d',                 // daily
    };

    let results: GoldPriceRow[];
    const groupFormat = groupFormats[period];

    if (!groupFormat) {
      // Raw for 24h
      const result = await this.db
        .prepare(
          `SELECT * FROM gold_prices
           WHERE timestamp >= datetime('now', ?)
           ORDER BY timestamp ASC`
        )
        .bind(intervals[period])
        .all<GoldPriceRow>();
      results = result.results || [];
    } else if (period === '30d') {
      // 4-hour buckets: group by date + floor(hour/4)
      const result = await this.db
        .prepare(
          `SELECT
             MIN(id) as id,
             AVG(price_usd) as price_usd,
             AVG(price_xof) as price_xof,
             AVG(exchange_rate) as exchange_rate,
             AVG(buy_price) as buy_price,
             AVG(sell_price) as sell_price,
             MIN(source) as source,
             MIN(timestamp) as timestamp
           FROM gold_prices
           WHERE timestamp >= datetime('now', ?)
           GROUP BY strftime('%Y-%m-%d', timestamp), CAST(strftime('%H', timestamp) AS INTEGER) / 4
           ORDER BY timestamp ASC`
        )
        .bind(intervals[period])
        .all<GoldPriceRow>();
      results = result.results || [];
    } else {
      // Hourly (7d) or daily (1y)
      const result = await this.db
        .prepare(
          `SELECT
             MIN(id) as id,
             AVG(price_usd) as price_usd,
             AVG(price_xof) as price_xof,
             AVG(exchange_rate) as exchange_rate,
             AVG(buy_price) as buy_price,
             AVG(sell_price) as sell_price,
             MIN(source) as source,
             MIN(timestamp) as timestamp
           FROM gold_prices
           WHERE timestamp >= datetime('now', ?)
           GROUP BY strftime(?, timestamp)
           ORDER BY timestamp ASC`
        )
        .bind(intervals[period], groupFormat)
        .all<GoldPriceRow>();
      results = result.results || [];
    }

    // Cache result
    await this.kv.put(cacheKey, JSON.stringify(results), {
      expirationTtl: cacheTtl[period],
    });

    return results;
  }

  /**
   * Update gold price (called by price fetcher worker)
   */
  async updatePrice(data: {
    priceUsd: number;
    exchangeRate: number;
    source: string;
  }): Promise<GoldPriceRow> {
    const priceXof = data.priceUsd * data.exchangeRate;
    const buyPrice = priceXof * (1 + SPREAD_BUY);
    const sellPrice = priceXof * (1 - SPREAD_SELL);
    const id = crypto.randomUUID();

    await this.db
      .prepare(
        `INSERT INTO gold_prices (id, price_usd, price_xof, exchange_rate, buy_price, sell_price, source)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, data.priceUsd, priceXof, data.exchangeRate, buyPrice, sellPrice, data.source)
      .run();

    const price: GoldPriceRow = {
      id,
      price_usd: data.priceUsd,
      price_xof: priceXof,
      exchange_rate: data.exchangeRate,
      buy_price: buyPrice,
      sell_price: sellPrice,
      source: data.source,
      timestamp: new Date().toISOString(),
    };

    // Update cache
    await this.kv.put('gold_price:current', JSON.stringify(price), {
      expirationTtl: 60,
    });

    return price;
  }

  /**
   * Generate a quote for buy/sell
   */
  async generateQuote(
    userId: string,
    type: 'BUY' | 'SELL',
    tokenAmount: number
  ): Promise<QuoteRow> {
    const currentPrice = await this.getCurrentPrice();
    if (!currentPrice) {
      throw new Error('Price not available');
    }

    const pricePerGram = type === 'BUY' ? currentPrice.buy_price : currentPrice.sell_price;
    const cashAmount = tokenAmount * pricePerGram;
    const fees = cashAmount * TRANSACTION_FEE_PERCENT;
    const total = type === 'BUY' ? cashAmount + fees : cashAmount - fees;

    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + QUOTE_EXPIRY_MINUTES * 60 * 1000).toISOString();

    await this.db
      .prepare(
        `INSERT INTO quotes (id, user_id, type, token_amount, cash_amount, price_per_gram, fees, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, userId, type, tokenAmount, cashAmount, pricePerGram, fees, expiresAt)
      .run();

    return {
      id,
      user_id: userId,
      type,
      token_amount: tokenAmount,
      cash_amount: cashAmount,
      price_per_gram: pricePerGram,
      fees,
      total,
      expires_at: expiresAt,
      status: 'PENDING',
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Get quote by ID
   */
  async getQuote(quoteId: string): Promise<QuoteRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM quotes WHERE id = ?')
      .bind(quoteId)
      .first<Omit<QuoteRow, 'total'>>();
    if (!result) return null;
    // Compute total (not stored in DB)
    const total = result.type === 'BUY'
      ? result.cash_amount + result.fees
      : result.cash_amount - result.fees;
    return { ...result, total };
  }

  /**
   * Validate and mark quote as used (atomic - prevents double-use race condition)
   */
  async useQuote(quoteId: string, userId: string): Promise<QuoteRow | null> {
    // Atomic: only one concurrent request can successfully mark the quote as used
    const result = await this.db
      .prepare(
        `UPDATE quotes SET status = 'USED'
         WHERE id = ? AND user_id = ? AND status = 'PENDING' AND expires_at > datetime('now')`
      )
      .bind(quoteId, userId)
      .run();

    // If no rows changed, the quote was already used, expired, or doesn't belong to user
    if (result.meta.changes === 0) return null;

    return this.getQuote(quoteId);
  }

  /**
   * Get gold stock status
   */
  async getGoldStock(): Promise<GoldStockRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM gold_stock WHERE id = ?')
      .bind('primary')
      .first<GoldStockRow>();
    return result || null;
  }

  /**
   * Check if purchase is possible (non-atomic, use for quote generation only)
   */
  async canPurchase(tokenAmount: number): Promise<boolean> {
    const stock = await this.getGoldStock();
    if (!stock) return false;
    const availableStock = stock.total_allocated - stock.tokens_issued;
    return availableStock >= tokenAmount;
  }

  /**
   * Atomically reserve stock for a purchase.
   * Returns true if stock was successfully reserved, false if insufficient.
   * Prevents race condition: only one concurrent request can claim the same stock.
   */
  async atomicPurchaseStock(tokenAmount: number): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE gold_stock
         SET tokens_issued = tokens_issued + ?,
             updated_at = datetime('now')
         WHERE id = 'primary'
           AND (total_allocated - tokens_issued) >= ?`
      )
      .bind(tokenAmount, tokenAmount)
      .run();

    return result.meta.changes > 0;
  }

  /**
   * Atomically release stock after a sale or rollback.
   * Returns true if stock was successfully released.
   */
  async atomicSellStock(tokenAmount: number): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE gold_stock
         SET tokens_issued = tokens_issued - ?,
             updated_at = datetime('now')
         WHERE id = 'primary'
           AND tokens_issued >= ?`
      )
      .bind(tokenAmount, tokenAmount)
      .run();

    return result.meta.changes > 0;
  }

  /**
   * Get 24h price change
   */
  async get24hChange(): Promise<number> {
    const current = await this.getCurrentPrice();
    if (!current) return 0;

    const yesterday = await this.db
      .prepare(
        `SELECT price_xof FROM gold_prices
         WHERE timestamp <= datetime('now', '-1 day')
         ORDER BY timestamp DESC LIMIT 1`
      )
      .first<{ price_xof: number }>();

    if (!yesterday) return 0;

    return ((current.price_xof - yesterday.price_xof) / yesterday.price_xof) * 100;
  }

  /**
   * Format price response for API
   */
  async getFormattedPrice(): Promise<{
    lbmaUsd: number;
    priceXof: number;
    buyPrice: number;
    sellPrice: number;
    spreadBuy: number;
    spreadSell: number;
    exchangeRate: number;
    change24h: number;
    updatedAt: string;
  } | null> {
    const price = await this.getCurrentPrice();
    if (!price) return null;

    const change24h = await this.get24hChange();

    return {
      lbmaUsd: price.price_usd,
      priceXof: price.price_xof,
      buyPrice: price.buy_price,
      sellPrice: price.sell_price,
      spreadBuy: SPREAD_BUY,
      spreadSell: SPREAD_SELL,
      exchangeRate: price.exchange_rate,
      change24h,
      updatedAt: price.timestamp,
    };
  }
}
