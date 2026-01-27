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
  used: number;
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
   * Get price history
   */
  async getPriceHistory(
    period: '24h' | '7d' | '30d' | '1y' = '24h'
  ): Promise<GoldPriceRow[]> {
    const intervals: Record<string, string> = {
      '24h': '-1 day',
      '7d': '-7 days',
      '30d': '-30 days',
      '1y': '-1 year',
    };

    const result = await this.db
      .prepare(
        `SELECT * FROM gold_prices
         WHERE timestamp >= datetime('now', ?)
         ORDER BY timestamp ASC`
      )
      .bind(intervals[period])
      .all<GoldPriceRow>();

    return result.results || [];
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
      used: 0,
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
      .first<QuoteRow>();
    return result || null;
  }

  /**
   * Validate and mark quote as used
   */
  async useQuote(quoteId: string, userId: string): Promise<QuoteRow | null> {
    const quote = await this.getQuote(quoteId);

    if (!quote) return null;
    if (quote.user_id !== userId) return null;
    if (quote.used === 1) return null;
    if (new Date(quote.expires_at) < new Date()) return null;

    await this.db
      .prepare('UPDATE quotes SET used = 1 WHERE id = ?')
      .bind(quoteId)
      .run();

    return { ...quote, used: 1 };
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
   * Check if purchase is possible
   */
  async canPurchase(tokenAmount: number): Promise<boolean> {
    const stock = await this.getGoldStock();
    if (!stock) return false;
    const availableStock = stock.total_allocated - stock.tokens_issued;
    return availableStock >= tokenAmount;
  }

  /**
   * Update stock after purchase (increase tokens_issued)
   */
  async decreaseAvailableStock(tokenAmount: number): Promise<void> {
    await this.db
      .prepare(
        `UPDATE gold_stock
         SET tokens_issued = tokens_issued + ?,
             updated_at = datetime('now')
         WHERE id = 'primary'`
      )
      .bind(tokenAmount)
      .run();
  }

  /**
   * Update stock after sale (decrease tokens_issued)
   */
  async increaseAvailableStock(tokenAmount: number): Promise<void> {
    await this.db
      .prepare(
        `UPDATE gold_stock
         SET tokens_issued = tokens_issued - ?,
             updated_at = datetime('now')
         WHERE id = 'primary'`
      )
      .bind(tokenAmount)
      .run();
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
