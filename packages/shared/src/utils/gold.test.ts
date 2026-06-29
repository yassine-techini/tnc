/**
 * Gold Utilities Tests
 */

import { describe, it, expect } from 'vitest';
import {
  formatGrams,
  formatTokenBalance,
  roundTokenAmount,
  calculateBuyPrice,
  calculateSellPrice,
  calculatePurchaseCost,
  calculateSaleProceeds,
  xofToGrams,
  gramsToXof,
  calculateProfitLoss,
  calculateAverageBuyPrice,
  validateBuyAmount,
  validateSellAmount,
  calculateStockAvailability,
  formatGoldEquivalent,
} from './gold.js';

describe('Gold Utilities', () => {
  // ─── Format Grams ────────────────────────────────────────
  describe('formatGrams', () => {
    it('formats with unit by default', () => {
      expect(formatGrams(5.123)).toBe('5.123 g');
    });

    it('formats integer amounts with precision', () => {
      expect(formatGrams(5)).toBe('5.000 g');
    });

    it('formats without unit when specified', () => {
      expect(formatGrams(5.5, { showUnit: false })).toBe('5.500');
    });

    it('respects custom precision', () => {
      expect(formatGrams(5.123456, { precision: 2 })).toBe('5.12 g');
    });
  });

  describe('formatTokenBalance', () => {
    it('formats with 3 decimal precision and unit', () => {
      expect(formatTokenBalance(10.5)).toBe('10.500 g');
      expect(formatTokenBalance(0.001)).toBe('0.001 g');
    });
  });

  // ─── Round Token Amount ──────────────────────────────────
  describe('roundTokenAmount', () => {
    it('rounds to 3 decimal places', () => {
      expect(roundTokenAmount(5.1234)).toBe(5.123);
      expect(roundTokenAmount(5.1235)).toBe(5.124);
    });

    it('preserves valid precision', () => {
      expect(roundTokenAmount(1.001)).toBe(1.001);
      expect(roundTokenAmount(0.5)).toBe(0.5);
    });
  });

  // ─── Price Calculations ──────────────────────────────────
  describe('calculateBuyPrice', () => {
    it('applies default 2% spread', () => {
      // 50000 * 1.02 = 51000
      expect(calculateBuyPrice(50000)).toBe(51000);
    });

    it('applies custom spread', () => {
      // 50000 * 1.03 = 51500
      expect(calculateBuyPrice(50000, 0.03)).toBe(51500);
    });
  });

  describe('calculateSellPrice', () => {
    it('applies default 2% spread', () => {
      // 50000 * 0.98 = 49000
      expect(calculateSellPrice(50000)).toBe(49000);
    });

    it('applies custom spread', () => {
      // 50000 * 0.97 = 48500
      expect(calculateSellPrice(50000, 0.03)).toBe(48500);
    });
  });

  // ─── Purchase/Sale Calculations ──────────────────────────
  describe('calculatePurchaseCost', () => {
    it('calculates cost without fees', () => {
      const result = calculatePurchaseCost(5, 50000, 0);

      expect(result.subtotal).toBe(250000);
      expect(result.fees).toBe(0);
      expect(result.total).toBe(250000);
    });

    it('calculates cost with fees', () => {
      // 5g * 50000 = 250000, fees 0.5% = 1250
      const result = calculatePurchaseCost(5, 50000, 0.005);

      expect(result.subtotal).toBe(250000);
      expect(result.fees).toBe(1250);
      expect(result.total).toBe(251250);
    });
  });

  describe('calculateSaleProceeds', () => {
    it('calculates proceeds without fees', () => {
      const result = calculateSaleProceeds(5, 49000, 0);

      expect(result.subtotal).toBe(245000);
      expect(result.fees).toBe(0);
      expect(result.net).toBe(245000);
    });

    it('calculates proceeds with fees deducted', () => {
      // 5g * 49000 = 245000, fees 0.5% = 1225
      const result = calculateSaleProceeds(5, 49000, 0.005);

      expect(result.subtotal).toBe(245000);
      expect(result.fees).toBe(1225);
      expect(result.net).toBe(243775);
    });
  });

  // ─── Conversion Functions ────────────────────────────────
  describe('xofToGrams', () => {
    it('converts XOF to grams', () => {
      // 100000 / 50000 = 2
      expect(xofToGrams(100000, 50000)).toBe(2);
    });

    it('rounds to 3 decimal places', () => {
      // 100000 / 33333 ≈ 3.000
      expect(xofToGrams(100000, 33333)).toBe(3);
    });

    it('returns 0 for invalid price', () => {
      expect(xofToGrams(100000, 0)).toBe(0);
      expect(xofToGrams(100000, -50000)).toBe(0);
    });
  });

  describe('gramsToXof', () => {
    it('converts grams to XOF', () => {
      // 2 * 50000 = 100000
      expect(gramsToXof(2, 50000)).toBe(100000);
    });

    it('rounds to whole XOF', () => {
      // 2.5 * 50000 = 125000
      expect(gramsToXof(2.5, 50000)).toBe(125000);
    });
  });

  // ─── Profit/Loss Calculation ─────────────────────────────
  describe('calculateProfitLoss', () => {
    it('calculates profit', () => {
      // Invested 100000, now worth 120000
      const result = calculateProfitLoss(2, 100000, 60000);

      expect(result.currentValue).toBe(120000);
      expect(result.profitLoss).toBe(20000);
      expect(result.profitLossPercent).toBe(0.2);
      expect(result.isProfit).toBe(true);
    });

    it('calculates loss', () => {
      // Invested 100000, now worth 80000
      const result = calculateProfitLoss(2, 100000, 40000);

      expect(result.currentValue).toBe(80000);
      expect(result.profitLoss).toBe(-20000);
      expect(result.profitLossPercent).toBe(-0.2);
      expect(result.isProfit).toBe(false);
    });

    it('handles zero investment', () => {
      const result = calculateProfitLoss(2, 0, 50000);

      expect(result.profitLossPercent).toBe(0);
    });
  });

  describe('calculateAverageBuyPrice', () => {
    it('calculates average price', () => {
      // 100000 / 2 = 50000
      expect(calculateAverageBuyPrice(100000, 2)).toBe(50000);
    });

    it('returns 0 for zero grams', () => {
      expect(calculateAverageBuyPrice(100000, 0)).toBe(0);
    });
  });

  // ─── Validation ──────────────────────────────────────────
  describe('validateBuyAmount', () => {
    it('accepts valid amount', () => {
      const result = validateBuyAmount(5);

      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('rejects amount below minimum', () => {
      const result = validateBuyAmount(0.5);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('minimum');
    });

    it('rejects invalid precision', () => {
      // 1.00012 differs by > 0.0001 when rounded to 1.000
      const result = validateBuyAmount(1.00012);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Precision');
    });
  });

  describe('validateSellAmount', () => {
    it('accepts valid amount with sufficient balance', () => {
      const result = validateSellAmount(5, 10);

      expect(result.isValid).toBe(true);
    });

    it('rejects amount below minimum', () => {
      const result = validateSellAmount(0.5, 10);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('minimum');
    });

    it('rejects amount exceeding balance', () => {
      const result = validateSellAmount(15, 10);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('insuffisant');
    });
  });

  // ─── Stock Availability ──────────────────────────────────
  describe('calculateStockAvailability', () => {
    it('calculates available stock', () => {
      const result = calculateStockAvailability(10000, 3000);

      expect(result.available).toBe(7000);
      expect(result.percentage).toBe(70);
      expect(result.isLow).toBe(false);
    });

    it('detects low stock', () => {
      const result = calculateStockAvailability(10000, 9500);

      expect(result.available).toBe(500);
      expect(result.percentage).toBe(5);
      expect(result.isLow).toBe(true);
    });

    it('handles zero allocation', () => {
      const result = calculateStockAvailability(0, 0);

      expect(result.percentage).toBe(0);
    });
  });

  // ─── Format Gold Equivalent ──────────────────────────────
  describe('formatGoldEquivalent', () => {
    it('formats singular gram', () => {
      expect(formatGoldEquivalent(1)).toBe("1,000 gramme d'or pur 24 carats");
    });

    it('formats plural grams', () => {
      expect(formatGoldEquivalent(5.5)).toBe("5,500 grammes d'or pur 24 carats");
    });
  });
});
