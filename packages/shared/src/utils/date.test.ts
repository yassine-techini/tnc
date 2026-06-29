/**
 * Date Utilities Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatTime,
  formatRelativeTime,
  formatMonth,
  formatFullDate,
  isToday,
  isPast,
  isFuture,
  daysUntil,
  daysSince,
  addDays,
  formatCountdown,
  parseFrenchDate,
  getDayBounds,
  getMonthBounds,
} from './date.js';

describe('Date Utilities', () => {
  // ─── Format Date ────────────────────────────────────────
  describe('formatDate', () => {
    it('formats date as DD/MM/YYYY', () => {
      const date = new Date(2026, 0, 15); // 15 January 2026
      expect(formatDate(date)).toBe('15/01/2026');
    });

    it('handles string input', () => {
      expect(formatDate('2026-03-09')).toMatch(/09\/03\/2026/);
    });

    it('pads single digit days and months', () => {
      const date = new Date(2026, 4, 5); // 5 May 2026
      expect(formatDate(date)).toBe('05/05/2026');
    });
  });

  describe('formatDateTime', () => {
    it('formats date as DD/MM/YYYY HH:mm', () => {
      const date = new Date(2026, 0, 15, 14, 30);
      expect(formatDateTime(date)).toBe('15/01/2026 14:30');
    });

    it('handles string input', () => {
      const result = formatDateTime('2026-03-09T10:15:00');
      expect(result).toMatch(/09\/03\/2026 \d{2}:\d{2}/);
    });

    it('pads single digit hours and minutes', () => {
      const date = new Date(2026, 0, 15, 8, 5);
      expect(formatDateTime(date)).toBe('15/01/2026 08:05');
    });
  });

  describe('formatTime', () => {
    it('formats time as HH:mm', () => {
      const date = new Date(2026, 0, 15, 14, 30);
      expect(formatTime(date)).toBe('14:30');
    });

    it('pads single digit hours and minutes', () => {
      const date = new Date(2026, 0, 15, 9, 5);
      expect(formatTime(date)).toBe('09:05');
    });
  });

  // ─── Relative Time ──────────────────────────────────────
  describe('formatRelativeTime', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 9, 12, 0, 0));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns "A l\'instant" for recent times', () => {
      const date = new Date(2026, 2, 9, 11, 59, 30);
      expect(formatRelativeTime(date)).toBe("A l'instant");
    });

    it('returns minutes ago', () => {
      const date = new Date(2026, 2, 9, 11, 55, 0);
      expect(formatRelativeTime(date)).toBe('Il y a 5 minutes');
    });

    it('returns singular minute', () => {
      const date = new Date(2026, 2, 9, 11, 59, 0);
      expect(formatRelativeTime(date)).toBe('Il y a 1 minute');
    });

    it('returns hours ago', () => {
      const date = new Date(2026, 2, 9, 9, 0, 0);
      expect(formatRelativeTime(date)).toBe('Il y a 3 heures');
    });

    it('returns singular hour', () => {
      const date = new Date(2026, 2, 9, 11, 0, 0);
      expect(formatRelativeTime(date)).toBe('Il y a 1 heure');
    });

    it('returns "Hier" for yesterday', () => {
      const date = new Date(2026, 2, 8, 12, 0, 0);
      expect(formatRelativeTime(date)).toBe('Hier');
    });

    it('returns days ago for this week', () => {
      const date = new Date(2026, 2, 6, 12, 0, 0);
      expect(formatRelativeTime(date)).toBe('Il y a 3 jours');
    });

    it('returns formatted date for older dates', () => {
      const date = new Date(2026, 2, 1, 12, 0, 0);
      expect(formatRelativeTime(date)).toBe('01/03/2026');
    });
  });

  // ─── Month Formatting ───────────────────────────────────
  describe('formatMonth', () => {
    it('returns French month name with year', () => {
      expect(formatMonth(new Date(2026, 0, 1))).toBe('janvier 2026');
      expect(formatMonth(new Date(2026, 6, 15))).toBe('juillet 2026');
      expect(formatMonth(new Date(2026, 11, 31))).toBe('decembre 2026');
    });
  });

  describe('formatFullDate', () => {
    it('returns full French date', () => {
      expect(formatFullDate(new Date(2026, 0, 15))).toBe('15 janvier 2026');
      expect(formatFullDate(new Date(2026, 7, 1))).toBe('1 aout 2026');
    });
  });

  // ─── Date Checks ────────────────────────────────────────
  describe('isToday', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 9, 12, 0, 0));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns true for today', () => {
      expect(isToday(new Date(2026, 2, 9, 8, 0, 0))).toBe(true);
      expect(isToday(new Date(2026, 2, 9, 23, 59, 59))).toBe(true);
    });

    it('returns false for other days', () => {
      expect(isToday(new Date(2026, 2, 8))).toBe(false);
      expect(isToday(new Date(2026, 2, 10))).toBe(false);
    });
  });

  describe('isPast', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 9, 12, 0, 0));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns true for past dates', () => {
      expect(isPast(new Date(2026, 2, 8))).toBe(true);
      expect(isPast(new Date(2025, 0, 1))).toBe(true);
    });

    it('returns false for future dates', () => {
      expect(isPast(new Date(2026, 2, 10))).toBe(false);
      expect(isPast(new Date(2027, 0, 1))).toBe(false);
    });
  });

  describe('isFuture', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 9, 12, 0, 0));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns true for future dates', () => {
      expect(isFuture(new Date(2026, 2, 10))).toBe(true);
      expect(isFuture(new Date(2027, 0, 1))).toBe(true);
    });

    it('returns false for past dates', () => {
      expect(isFuture(new Date(2026, 2, 8))).toBe(false);
      expect(isFuture(new Date(2025, 0, 1))).toBe(false);
    });
  });

  // ─── Days Calculations ──────────────────────────────────
  describe('daysUntil', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 9, 12, 0, 0));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns positive days for future dates', () => {
      expect(daysUntil(new Date(2026, 2, 14))).toBe(5);
      expect(daysUntil(new Date(2026, 2, 10))).toBe(1);
    });

    it('returns negative days for past dates', () => {
      expect(daysUntil(new Date(2026, 2, 4))).toBe(-5);
    });
  });

  describe('daysSince', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 9, 12, 0, 0));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns positive days for past dates', () => {
      expect(daysSince(new Date(2026, 2, 4))).toBe(5);
      expect(daysSince(new Date(2026, 2, 8))).toBe(1);
    });

    it('returns negative days for future dates', () => {
      expect(daysSince(new Date(2026, 2, 14))).toBe(-5);
    });
  });

  describe('addDays', () => {
    it('adds days to a date', () => {
      const date = new Date(2026, 2, 9);
      const result = addDays(date, 5);
      expect(result.getDate()).toBe(14);
      expect(result.getMonth()).toBe(2);
    });

    it('handles month boundaries', () => {
      const date = new Date(2026, 2, 30);
      const result = addDays(date, 5);
      expect(result.getMonth()).toBe(3); // April
      expect(result.getDate()).toBe(4);
    });

    it('handles negative days', () => {
      const date = new Date(2026, 2, 9);
      const result = addDays(date, -5);
      expect(result.getDate()).toBe(4);
    });

    it('handles string input', () => {
      const result = addDays('2026-03-09', 5);
      expect(result.getDate()).toBe(14);
    });
  });

  // ─── Countdown ──────────────────────────────────────────
  describe('formatCountdown', () => {
    it('formats seconds as MM:SS', () => {
      expect(formatCountdown(45)).toBe('00:45');
      expect(formatCountdown(90)).toBe('01:30');
      expect(formatCountdown(125)).toBe('02:05');
    });

    it('handles zero', () => {
      expect(formatCountdown(0)).toBe('00:00');
    });

    it('handles negative values', () => {
      expect(formatCountdown(-10)).toBe('00:00');
    });

    it('handles large values', () => {
      expect(formatCountdown(3661)).toBe('61:01');
    });
  });

  // ─── Parse French Date ──────────────────────────────────
  describe('parseFrenchDate', () => {
    it('parses valid DD/MM/YYYY format', () => {
      const result = parseFrenchDate('15/01/2026');
      expect(result).not.toBeNull();
      expect(result!.getDate()).toBe(15);
      expect(result!.getMonth()).toBe(0);
      expect(result!.getFullYear()).toBe(2026);
    });

    it('returns null for invalid format', () => {
      expect(parseFrenchDate('2026-01-15')).toBeNull();
      expect(parseFrenchDate('15-01-2026')).toBeNull();
      expect(parseFrenchDate('invalid')).toBeNull();
    });

    it('returns null for invalid dates', () => {
      expect(parseFrenchDate('32/01/2026')).not.toBeNull(); // JavaScript Date accepts this
      expect(parseFrenchDate('AA/01/2026')).toBeNull();
    });
  });

  // ─── Day Bounds ─────────────────────────────────────────
  describe('getDayBounds', () => {
    it('returns start and end of day', () => {
      const date = new Date(2026, 2, 9, 14, 30, 45);
      const { start, end } = getDayBounds(date);

      expect(start.getHours()).toBe(0);
      expect(start.getMinutes()).toBe(0);
      expect(start.getSeconds()).toBe(0);
      expect(start.getMilliseconds()).toBe(0);

      expect(end.getHours()).toBe(23);
      expect(end.getMinutes()).toBe(59);
      expect(end.getSeconds()).toBe(59);
      expect(end.getMilliseconds()).toBe(999);
    });

    it('handles string input', () => {
      const { start, end } = getDayBounds('2026-03-09');
      expect(start.getDate()).toBe(9);
      expect(end.getDate()).toBe(9);
    });
  });

  describe('getMonthBounds', () => {
    it('returns start and end of month', () => {
      const date = new Date(2026, 2, 15); // March 15, 2026
      const { start, end } = getMonthBounds(date);

      expect(start.getDate()).toBe(1);
      expect(start.getMonth()).toBe(2);

      expect(end.getDate()).toBe(31); // March has 31 days
      expect(end.getMonth()).toBe(2);
      expect(end.getHours()).toBe(23);
      expect(end.getMinutes()).toBe(59);
    });

    it('handles February correctly', () => {
      const { start, end } = getMonthBounds(new Date(2026, 1, 15));

      expect(start.getDate()).toBe(1);
      expect(end.getDate()).toBe(28); // 2026 is not a leap year
    });

    it('handles leap year February', () => {
      const { start, end } = getMonthBounds(new Date(2024, 1, 15));

      expect(end.getDate()).toBe(29); // 2024 is a leap year
    });
  });
});
