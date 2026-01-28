/**
 * Tests for Phone Utilities
 */

import { describe, it, expect } from 'vitest';
import {
  isValidPhoneBF,
  normalizePhoneBF,
  formatPhoneDisplay,
  maskPhone,
  getPhoneOperator,
  getPhoneOperatorName,
  supportsMobileMoney,
  validatePhone,
} from './phone';

describe('Phone Utilities', () => {
  describe('isValidPhoneBF', () => {
    it('validates correct Burkina Faso numbers', () => {
      expect(isValidPhoneBF('+22670123456')).toBe(true);
      expect(isValidPhoneBF('+22660123456')).toBe(true);
      expect(isValidPhoneBF('+22650123456')).toBe(true);
    });

    it('validates numbers without country code', () => {
      expect(isValidPhoneBF('70123456')).toBe(true);
      expect(isValidPhoneBF('60123456')).toBe(true);
    });

    it('rejects invalid numbers', () => {
      expect(isValidPhoneBF('123456')).toBe(false);
      expect(isValidPhoneBF('+33612345678')).toBe(false);
      expect(isValidPhoneBF('invalid')).toBe(false);
    });
  });

  describe('normalizePhoneBF', () => {
    it('normalizes various formats to +226XXXXXXXX', () => {
      expect(normalizePhoneBF('70123456')).toBe('+22670123456');
      expect(normalizePhoneBF('22670123456')).toBe('+22670123456');
      expect(normalizePhoneBF('+22670123456')).toBe('+22670123456');
      expect(normalizePhoneBF('0070123456')).toBe('+22670123456');
    });

    it('handles numbers with leading zero', () => {
      expect(normalizePhoneBF('070123456')).toBe('+22670123456');
    });
  });

  describe('formatPhoneDisplay', () => {
    it('formats phone for display', () => {
      expect(formatPhoneDisplay('+22670123456')).toBe('+226 70 12 34 56');
    });

    it('returns original if invalid', () => {
      expect(formatPhoneDisplay('invalid')).toBe('invalid');
    });
  });

  describe('maskPhone', () => {
    it('masks middle digits', () => {
      expect(maskPhone('+22670123456')).toBe('+226 70 ** ** 56');
    });

    it('returns *** for invalid numbers', () => {
      expect(maskPhone('invalid')).toBe('***');
    });
  });

  describe('getPhoneOperator', () => {
    it('identifies Orange numbers (7X)', () => {
      expect(getPhoneOperator('+22670123456')).toBe('orange');
      expect(getPhoneOperator('+22679999999')).toBe('orange');
    });

    it('identifies Moov numbers (6X)', () => {
      expect(getPhoneOperator('+22660123456')).toBe('moov');
      expect(getPhoneOperator('+22669999999')).toBe('moov');
    });

    it('identifies Telecel numbers (5X)', () => {
      expect(getPhoneOperator('+22650123456')).toBe('telecel');
      expect(getPhoneOperator('+22659999999')).toBe('telecel');
    });

    it('returns unknown for invalid numbers', () => {
      expect(getPhoneOperator('invalid')).toBe('unknown');
    });
  });

  describe('getPhoneOperatorName', () => {
    it('returns operator display names', () => {
      expect(getPhoneOperatorName('+22670123456')).toBe('Orange Burkina');
      expect(getPhoneOperatorName('+22660123456')).toBe('Moov Africa');
      expect(getPhoneOperatorName('+22650123456')).toBe('Telecel Faso');
    });
  });

  describe('supportsMobileMoney', () => {
    it('returns Orange Money support for Orange numbers', () => {
      const support = supportsMobileMoney('+22670123456');
      expect(support.orangeMoney).toBe(true);
      expect(support.moovMoney).toBe(false);
    });

    it('returns Moov Money support for Moov numbers', () => {
      const support = supportsMobileMoney('+22660123456');
      expect(support.orangeMoney).toBe(false);
      expect(support.moovMoney).toBe(true);
    });

    it('returns no support for Telecel numbers', () => {
      const support = supportsMobileMoney('+22650123456');
      expect(support.orangeMoney).toBe(false);
      expect(support.moovMoney).toBe(false);
    });
  });

  describe('validatePhone', () => {
    it('returns valid result for correct numbers', () => {
      const result = validatePhone('+22670123456');
      expect(result.isValid).toBe(true);
      expect(result.normalized).toBe('+22670123456');
      expect(result.operator).toBe('Orange Burkina');
      expect(result.error).toBeUndefined();
    });

    it('returns error for empty input', () => {
      const result = validatePhone('');
      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns error for invalid format', () => {
      const result = validatePhone('123');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Format invalide');
    });
  });
});
