import { describe, it, expect } from 'vitest';
import { groupDigits, formatXof, formatGrams } from './format';

describe('groupDigits', () => {
  it('groups thousands with a plain space', () => {
    // Deliberately not toLocaleString: Android ships a trimmed ICU build unless
    // configured otherwise, so the same amount could render differently from one
    // device to the next.
    expect(groupDigits(33_000_000)).toBe('33 000 000');
    expect(groupDigits(1_000)).toBe('1 000');
    expect(groupDigits(999)).toBe('999');
    expect(groupDigits(0)).toBe('0');
  });

  it('rounds to the unit — XOF has no minor unit', () => {
    expect(groupDigits(1234.4)).toBe('1 234');
    expect(groupDigits(1234.6)).toBe('1 235');
  });

  it('keeps the sign in front of the digits', () => {
    expect(groupDigits(-1_500)).toBe('-1 500');
    expect(groupDigits(-999)).toBe('-999');
  });
});

describe('formatXof', () => {
  it('labels the currency the way users read it', () => {
    expect(formatXof(53_000)).toBe('53 000 FCFA');
  });
});

describe('formatGrams', () => {
  it('shows the milligram, the unit the platform accounts in', () => {
    expect(formatGrams(120.5)).toBe('120.500 g');
    expect(formatGrams(0.001)).toBe('0.001 g');
    expect(formatGrams(0)).toBe('0.000 g');
  });

  it('rounds rather than truncating below the milligram', () => {
    expect(formatGrams(0.0006)).toBe('0.001 g');
  });
});
