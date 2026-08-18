/**
 * Market Service - Gold prices, quotes, and stock management
 */

import { ConfigService } from './config.service';

/**
 * Canonical primary key of the singleton gold_stock row.
 * MUST match the schema default ('main' in 0001_initial_schema.sql) and all
 * seeds (0002 prod, 0012 staging). Using a constant prevents the historical
 * 'primary'/'main'/'gold-stock-main' divergence that silently broke purchases.
 */
export const GOLD_STOCK_ID = 'main';

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
  /**
   * Or prete, donc absent du coffre. La requete est un `SELECT *` : la colonne
   * arrivait deja, seul le type l'ignorait — et c'est ce genre d'omission qui a
   * permis de confondre « emis » et « detenu en portefeuille » (ADR 012).
   */
  gold_on_loan: number;
  low_stock_threshold: number;
  last_audit_date: string | null;
  last_audit_result: string | null;
  audited_by: string | null;
  updated_at: string;
}

export class MarketService {
  private kvPrefix: string;
  private configService: ConfigService;

  constructor(
    private db: D1Database,
    private kv: KVNamespace,
    environment: string = 'development',
    configService?: ConfigService
  ) {
    this.kvPrefix = `${environment}:`;
    this.configService = configService || new ConfigService(db, kv);
  }

  /** Prefixed KV key to isolate environments sharing a namespace */
  private key(k: string): string {
    return `${this.kvPrefix}${k}`;
  }

