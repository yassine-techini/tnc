/**
 * Tests for Currency Utilities
 */

import { describe, it, expect } from 'vitest';
import {
  formatXOF,
  formatUSD,
  usdToXof,
  xofToUsd,
  parseCurrencyString,
  formatPercent,
  formatPriceChange,
  calculateTotalWithFees,
  calculateNetAfterFees,
} from './currency';

describe('Currency Utilities', () => {
  describe('formatXOF', () => {
    it('formats positive amounts', () => {
      // Uses narrow no-break space (U+202F) from toLocaleString('fr-FR')
      expect(formatXOF(50000)).toMatch(/50.000 FCFA/);
      expect(formatXOF(1000000)).toMatch(/1.000.000 FCFA/);
    });

    it('formats without currency symbol', () => {
      expect(formatXOF(50000, { showCurrency: false })).toMatch(/50.000$/);
    });

    it('shows sign for positive amounts', () => {
      expect(formatXOF(50000, { showSign: true })).toMatch(/\+50.000 FCFA/);
    });

    it('formats negative amounts', () => {
      expect(formatXOF(-50000)).toMatch(/-50.000 FCFA/);
    });

    it('formats compact amounts', () => {
      expect(formatXOF(1500000, { compact: true })).toBe('1.5M FCFA');
      expect(formatXOF(50000, { compact: true })).toBe('50K FCFA');
    });

    it('rounds to whole numbers', () => {
      expect(formatXOF(50000.75)).toMatch(/50.001 FCFA/);
    });
  });

  describe('formatUSD', () => {
    it('formats USD amounts', () => {
      expect(formatUSD(85.50)).toBe('$85.50');
    });

    it('formats without currency symbol', () => {
      expect(formatUSD(85.50, { showCurrency: false })).toBe('85.50');
    });

    it('respects decimal places', () => {
      expect(formatUSD(85.555, { decimals: 3 })).toBe('$85.555');
    });
  });

  describe('usdToXof', () => {
    it('converts USD to XOF with default rate', () => {
      const result = usdToXof(100);
      expect(result).toBe(61500); // 100 * 615
    });

    it('converts with custom rate', () => {
      const result = usdToXof(100, 600);
      expect(result).toBe(60000);
    });

    it('rounds to whole number', () => {
      const result = usdToXof(10.5);
      expect(Number.isInteger(result)).toBe(true);
    });
  });

  describe('xofToUsd', () => {
    it('converts XOF to USD with default rate', () => {
      const result = xofToUsd(61500);
      expect(result).toBe(100); // 61500 / 615
    });

    it('converts with custom rate', () => {
      const result = xofToUsd(60000, 600);
      expect(result).toBe(100);
    });
  });

  describe('parseCurrencyString', () => {
    it('parses formatted XOF', () => {
      expect(parseCurrencyString('50 000 FCFA')).toBe(50000);
    });

    it('parses formatted USD', () => {
      expect(parseCurrencyString('$85.50')).toBe(85.50);
    });

    it('parses negative amounts', () => {
      expect(parseCurrencyString('-50 000')).toBe(-50000);
    });

    it('returns 0 for invalid input', () => {
      expect(parseCurrencyString('invalid')).toBe(0);
    });
  });

  describe('formatPercent', () => {
    it('formats positive percentages with sign', () => {
      expect(formatPercent(0.0234)).toBe('+2.34%');
    });

    it('formats negative percentages', () => {
      expect(formatPercent(-0.0234)).toBe('-2.34%');
    });

    it('formats without sign', () => {
      expect(formatPercent(0.0234, { showSign: false })).toBe('2.34%');
    });

    it('respects decimal places', () => {
      expect(formatPercent(0.02345, { decimals: 3 })).toBe('+2.345%');
    });
  });

  describe('formatPriceChange', () => {
    it('returns positive change info', () => {
      const result = formatPriceChange(0.05);
      expect(result.isPositive).toBe(true);
      expect(result.isNeutral).toBe(false);
      expect(result.formatted).toContain('+');
    });

    it('returns negative change info', () => {
      const result = formatPriceChange(-0.05);
      expect(result.isPositive).toBe(false);
      expect(result.isNeutral).toBe(false);
      expect(result.formatted).toContain('-');
    });

    it('returns neutral change info', () => {
      const result = formatPriceChange(0);
      expect(result.isPositive).toBe(false);
      expect(result.isNeutral).toBe(true);
    });
  });

  describe('calculateTotalWithFees', () => {
    it('calculates amount + fees', () => {
      const result = calculateTotalWithFees(100000, 0.02);
      expect(result.amount).toBe(100000);
      expect(result.fees).toBe(2000);
      expect(result.total).toBe(102000);
    });

    it('rounds fees to whole number', () => {
      const result = calculateTotalWithFees(10001, 0.02);
      expect(Number.isInteger(result.fees)).toBe(true);
    });
  });

  describe('calculateNetAfterFees', () => {
    it('calculates amount - fees', () => {
      const result = calculateNetAfterFees(100000, 0.02);
      expect(result.amount).toBe(100000);
      expect(result.fees).toBe(2000);
      expect(result.net).toBe(98000);
    });
  });
});
