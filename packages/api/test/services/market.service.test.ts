/**
 * Market Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MarketService } from '../../src/services/market.service';
import { createMockD1Database, createMockKVNamespace, testData } from '../setup';

describe('MarketService', () => {
  let marketService: MarketService;
  let mockDb: D1Database;
  let mockKv: KVNamespace;

  beforeEach(() => {
    mockDb = createMockD1Database();
    mockKv = createMockKVNamespace();
    marketService = new MarketService(mockDb, mockKv, 'development');
  });

  // ─── Get Current Price ───────────────────────────────────
  describe('getCurrentPrice', () => {
    it('returns cached price when available', async () => {
      const cachedPrice = testData.goldPrice();
      mockKv = createMockKVNamespace({
        'development:gold_price:current': cachedPrice,
      });
      marketService = new MarketService(mockDb, mockKv, 'development');

      const result = await marketService.getCurrentPrice();

      expect(result).toEqual(cachedPrice);
      expect(mockDb.prepare).not.toHaveBeenCalled();
    });

    it('falls back to database when cache empty', async () => {
      const dbPrice = testData.goldPrice();
      mockDb = createMockD1Database({ first: dbPrice });
      marketService = new MarketService(mockDb, mockKv, 'development');

      const result = await marketService.getCurrentPrice();

      expect(result).toEqual(dbPrice);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM gold_prices')
      );
    });

    it('caches database result', async () => {
      const dbPrice = testData.goldPrice();
      mockDb = createMockD1Database({ first: dbPrice });
      marketService = new MarketService(mockDb, mockKv, 'development');

      await marketService.getCurrentPrice();

      expect(mockKv.put).toHaveBeenCalledWith(
        'development:gold_price:current',
        JSON.stringify(dbPrice),
        expect.any(Object)
      );
    });

    it('returns null when no price available', async () => {
      const result = await marketService.getCurrentPrice();
      expect(result).toBeNull();
    });
  });

  // ─── Price History ───────────────────────────────────────
  describe('getPriceHistory', () => {
    it('returns cached history when available', async () => {
      const history = [testData.goldPrice(), testData.goldPrice()];
      mockKv = createMockKVNamespace({
        'development:price_history:24h': history,
      });
      marketService = new MarketService(mockDb, mockKv, 'development');

      const result = await marketService.getPriceHistory('24h');

      expect(result).toEqual(history);
    });

    it('queries database for 24h history', async () => {
      const history = [testData.goldPrice()];
      mockDb = createMockD1Database({ all: history });
      marketService = new MarketService(mockDb, mockKv, 'development');

      const result = await marketService.getPriceHistory('24h');

      expect(result).toEqual(history);
      // Check that at least one call contains the date filter
      const calls = (mockDb.prepare as ReturnType<typeof vi.fn>).mock.calls;
      const hasDateFilter = calls.some(([sql]: [string]) =>
        sql.includes('gold_prices') && sql.includes('timestamp')
      );
      expect(hasDateFilter).toBe(true);
    });

    it('queries with aggregation for 7d history', async () => {
      const history = [testData.goldPrice()];
      mockDb = createMockD1Database({ all: history });
      marketService = new MarketService(mockDb, mockKv, 'development');

      await marketService.getPriceHistory('7d');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('AVG(price_usd)')
      );
    });

    it('queries with 4-hour buckets for 30d history', async () => {
      const history = [testData.goldPrice()];
      mockDb = createMockD1Database({ all: history });
      marketService = new MarketService(mockDb, mockKv, 'development');

      await marketService.getPriceHistory('30d');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('/ 4')
      );
    });

    it('queries with daily aggregation for 1y history', async () => {
      const history = [testData.goldPrice()];
      mockDb = createMockD1Database({ all: history });
      marketService = new MarketService(mockDb, mockKv, 'development');

      await marketService.getPriceHistory('1y');

      // Check that a query with AVG aggregation was made for gold_prices
      const calls = (mockDb.prepare as ReturnType<typeof vi.fn>).mock.calls;
      const hasAggregation = calls.some(([sql]: [string]) =>
        sql.includes('AVG') && sql.includes('gold_prices')
      );
      expect(hasAggregation).toBe(true);
    });
  });

  // ─── Update Price ────────────────────────────────────────
  describe('updatePrice', () => {
    it('calculates buy/sell prices with spreads', async () => {
      const result = await marketService.updatePrice({
        priceUsd: 85.5,
        exchangeRate: 615,
        source: 'goldapi',
      });

      // priceXof = 85.5 * 615 = 52582.5
      // buyPrice = 52582.5 * 1.02 = 53634.15
      // sellPrice = 52582.5 * 0.98 = 51530.85
      expect(result.price_usd).toBe(85.5);
      expect(result.exchange_rate).toBe(615);
      expect(result.price_xof).toBeCloseTo(52582.5, 2);
      expect(result.buy_price).toBeCloseTo(53634.15, 2);
      expect(result.sell_price).toBeCloseTo(51530.85, 2);
    });

    it('inserts price into database', async () => {
      await marketService.updatePrice({
        priceUsd: 85.5,
        exchangeRate: 615,
        source: 'goldapi',
      });

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO gold_prices')
      );
    });

    it('updates cache with new price', async () => {
      await marketService.updatePrice({
        priceUsd: 85.5,
        exchangeRate: 615,
        source: 'goldapi',
      });

      expect(mockKv.put).toHaveBeenCalledWith(
        'development:gold_price:current',
        expect.any(String),
        expect.any(Object)
      );
    });
  });

  // ─── Generate Quote ──────────────────────────────────────
  describe('generateQuote', () => {
    beforeEach(() => {
      const price = testData.goldPrice();
      mockKv = createMockKVNamespace({
        'development:gold_price:current': price,
      });
      marketService = new MarketService(mockDb, mockKv, 'development');
    });

    it('generates buy quote with fees', async () => {
      const result = await marketService.generateQuote('user-123', 'BUY', 1);

      expect(result.type).toBe('BUY');
      expect(result.token_amount).toBe(1);
      expect(result.price_per_gram).toBeGreaterThan(0);
      expect(result.fees).toBeGreaterThan(0);
      expect(result.total).toBe(result.cash_amount + result.fees);
    });

    it('generates sell quote with fees deducted', async () => {
      const result = await marketService.generateQuote('user-123', 'SELL', 1);

      expect(result.type).toBe('SELL');
      expect(result.total).toBe(result.cash_amount - result.fees);
    });

    it('sets expiration time', async () => {
      const before = Date.now();
      const result = await marketService.generateQuote('user-123', 'BUY', 1);
      const after = Date.now();

      const expiresAt = new Date(result.expires_at).getTime();
      // Should expire in ~5 minutes
      expect(expiresAt).toBeGreaterThan(before + 4 * 60 * 1000);
      expect(expiresAt).toBeLessThan(after + 6 * 60 * 1000);
    });

    it('throws error when price not available', async () => {
      mockKv = createMockKVNamespace();
      mockDb = createMockD1Database({ first: null });
      marketService = new MarketService(mockDb, mockKv, 'development');

      await expect(
        marketService.generateQuote('user-123', 'BUY', 1)
      ).rejects.toThrow('Price not available');
    });

    it('inserts quote into database', async () => {
      await marketService.generateQuote('user-123', 'BUY', 1);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO quotes')
      );
    });
  });

  // ─── Get Quote ───────────────────────────────────────────
  describe('getQuote', () => {
    it('returns quote with computed total', async () => {
      const quote = testData.quote('user-123');
      // Remove total since it's computed
      const { total: _total, ...dbQuote } = quote;
      mockDb = createMockD1Database({ first: dbQuote });
      marketService = new MarketService(mockDb, mockKv, 'development');

      const result = await marketService.getQuote(quote.id);

      expect(result?.total).toBeDefined();
      expect(result?.type).toBe('BUY');
    });

    it('returns null for nonexistent quote', async () => {
      const result = await marketService.getQuote('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ─── Use Quote ───────────────────────────────────────────
  describe('useQuote', () => {
    it('marks quote as used atomically', async () => {
      const quote = testData.quote('user-123');
      const { total: _total, ...dbQuote } = quote;

      // First call to UPDATE, second to SELECT
      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
        first: vi.fn().mockResolvedValue(dbQuote),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      marketService = new MarketService(mockDb, mockKv, 'development');

      const result = await marketService.useQuote(quote.id, 'user-123');

      expect(result).toBeDefined();
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'USED'")
      );
    });

    it('returns null if quote already used', async () => {
      mockDb = createMockD1Database({ changes: 0 });
      marketService = new MarketService(mockDb, mockKv, 'development');

      const result = await marketService.useQuote('quote-123', 'user-123');

      expect(result).toBeNull();
    });

    it('returns null if quote expired', async () => {
      mockDb = createMockD1Database({ changes: 0 });
      marketService = new MarketService(mockDb, mockKv, 'development');

      const result = await marketService.useQuote('expired-quote', 'user-123');

      expect(result).toBeNull();
    });

    it('returns null if wrong user', async () => {
      mockDb = createMockD1Database({ changes: 0 });
      marketService = new MarketService(mockDb, mockKv, 'development');

      const result = await marketService.useQuote('quote-123', 'wrong-user');

      expect(result).toBeNull();
    });
  });

  // ─── Gold Stock ──────────────────────────────────────────
  describe('getGoldStock', () => {
    it('returns stock data', async () => {
      const stock = testData.goldStock();
      mockDb = createMockD1Database({ first: stock });
      marketService = new MarketService(mockDb, mockKv, 'development');

      const result = await marketService.getGoldStock();

      expect(result).toEqual(stock);
    });

    it('returns null when not found', async () => {
      const result = await marketService.getGoldStock();
      expect(result).toBeNull();
    });
  });

  describe('canPurchase', () => {
    it('returns true when stock available', async () => {
      const stock = testData.goldStock({
        total_allocated: 10000,
        tokens_issued: 5000,
      });
      mockDb = createMockD1Database({ first: stock });
      marketService = new MarketService(mockDb, mockKv, 'development');

      const result = await marketService.canPurchase(100);

      expect(result).toBe(true);
    });

    it('returns false when insufficient stock', async () => {
      const stock = testData.goldStock({
        total_allocated: 10000,
        tokens_issued: 9950,
      });
      mockDb = createMockD1Database({ first: stock });
      marketService = new MarketService(mockDb, mockKv, 'development');

      const result = await marketService.canPurchase(100);

      expect(result).toBe(false);
    });

    it('returns false when no stock record', async () => {
      const result = await marketService.canPurchase(1);
      expect(result).toBe(false);
    });
  });

  // ─── Atomic Stock Operations ─────────────────────────────
  describe('atomicPurchaseStock', () => {
    it('returns true when stock reserved', async () => {
      mockDb = createMockD1Database({ changes: 1 });
      marketService = new MarketService(mockDb, mockKv, 'development');

      const result = await marketService.atomicPurchaseStock(10);

      expect(result).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('tokens_issued = tokens_issued + ?')
      );
    });

    it('returns false when insufficient stock', async () => {
      mockDb = createMockD1Database({ changes: 0 });
      marketService = new MarketService(mockDb, mockKv, 'development');

      const result = await marketService.atomicPurchaseStock(10000);

      expect(result).toBe(false);
    });
  });

  describe('atomicSellStock', () => {
    it('returns true when stock released', async () => {
      mockDb = createMockD1Database({ changes: 1 });
      marketService = new MarketService(mockDb, mockKv, 'development');

      const result = await marketService.atomicSellStock(10);

      expect(result).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('tokens_issued = tokens_issued - ?')
      );
    });

    it('returns false when negative tokens_issued would result', async () => {
      mockDb = createMockD1Database({ changes: 0 });
      marketService = new MarketService(mockDb, mockKv, 'development');

      const result = await marketService.atomicSellStock(10000);

      expect(result).toBe(false);
    });
  });

  // ─── 24h Change ──────────────────────────────────────────
  describe('get24hChange', () => {
    it('calculates percentage change', async () => {
      const currentPrice = testData.goldPrice({ price_xof: 53000 });
      const yesterdayPrice = { price_xof: 50000 };

      mockKv = createMockKVNamespace({
        'development:gold_price:current': currentPrice,
      });
      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(yesterdayPrice),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      marketService = new MarketService(mockDb, mockKv, 'development');

      const result = await marketService.get24hChange();

      // (53000 - 50000) / 50000 * 100 = 6%
      expect(result).toBeCloseTo(6, 1);
    });

    it('returns 0 when no yesterday price', async () => {
      const currentPrice = testData.goldPrice();
      mockKv = createMockKVNamespace({
        'development:gold_price:current': currentPrice,
      });
      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      marketService = new MarketService(mockDb, mockKv, 'development');

      const result = await marketService.get24hChange();

      expect(result).toBe(0);
    });

    it('returns 0 when no current price', async () => {
      const result = await marketService.get24hChange();
      expect(result).toBe(0);
    });
  });

  // ─── Formatted Price ─────────────────────────────────────
  describe('getFormattedPrice', () => {
    it('returns formatted price response', async () => {
      const price = testData.goldPrice();
      mockKv = createMockKVNamespace({
        'development:gold_price:current': price,
      });
      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ price_xof: price.price_xof }),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      marketService = new MarketService(mockDb, mockKv, 'development');

      const result = await marketService.getFormattedPrice();

      expect(result).toMatchObject({
        lbmaUsd: price.price_usd,
        priceXof: price.price_xof,
        buyPrice: price.buy_price,
        sellPrice: price.sell_price,
        exchangeRate: price.exchange_rate,
      });
      expect(result?.spreadBuy).toBeDefined();
      expect(result?.spreadSell).toBeDefined();
      expect(result?.change24h).toBeDefined();
    });

    it('returns null when no price', async () => {
      const result = await marketService.getFormattedPrice();
      expect(result).toBeNull();
    });
  });
});
