/**
 * Frais de garde quotidiens.
 *
 * Deux temps, dans cet ordre : facturer le jour écoulé, puis tenter de solder
 * les arriérés. Un raffineur qui a vendu une part de son lot depuis la veille
 * solde ainsi son retard au passage suivant, sans intervention (ADR 005).
 *
 * Le prix vient de la BASE, pas du cache KV : le cache existe pour servir des
 * devis rapidement, et la comptabilité ne doit pas facturer une journée sur une
 * valeur qui se trouve être périmée. Le prix SPOT est retenu, pas un côté du
 * spread — la garde porte sur la valeur du métal, pas sur une intention de
 * l'acheter ou de le vendre.
 */

import type { Env } from '../../types/env';
import { StorageFeeService } from '../../services/storage-fee.service';
import { ConfigService } from '../../services/config.service';
import { toIsoDate } from '../../lib/business-days';

export async function chargeStorageFees(env: Env, _ctx: ExecutionContext): Promise<void> {
  // La veille : une journée de garde ne se facture qu'une fois écoulée.
  const date = toIsoDate(new Date(Date.now() - 24 * 60 * 60 * 1000));

  const price = await env.DB.prepare(
    'SELECT price_xof FROM gold_prices ORDER BY timestamp DESC LIMIT 1'
  ).first<{ price_xof: number }>();

  if (!price || !(price.price_xof > 0)) {
    // Sans prix, aucune valorisation défendable. Sauter laisse la journée non
    // facturée et le job la reprendra, plutôt que d'inscrire un montant faux —
    // un frais erroné est plus difficile à corriger qu'un frais en retard.
    console.error('[StorageFee] Aucun prix disponible — journée non facturée');
    return;
  }

  const config = new ConfigService(env.DB, env.CACHE);
  const [annualRate, appliesTo] = await Promise.all([
    config.getNumber('storage_fee_annual_rate', 0.005),
    config.get('storage_fee_applies_to', 'REFINER'),
  ]);

  if (!(annualRate > 0)) {
    console.log('[StorageFee] Taux nul — facturation désactivée');
    return;
  }

  const service = new StorageFeeService(env.DB);
  const holders = await service.holdersToCharge(date, appliesTo || 'REFINER');

  let charged = 0;
  let paid = 0;
  let totalXof = 0;

  for (const holder of holders) {
    const result = await service.accrueDay(holder, date, price.price_xof, annualRate);
    if (!result.accrued) continue;
    charged++;
    totalXof += result.amountXof;
    if (result.paid) paid++;
  }

  // Second temps : les arriérés de ceux qui ont désormais de quoi payer. Fait
  // pour TOUS les détenteurs ayant un impayé, pas seulement ceux facturés
  // aujourd'hui — un raffineur qui a tout vendu n'a plus d'or gardé mais peut
  // encore devoir les jours précédents.
  const debtors = await env.DB.prepare(
    `SELECT DISTINCT f.user_id, w.id AS wallet_id
     FROM storage_fee_accruals f
     JOIN wallets w ON w.user_id = f.user_id
     WHERE f.status = 'OUTSTANDING'`
  ).all<{ user_id: string; wallet_id: string }>();

  let recovered = 0;
  for (const debtor of debtors.results || []) {
    const settled = await service.settleOutstanding(debtor.user_id, debtor.wallet_id);
    recovered += settled.paidXof;
  }

  console.log(
    `[StorageFee] ${date}: ${charged} détenteurs facturés (${totalXof} XOF), ${paid} réglés immédiatement, ${recovered} XOF d'arriérés recouvrés`
  );
}
