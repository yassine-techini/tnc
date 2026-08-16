/**
 * Daily lease accrual.
 *
 * Values each active position at the day's spot price and books one day of
 * yield in XOF. Two deliberate choices:
 *
 *  - The price is read from the DATABASE, not from the KV cache. The cache
 *    exists to serve quotes fast; accounting should not book a day of yield on
 *    a value that happens to be stale.
 *
 *  - The SPOT price (`price_xof`) is used, not buy or sell. The yield is on the
 *    value of the metal; taking the buy price would inflate it and the sell
 *    price would shave it, for no reason other than which side of the spread
 *    happened to be handy.
 *
 * The job is safe to re-run: `lease_accruals` is UNIQUE on (position, date), so
 * a second pass over the same day books nothing.
 */

import type { Env } from '../../types/env';
import { LeaseService } from '../../services/lease.service';
import { toIsoDate } from '../../lib/business-days';

export async function accrueLeaseYield(env: Env, _ctx: ExecutionContext): Promise<void> {
  // Yesterday: a day is only fully elapsed once it is over.
  const now = new Date();
  const date = toIsoDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  const price = await env.DB.prepare(
    'SELECT price_xof FROM gold_prices ORDER BY timestamp DESC LIMIT 1'
  ).first<{ price_xof: number }>();

  if (!price || !(price.price_xof > 0)) {
    // No price means no defensible valuation. Skipping leaves the day unaccrued
    // and the job picks it up on the next run rather than booking a wrong figure.
    console.error('[LeaseAccrual] No gold price available — skipped, nothing booked');
    return;
  }

  const service = new LeaseService(env.DB);
  const positions = await service.positionsToAccrue(date);

  let booked = 0;
  let totalXof = 0;

  for (const position of positions) {
    const result = await service.accrueDay(position, date, price.price_xof);
    if (result.ok) {
      booked++;
      totalXof += result.amountXof;
    }
  }

  console.log(
    `[LeaseAccrual] ${date}: ${booked}/${positions.length} positions accrued, ${totalXof} XOF at ${price.price_xof} XOF/g`
  );
}