  /**
   * Get current gold price from cache or database
   */
  async getCurrentPrice(): Promise<GoldPriceRow | null> {
    // Try cache first
    const cached = await this.kv.get(this.key('gold_price:current'), 'json');
    if (cached) {
      return cached as GoldPriceRow;
    }

    // Fall back to database
    const result = await this.db
      .prepare('SELECT * FROM gold_prices ORDER BY timestamp DESC LIMIT 1')
      .first<GoldPriceRow>();

    if (result) {
      // Cache for configurable duration
      const priceCacheTtl = await this.configService.getNumber('market_price_cache_ttl', 60);
      await this.kv.put(this.key('gold_price:current'), JSON.stringify(result), {
        expirationTtl: priceCacheTtl,
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
    const cacheKey = this.key(`price_history:${period}`);
    const [ttl24h, ttl7d, ttl30d, ttl1y] = await Promise.all([
      this.configService.getNumber('price_history_cache_ttl_24h', 60),
      this.configService.getNumber('price_history_cache_ttl_7d', 300),
      this.configService.getNumber('price_history_cache_ttl_30d', 900),
      this.configService.getNumber('price_history_cache_ttl_1y', 3600),
    ]);
    const cacheTtl: Record<string, number> = { '24h': ttl24h, '7d': ttl7d, '30d': ttl30d, '1y': ttl1y };

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
    const spreadBuy = await this.configService.getNumber('spread_buy', 0.02);
    const spreadSell = await this.configService.getNumber('spread_sell', 0.02);
    const priceXof = data.priceUsd * data.exchangeRate;
    const buyPrice = priceXof * (1 + spreadBuy);
    const sellPrice = priceXof * (1 - spreadSell);
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
    const updateCacheTtl = await this.configService.getNumber('market_price_cache_ttl', 60);
    await this.kv.put(this.key('gold_price:current'), JSON.stringify(price), {
      expirationTtl: updateCacheTtl,
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

    const txFeePercent = await this.configService.getNumber('transaction_fee_percent', 0.005);
    const quoteExpiryMinutes = await this.configService.getNumber('quote_expiry_minutes', 5);

    // Compute the per-gram price from the current spread config (not the value
    // frozen on the gold_prices row), so a spread change applies immediately and
    // stays consistent with what getFormattedPrice displays.
    const spreadBuy = await this.configService.getNumber('spread_buy', 0.02);
    const spreadSell = await this.configService.getNumber('spread_sell', 0.02);
    const pricePerGram = type === 'BUY'
      ? currentPrice.price_xof * (1 + spreadBuy)
      : currentPrice.price_xof * (1 - spreadSell);

    // Quantize money to whole XOF (zero-decimal currency) and grams to 0.001
    // (milligram) precision. Storing/charging fractional XOF accumulates
    // rounding drift across the ledger; quantizing here keeps amounts exact.
    const quantizedTokens = Math.round(tokenAmount * 1000) / 1000;

    // Un devis a quantite nulle n'a pas de sens et ne doit pas atteindre la base.
    // La route garde deja l'entree (plancher deduit du cours), mais la regle
    // appartient a la fonction qui ECRIT le devis : c'est elle que tout nouvel
    // appelant utilisera.
    if (!(quantizedTokens > 0)) {
      throw new Error('generateQuote: quantite nulle apres arrondi au milligramme');
    }

    const cashAmount = Math.round(quantizedTokens * pricePerGram);
    const fees = Math.round(cashAmount * txFeePercent);
    const total = type === 'BUY' ? cashAmount + fees : cashAmount - fees;
    tokenAmount = quantizedTokens;

    const id = crypto.randomUUID();

    /**
     * L'echeance est ecrite PAR LA BASE, pas par JavaScript (ADR 017).
     *
     * `new Date(...).toISOString()` produisait « 2026-08-18T10:08:06.589Z », que
     * la consommation comparait a `datetime('now')` — « 2026-08-18 10:08:06 ».
     * SQLite compare deux TEXT caractere par caractere : au rang 11, `T` (0x54)
     * l'emporte sur l'espace (0x20), donc la comparaison etait TOUJOURS vraie a
     * date egale. Un devis n'expirait pas au bout de cinq minutes : il expirait
     * au passage de minuit UTC.
     *
     * C'est le chemin de l'argent — le devis fige un cours, et l'expiration est
     * ce qui borne ce gel.
     *
     * `RETURNING` rend la valeur telle que la base l'a ecrite, plutot que de la
     * recalculer : le worker et la base n'ont pas la meme horloge, et une
     * echeance de cinq minutes porterait leur ecart.
     */
    const ligne = await this.db
      .prepare(
        `INSERT INTO quotes (id, user_id, type, token_amount, cash_amount, price_per_gram, fees, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' minutes'))
         RETURNING expires_at, created_at`
      )
      .bind(id, userId, type, tokenAmount, cashAmount, pricePerGram, fees, quoteExpiryMinutes)
      .first<{ expires_at: string; created_at: string }>();

    const expiresAt = ligne.expires_at;

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
      created_at: ligne.created_at,
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
   * Restore a quote to PENDING if it was consumed (USED) but the transaction did
   * not go through (e.g. a transient CONFLICT). Only restores a still-valid,
   * non-expired quote so the user can retry without requesting a new one.
   */
  async restoreQuote(quoteId: string, userId: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE quotes SET status = 'PENDING'
         WHERE id = ? AND user_id = ? AND status = 'USED' AND expires_at > datetime('now')`
      )
      .bind(quoteId, userId)
      .run();
  }

  /**
   * Get gold stock status
   */
  async getGoldStock(): Promise<GoldStockRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM gold_stock WHERE id = ?')
      .bind(GOLD_STOCK_ID)
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
         SET tokens_issued = ROUND(tokens_issued + ?, 3),
             updated_at = datetime('now')
         WHERE id = ?
           AND (total_allocated - tokens_issued) >= ?`
      )
      .bind(tokenAmount, GOLD_STOCK_ID, tokenAmount)
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
         SET tokens_issued = ROUND(tokens_issued - ?, 3),
             updated_at = datetime('now')
         WHERE id = ?
           AND tokens_issued >= ?`
      )
      .bind(tokenAmount, GOLD_STOCK_ID, tokenAmount)
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

    const spreadBuy = await this.configService.getNumber('spread_buy', 0.02);
    const spreadSell = await this.configService.getNumber('spread_sell', 0.02);

    return {
      lbmaUsd: price.price_usd,
      priceXof: price.price_xof,
      // Recompute from the current spread so buy/sell always equals
      // priceXof × (1 ± spread) — consistent with the quote path, even if the
      // spread changed since the gold_prices row was written.
      buyPrice: Math.round(price.price_xof * (1 + spreadBuy)),
      sellPrice: Math.round(price.price_xof * (1 - spreadSell)),
      spreadBuy,
      spreadSell,
      exchangeRate: price.exchange_rate,
      change24h,
      updatedAt: price.timestamp,
    };
  }
}
