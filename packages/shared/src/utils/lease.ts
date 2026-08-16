/**
 * Lease rules shared by the web and mobile screens.
 *
 * These are the checks that stop a bad position being opened. They live here
 * rather than inside each screen because two copies of a financial rule drift,
 * and the one that drifts is always the one nobody tested.
 *
 * The API enforces all of this again server-side — this is what lets the
 * interface explain the problem before the round trip, not what makes it safe.
 */

export type LeaseAmountProblem =
  | 'EMPTY'
  | 'NOT_A_NUMBER'
  | 'BELOW_MINIMUM'
  | 'OVER_BALANCE'
  | 'NOT_ACKNOWLEDGED';

export interface LeaseAmountCheck {
  /** Parsed grams, or null when the input is not a usable number. */
  grams: number | null;
  valid: boolean;
  problem: LeaseAmountProblem | null;
}

/**
 * Validate an amount typed into the lease form.
 *
 * Accepts a comma as the decimal separator: it is what a French keyboard offers
 * first, and refusing it would look like a broken field rather than a rule.
 */
export function checkLeaseAmount(input: {
  raw: string | number;
  minimumG: number;
  availableG: number;
  acknowledged: boolean;
}): LeaseAmountCheck {
  const raw = typeof input.raw === 'number' ? String(input.raw) : input.raw.trim();
  if (raw === '') return { grams: null, valid: false, problem: 'EMPTY' };

  const grams = Number(raw.replace(',', '.'));
  if (!Number.isFinite(grams) || grams <= 0) {
    return { grams: null, valid: false, problem: 'NOT_A_NUMBER' };
  }

  // Reported in the order the user can act on: fix the amount first, then agree
  // to the terms. Flagging the unticked box while the amount is still wrong
  // would send them to the wrong control.
  if (grams < input.minimumG) return { grams, valid: false, problem: 'BELOW_MINIMUM' };
  if (grams > input.availableG) return { grams, valid: false, problem: 'OVER_BALANCE' };
  if (!input.acknowledged) return { grams, valid: false, problem: 'NOT_ACKNOWLEDGED' };

  return { grams, valid: true, problem: null };
}

/**
 * Order-of-magnitude yield over a year, at the current spot price.
 *
 * Spot, never the buy or sell price: the daily accrual values the principal at
 * spot, so a projection built on either side of the spread would not match what
 * is actually booked. It is an illustration and not a promise — each day is
 * computed on that day's price, which nobody knows in advance.
 */
export function projectAnnualLeaseYieldXof(input: {
  grams: number;
  spotPerGramXof: number;
  annualRate: number;
}): number {
  if (!(input.grams > 0) || !(input.spotPerGramXof > 0) || !(input.annualRate > 0)) return 0;
  return Math.round(input.grams * input.spotPerGramXof * input.annualRate);
}

/** One day of yield, the same Actual/365 the accrual job books. */
export function dailyLeaseYieldXof(input: {
  grams: number;
  spotPerGramXof: number;
  annualRate: number;
}): number {
  if (!(input.grams > 0) || !(input.spotPerGramXof > 0) || !(input.annualRate > 0)) return 0;
  return Math.round((input.grams * input.spotPerGramXof * input.annualRate) / 365);
}
