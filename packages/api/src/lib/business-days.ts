/**
 * Business-day arithmetic for settlement dates.
 *
 * T+3 on a lease exit is the loan recall period, so it must count working days:
 * a request placed on a Thursday settles the following Tuesday, not Sunday.
 *
 * Weekends only. Public holidays are deliberately NOT hardcoded — they differ by
 * jurisdiction (Burkina Faso, UAE) and change yearly, so a wrong list would
 * quietly produce wrong settlement dates. When holidays matter, pass them in.
 */

/** ISO date (YYYY-MM-DD) in UTC, which is how settlement dates are stored. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6; // Sunday, Saturday
}

/**
 * Add `days` business days to a date.
 *
 * The start date itself is never counted, matching the T+n convention: T+0
 * settles the same day, T+1 the next business day.
 */
export function addBusinessDays(from: Date, days: number, holidays: string[] = []): Date {
  const closed = new Set(holidays);
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));

  let remaining = Math.max(0, Math.floor(days));
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (!isWeekend(cursor) && !closed.has(toIsoDate(cursor))) {
      remaining--;
    }
  }
  return cursor;
}

/** Settlement date for an order placed at `requestedAt`, as an ISO date. */
export function settlementDate(requestedAt: Date, businessDays: number, holidays: string[] = []): string {
  return toIsoDate(addBusinessDays(requestedAt, businessDays, holidays));
}

/** Whether an order dated `settlesOn` is due as of `today`. */
export function isDue(settlesOn: string, today: Date = new Date()): boolean {
  return settlesOn <= toIsoDate(today);
}
