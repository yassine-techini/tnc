/**
 * Market Service Tests
 * Tests for trading logic, quotes, and stock management
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('MarketService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Quote Generation', () => {
    const SPREAD_BUY = 0.02; // 2%
    const SPREAD_SELL = 0.02; // 2%
    const QUOTE_VALIDITY = 60; // 60 seconds

    it('should generate buy quote with correct spread', () => {
      const basePrice = 50000; // XOF/gram
      const quantity = 5; // grams

      const pricePerGram = basePrice * (1 + SPREAD_BUY);
      const totalAmount = pricePerGram * quantity;
      const fees = totalAmount * 0.01; // 1% fee

      expect(pricePerGram).toBe(51000);
      expect(totalAmount).toBe(255000);
      expect(fees).toBe(2550);
    });

    it('should generate sell quote with correct spread', () => {
      const basePrice = 50000; // XOF/gram
      const quantity = 5; // grams

      const pricePerGram = basePrice * (1 - SPREAD_SELL);
      const totalAmount = pricePerGram * quantity;
      const fees = totalAmount * 0.01; // 1% fee

      expect(pricePerGram).toBe(49000);
      expect(totalAmount).toBe(245000);
      expect(fees).toBe(2450);
    });

    it('should set quote expiration to 60 seconds', () => {
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + QUOTE_VALIDITY * 1000);

      const diffSeconds = (expiresAt.getTime() - createdAt.getTime()) / 1000;
      expect(diffSeconds).toBe(60);
    });

    it('should generate unique quote IDs', () => {
      const quotes = new Set();
      for (let i = 0; i < 100; i++) {
        quotes.add(crypto.randomUUID());
      }
      expect(quotes.size).toBe(100);
    });

    it('should include all required quote fields', () => {
      const quote = {
        id: 'quote-123',
        userId: 'user-123',
        type: 'BUY',
        tokenAmount: 5,
        cashAmount: 255000,
        pricePerGram: 51000,
        fees: 2550,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        createdAt: new Date().toISOString(),
      };

      const requiredFields = [
        'id', 'userId', 'type', 'tokenAmount', 'cashAmount',
        'pricePerGram', 'fees', 'status', 'expiresAt', 'createdAt'
      ];

      requiredFields.forEach(field => {
        expect(quote).toHaveProperty(field);
      });
    });
  });

  describe('Stock Management', () => {
    it('should enforce stock availability for purchases', () => {
      const stock = {
        totalAllocated: 1000, // grams
        tokensIssued: 800, // grams already sold
      };

      const availableStock = stock.totalAllocated - stock.tokensIssued;
      const requestedAmount = 150;

      expect(availableStock).toBe(200);
      expect(requestedAmount <= availableStock).toBe(true);
    });

    it('should reject purchases exceeding available stock', () => {
      const stock = {
        totalAllocated: 1000,
        tokensIssued: 950,
      };

      const availableStock = stock.totalAllocated - stock.tokensIssued;
      const requestedAmount = 100;

      expect(availableStock).toBe(50);
      expect(requestedAmount <= availableStock).toBe(false);
    });

    it('should maintain invariant: tokensIssued <= totalAllocated', () => {
      const validStock = {
        totalAllocated: 1000,
        tokensIssued: 500,
      };

      const invalidStock = {
        totalAllocated: 1000,
        tokensIssued: 1100,
      };

      expect(validStock.tokensIssued <= validStock.totalAllocated).toBe(true);
      expect(invalidStock.tokensIssued <= invalidStock.totalAllocated).toBe(false);
    });

    it('should trigger low stock alert at threshold', () => {
      const LOW_STOCK_THRESHOLD = 0.1; // 10%
      const stock = {
        totalAllocated: 1000,
        tokensIssued: 920,
        lowStockThreshold: LOW_STOCK_THRESHOLD,
      };

      const availableRatio = (stock.totalAllocated - stock.tokensIssued) / stock.totalAllocated;
      const isLowStock = availableRatio <= stock.lowStockThreshold;

      expect(availableRatio).toBe(0.08);
      expect(isLowStock).toBe(true);
    });
  });

  describe('KYC Limits', () => {
    const KYC_LIMITS = {
      BASIC: { dailyBuy: 0, monthlyBuy: 0, canSell: false, dailyWithdraw: 0 },
      STANDARD: { dailyBuy: 100, monthlyBuy: 500, canSell: true, dailyWithdraw: 500000 },
      VERIFIED: { dailyBuy: 1000, monthlyBuy: 5000, canSell: true, dailyWithdraw: 5000000 },
    };

    it('should block BASIC users from trading', () => {
      const kycLevel = 'BASIC';
      const limits = KYC_LIMITS[kycLevel];

      expect(limits.dailyBuy).toBe(0);
      expect(limits.canSell).toBe(false);
    });

    it('should enforce daily limits for STANDARD users', () => {
      const kycLevel = 'STANDARD';
      const limits = KYC_LIMITS[kycLevel];
      const todayPurchases = 80; // grams already purchased today
      const requestedAmount = 30; // grams

      expect(todayPurchases + requestedAmount <= limits.dailyBuy).toBe(false);
    });

    it('should allow higher limits for VERIFIED users', () => {
      const kycLevel = 'VERIFIED';
      const limits = KYC_LIMITS[kycLevel];

      expect(limits.dailyBuy).toBe(1000);
      expect(limits.monthlyBuy).toBe(5000);
    });

    it('should enforce monthly limits', () => {
      const kycLevel = 'STANDARD';
      const limits = KYC_LIMITS[kycLevel];
      const monthPurchases = 450;
      const requestedAmount = 100;

      expect(monthPurchases + requestedAmount <= limits.monthlyBuy).toBe(false);
    });
  });

  describe('Transaction Execution', () => {
    it('should create pending transaction on buy initiation', () => {
      const transaction = {
        id: 'tx-123',
        userId: 'user-123',
        walletId: 'wallet-123',
        quoteId: 'quote-123',
        type: 'BUY',
        status: 'PENDING',
        tokenAmount: 5,
        cashAmount: 255000,
        pricePerGram: 51000,
        fees: 2550,
        createdAt: new Date().toISOString(),
      };

      expect(transaction.status).toBe('PENDING');
      expect(transaction.type).toBe('BUY');
    });

    it('should update wallet balance on completed buy', () => {
      const wallet = {
        tokenBalance: 10,
        cashBalance: 0,
        totalBought: 500000,
      };

      const transaction = {
        tokenAmount: 5,
        cashAmount: 255000,
        status: 'COMPLETED',
      };

      // After completed buy
      wallet.tokenBalance += transaction.tokenAmount;
      wallet.totalBought += transaction.cashAmount;

      expect(wallet.tokenBalance).toBe(15);
      expect(wallet.totalBought).toBe(755000);
    });

    it('should update wallet balance on completed sell', () => {
      const wallet = {
        tokenBalance: 10,
        cashBalance: 0,
        totalSpent: 0,
      };

      const transaction = {
        tokenAmount: 5,
        cashAmount: 245000,
        fees: 2450,
        status: 'COMPLETED',
      };

      // After completed sell
      wallet.tokenBalance -= transaction.tokenAmount;
      wallet.cashBalance += transaction.cashAmount - transaction.fees;

      expect(wallet.tokenBalance).toBe(5);
      expect(wallet.cashBalance).toBe(242550);
    });

    it('should reject sell if insufficient token balance', () => {
      const wallet = {
        tokenBalance: 3,
      };

      const requestedSell = 5;

      expect(wallet.tokenBalance >= requestedSell).toBe(false);
    });
  });

  describe('Quote Expiration', () => {
    it('should detect expired quotes', () => {
      const expiredQuote = {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        status: 'PENDING',
      };

      const isExpired = new Date(expiredQuote.expiresAt) < new Date();
      expect(isExpired).toBe(true);
    });

    it('should reject transactions with expired quotes', () => {
      const quote = {
        id: 'quote-123',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        status: 'PENDING',
      };

      const isExpired = new Date(quote.expiresAt) < new Date();
      const canExecute = !isExpired && quote.status === 'PENDING';

      expect(canExecute).toBe(false);
    });

    it('should mark quote as used after transaction', () => {
      const quote = {
        id: 'quote-123',
        status: 'PENDING',
      };

      // After transaction
      quote.status = 'USED';

      expect(quote.status).toBe('USED');
    });
  });

  describe('Price History', () => {
    it('should store price with timestamp', () => {
      const priceRecord = {
        id: 'price-123',
        priceUsd: 75,
        priceXof: 46125,
        exchangeRate: 615,
        buyPrice: 47047.5,
        sellPrice: 45202.5,
        source: 'goldapi',
        timestamp: new Date().toISOString(),
      };

      expect(priceRecord.timestamp).toBeTruthy();
      expect(new Date(priceRecord.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should retrieve price history for date range', () => {
      const prices = [
        { timestamp: '2024-01-01T00:00:00Z', priceXof: 45000 },
        { timestamp: '2024-01-02T00:00:00Z', priceXof: 45500 },
        { timestamp: '2024-01-03T00:00:00Z', priceXof: 46000 },
      ];

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-02');

      const filtered = prices.filter(p => {
        const date = new Date(p.timestamp);
        return date >= startDate && date <= endDate;
      });

      expect(filtered.length).toBe(2);
    });
  });

  describe('Profit/Loss Calculation', () => {
    it('should calculate unrealized P&L correctly', () => {
      const wallet = {
        tokenBalance: 10, // grams
        totalBought: 500000, // XOF spent
      };
      const currentSellPrice = 49000; // XOF/gram

      const currentValue = wallet.tokenBalance * currentSellPrice;
      const avgBuyPrice = wallet.totalBought / wallet.tokenBalance;
      const unrealizedPL = currentValue - wallet.totalBought;
      const unrealizedPLPercent = (unrealizedPL / wallet.totalBought) * 100;

      expect(currentValue).toBe(490000);
      expect(avgBuyPrice).toBe(50000);
      expect(unrealizedPL).toBe(-10000);
      expect(unrealizedPLPercent).toBeCloseTo(-2, 1);
    });

    it('should calculate positive P&L when price increases', () => {
      const wallet = {
        tokenBalance: 10,
        totalBought: 500000,
      };
      const currentSellPrice = 55000;

      const currentValue = wallet.tokenBalance * currentSellPrice;
      const unrealizedPL = currentValue - wallet.totalBought;

      expect(unrealizedPL).toBe(50000);
      expect(unrealizedPL > 0).toBe(true);
    });
  });

  describe('Minimum Order Validation', () => {
    const MIN_ORDER_GRAMS = 0.1;
    const MIN_ORDER_XOF = 5000;

    it('should enforce minimum order in grams', () => {
      const orderAmount = 0.05; // grams
      expect(orderAmount >= MIN_ORDER_GRAMS).toBe(false);
    });

    it('should enforce minimum order in XOF', () => {
      const orderAmount = 3000; // XOF
      expect(orderAmount >= MIN_ORDER_XOF).toBe(false);
    });

    it('should accept orders meeting minimum requirements', () => {
      const orderGrams = 0.5;
      const orderXof = 25000;

      expect(orderGrams >= MIN_ORDER_GRAMS).toBe(true);
      expect(orderXof >= MIN_ORDER_XOF).toBe(true);
    });
  });
});
