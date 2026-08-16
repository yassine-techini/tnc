import { describe, it, expect } from 'vitest';
import { addBusinessDays, settlementDate, isWeekend, isDue, toIsoDate } from './business-days';

// 2026-08-13 is a Thursday.
const THURSDAY = new Date('2026-08-13T10:00:00Z');
const FRIDAY = new Date('2026-08-14T10:00:00Z');
const SATURDAY = new Date('2026-08-15T10:00:00Z');

describe('isWeekend', () => {
  it('recognises Saturday and Sunday', () => {
    expect(isWeekend(new Date('2026-08-15T00:00:00Z'))).toBe(true); // Sat
    expect(isWeekend(new Date('2026-08-16T00:00:00Z'))).toBe(true); // Sun
    expect(isWeekend(THURSDAY)).toBe(false);
    expect(isWeekend(FRIDAY)).toBe(false);
  });
});

describe('addBusinessDays', () => {
  it('skips the weekend', () => {
    // Thursday + 3 business days = Tuesday, not Sunday.
    expect(toIsoDate(addBusinessDays(THURSDAY, 3))).toBe('2026-08-18');
  });

  it('never counts the start date itself', () => {
    // T+0 settles same day; T+1 is the next business day.
    expect(toIsoDate(addBusinessDays(THURSDAY, 0))).toBe('2026-08-13');
    expect(toIsoDate(addBusinessDays(THURSDAY, 1))).toBe('2026-08-14');
  });

  it('rolls forward from a weekend request', () => {
    // Requested Saturday, T+1 lands Monday.
    expect(toIsoDate(addBusinessDays(SATURDAY, 1))).toBe('2026-08-17');
  });

  it('crosses a whole weekend when starting on Friday', () => {
    expect(toIsoDate(addBusinessDays(FRIDAY, 1))).toBe('2026-08-17'); // Monday
    expect(toIsoDate(addBusinessDays(FRIDAY, 3))).toBe('2026-08-19');
  });

  it('honours holidays when they are supplied', () => {
    // Monday closed: T+1 from Friday lands Tuesday instead.
    expect(toIsoDate(addBusinessDays(FRIDAY, 1, ['2026-08-17']))).toBe('2026-08-18');
  });

  it('ignores the time of day — settlement is a date, not an instant', () => {
    const early = new Date('2026-08-13T00:01:00Z');
    const late = new Date('2026-08-13T23:59:00Z');
    expect(toIsoDate(addBusinessDays(early, 3))).toBe(toIsoDate(addBusinessDays(late, 3)));
  });

  it('treats a negative or fractional delay as no delay', () => {
    expect(toIsoDate(addBusinessDays(THURSDAY, -5))).toBe('2026-08-13');
    expect(toIsoDate(addBusinessDays(THURSDAY, 0.9))).toBe('2026-08-13');
  });

  it('crosses a month boundary', () => {
    // Monday 2026-08-31 + 2 business days = Wednesday 2026-09-02.
    expect(toIsoDate(addBusinessDays(new Date('2026-08-31T10:00:00Z'), 2))).toBe('2026-09-02');
  });
});

describe('settlementDate / isDue', () => {
  it('produces the stored ISO date', () => {
    expect(settlementDate(THURSDAY, 3)).toBe('2026-08-18');
  });

  it('is due on the settlement day, not before', () => {
    expect(isDue('2026-08-18', new Date('2026-08-17T23:00:00Z'))).toBe(false);
    expect(isDue('2026-08-18', new Date('2026-08-18T00:00:00Z'))).toBe(true);
    // And an order left unprocessed stays due rather than being skipped.
    expect(isDue('2026-08-18', new Date('2026-08-25T00:00:00Z'))).toBe(true);
  });
});
