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
 *
 * A missed day is BACKFILLED, at that day's own price (ADR 011). The previous
 * version claimed the job would pick a skipped day up on the next run; it did
 * not — it credited the CURRENT date, so the position resumed and the lost day
 * was never paid. Each position is now handled in its own try: one transient
 * failure no longer silences everyone behind it in the list.
 */

import type { Env } from '../../types/env';
import { LeaseService } from '../../services/lease.service';
import { toIsoDate } from '../../lib/business-days';
import { ConfigService } from '../../services/config.service';
import { planifierRattrapage, veille } from '../../lib/accrual-backfill';

export async function accrueLeaseYield(env: Env, _ctx: ExecutionContext): Promise<void> {
  // Yesterday: a day is only fully elapsed once it is over.
  const now = new Date();
  const date = toIsoDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  const configService = new ConfigService(env.DB, env.CACHE);
  const plafond = await configService.getNumber('accrual_backfill_max_days', 30);

  const service = new LeaseService(env.DB);
  const positions = await service.positionsToAccrue(date);

  let booked = 0;
  let totalXof = 0;
  let enEchec = 0;
  const sansPrix = new Set<string>();
  const enRetard: string[] = [];

  for (const position of positions) {
    // Chaque position dans son propre try : une erreur passagere sur l'une ne
    // doit pas priver de rendement toutes celles qui la suivent.
    try {
      // Jamais creditee : le premier jour du est le jour d'OUVERTURE, pas
      // aujourd'hui. Le job valorise la veille, donc une position ouverte le 10
      // voit son 10 credite dans la nuit du 11 — la reference est la veille de
      // l'ouverture. Sans cela, une panne de plusieurs jours ne rattraperait
      // qu'une seule journee pour une position recente.
      const reference = position.last_accrued_on || veille(position.opened_at.slice(0, 10));
      const plan = await planifierRattrapage(env.DB, reference, date, plafond);
      plan.sansPrix.forEach((j) => sansPrix.add(j));
      if (plan.tronque) enRetard.push(position.id);

      for (const jour of plan.jours) {
        const result = await service.accrueDay(position, jour.date, jour.pricePerGram);
        if (result.ok) {
          booked++;
          totalXof += result.amountXof;
        }
      }
    } catch (error) {
      enEchec++;
      console.error(`[LeaseAccrual] position ${position.id} a echoue`, String(error));
    }
  }

  console.log(
    `[LeaseAccrual] ${date}: ${booked} jour(s) credite(s) sur ${positions.length} position(s), ${totalXof} XOF`
  );

  // Un ecart doit se VOIR. La version precedente ne laissait qu un compteur
  // `booked/total` dans une ligne d information que personne ne lit.
  if (enEchec > 0) {
    console.error(`[LeaseAccrual] ${enEchec} position(s) en echec — leur rendement du jour n est pas verse`);
  }
  if (sansPrix.size > 0) {
    console.error(
      `[LeaseAccrual] aucun prix releve pour ${[...sansPrix].sort().join(', ')} — ces jours restent non credites`
    );
  }
  if (enRetard.length > 0) {
    console.error(
      `[LeaseAccrual] plafond de ${plafond} jours atteint pour ${enRetard.length} position(s) : il reste des jours en arriere`
    );
  }
}
