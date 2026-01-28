/**
 * Tests for Validation Utilities
 */

import { describe, it, expect } from 'vitest';
import {
  isValidEmail,
  validatePassword,
  getPasswordStrengthLabel,
  validateDateOfBirth,
  validateAmount,
  sanitizeString,
  validateName,
  validateTotpCode,
  validateVerificationCode,
  isEmpty,
  maskSensitiveData,
} from './validation';

describe('Validation Utilities', () => {
  describe('isValidEmail', () => {
    it('accepts valid emails', () => {
      expect(isValidEmail('user@example.com')).toBe(true);
      expect(isValidEmail('test.user@domain.org')).toBe(true);
      expect(isValidEmail('user+tag@example.com')).toBe(true);
    });

    it('rejects invalid emails', () => {
      expect(isValidEmail('invalid')).toBe(false);
      expect(isValidEmail('@example.com')).toBe(false);
      expect(isValidEmail('user@')).toBe(false);
      expect(isValidEmail('')).toBe(false);
    });
  });

  describe('validatePassword', () => {
    it('validates strong passwords', () => {
      const result = validatePassword('SecureP@ss123');
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.score).toBeGreaterThanOrEqual(4);
    });

    it('reports missing uppercase', () => {
      const result = validatePassword('securepass123!');
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('majuscule'))).toBe(true);
    });

    it('reports missing lowercase', () => {
      const result = validatePassword('SECUREPASS123!');
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('minuscule'))).toBe(true);
    });

    it('reports missing number', () => {
      const result = validatePassword('SecurePassword!');
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('chiffre'))).toBe(true);
    });

    it('reports missing special character', () => {
      const result = validatePassword('SecurePass1234');
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('special'))).toBe(true);
    });

    it('reports too short', () => {
      const result = validatePassword('Aa1!');
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('12'))).toBe(true);
    });
  });

  describe('getPasswordStrengthLabel', () => {
    it('returns correct labels for each score', () => {
      expect(getPasswordStrengthLabel(0).label).toBe('Tres faible');
      expect(getPasswordStrengthLabel(1).label).toBe('Tres faible');
      expect(getPasswordStrengthLabel(2).label).toBe('Faible');
      expect(getPasswordStrengthLabel(3).label).toBe('Moyen');
      expect(getPasswordStrengthLabel(4).label).toBe('Fort');
      expect(getPasswordStrengthLabel(5).label).toBe('Tres fort');
    });

    it('includes color class', () => {
      const result = getPasswordStrengthLabel(5);
      expect(result.color).toContain('text-');
    });
  });

  describe('validateDateOfBirth', () => {
    it('accepts valid adult dates', () => {
      const result = validateDateOfBirth('1990-01-15');
      expect(result.isValid).toBe(true);
      expect(result.age).toBeGreaterThanOrEqual(18);
    });

    it('rejects minors', () => {
      const recentDate = new Date();
      recentDate.setFullYear(recentDate.getFullYear() - 10);
      const result = validateDateOfBirth(recentDate);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('18 ans');
    });

    it('rejects future dates', () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      const result = validateDateOfBirth(futureDate);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('futur');
    });

    it('rejects invalid dates', () => {
      const result = validateDateOfBirth('invalid-date');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('invalide');
    });
  });

  describe('validateAmount', () => {
    it('accepts valid amounts', () => {
      const result = validateAmount(100);
      expect(result.isValid).toBe(true);
      expect(result.value).toBe(100);
    });

    it('accepts string amounts', () => {
      const result = validateAmount('50.5');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe(50.5);
    });

    it('rejects amounts below minimum', () => {
      const result = validateAmount(5, { min: 10 });
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('minimum');
    });

    it('rejects amounts above maximum', () => {
      const result = validateAmount(150, { max: 100 });
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('maximum');
    });

    it('rejects decimals when not allowed', () => {
      const result = validateAmount(10.5, { allowDecimals: false });
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('decimales');
    });

    it('rejects too many decimal places', () => {
      const result = validateAmount(10.12345, { maxDecimals: 2 });
      expect(result.isValid).toBe(false);
    });

    it('rejects NaN', () => {
      const result = validateAmount('abc');
      expect(result.isValid).toBe(false);
      expect(result.value).toBe(0);
    });
  });

  describe('sanitizeString', () => {
    it('trims whitespace', () => {
      expect(sanitizeString('  hello  ')).toBe('hello');
    });

    it('removes angle brackets', () => {
      expect(sanitizeString('<script>alert(1)</script>')).toBe('scriptalert(1)/script');
    });

    it('removes javascript: protocol', () => {
      expect(sanitizeString('javascript:alert(1)')).toBe('alert(1)');
    });

    it('removes event handlers', () => {
      // Removes "onclick=" prefix, leaving the value
      expect(sanitizeString('onclick=alert(1)')).toBe('alert(1)');
      expect(sanitizeString('onmouseover=hack()')).toBe('hack()');
    });
  });

  describe('validateName', () => {
    it('accepts valid names', () => {
      const result = validateName('Jean-Pierre');
      expect(result.isValid).toBe(true);
      expect(result.sanitized).toBe('Jean-Pierre');
    });

    it('accepts names with accents', () => {
      const result = validateName('François');
      expect(result.isValid).toBe(true);
    });

    it('rejects too short names', () => {
      const result = validateName('J');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('2');
    });

    it('rejects too long names', () => {
      const result = validateName('A'.repeat(60));
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('50');
    });

    it('rejects names with numbers', () => {
      const result = validateName('Jean123');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('invalides');
    });
  });

  describe('validateTotpCode', () => {
    it('accepts valid 6-digit codes', () => {
      expect(validateTotpCode('123456')).toBe(true);
      expect(validateTotpCode('000000')).toBe(true);
    });

    it('rejects invalid codes', () => {
      expect(validateTotpCode('12345')).toBe(false);
      expect(validateTotpCode('1234567')).toBe(false);
      expect(validateTotpCode('abcdef')).toBe(false);
    });
  });

  describe('validateVerificationCode', () => {
    it('accepts valid 6-digit codes', () => {
      expect(validateVerificationCode('123456')).toBe(true);
    });

    it('rejects invalid codes', () => {
      expect(validateVerificationCode('12345')).toBe(false);
      expect(validateVerificationCode('abc123')).toBe(false);
    });
  });

  describe('isEmpty', () => {
    it('detects empty values', () => {
      expect(isEmpty(null)).toBe(true);
      expect(isEmpty(undefined)).toBe(true);
      expect(isEmpty('')).toBe(true);
      expect(isEmpty('   ')).toBe(true);
      expect(isEmpty([])).toBe(true);
      expect(isEmpty({})).toBe(true);
    });

    it('detects non-empty values', () => {
      expect(isEmpty('hello')).toBe(false);
      expect(isEmpty([1])).toBe(false);
      expect(isEmpty({ a: 1 })).toBe(false);
      expect(isEmpty(0)).toBe(false);
      expect(isEmpty(false)).toBe(false);
    });
  });

  describe('maskSensitiveData', () => {
    it('masks middle of data', () => {
      expect(maskSensitiveData('1234567890')).toBe('1234**7890');
    });

    it('masks short data completely', () => {
      expect(maskSensitiveData('1234')).toBe('****');
    });

    it('respects custom visible chars', () => {
      expect(maskSensitiveData('1234567890', 2)).toBe('12******90');
    });
  });
});
