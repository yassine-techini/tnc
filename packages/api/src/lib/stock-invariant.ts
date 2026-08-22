/**
 * L'invariant fondamental de la reserve : tokens emis <= or alloue.
 *
 * La base le protege deja (`CHECK (tokens_issued <= total_allocated)`), donc
 * aucune donnee ne peut etre corrompue. Ce module ne remplace pas ce rempart —
 * il le DOUBLE en amont, pour deux raisons :
 *
 *   1. Laisser la contrainte echouer renvoyait un `INTERNAL_ERROR` generique.
 *      L'administrateur qui tente de reduire l'allocation sous ce qui est deja
 *      emis lisait « erreur interne » au lieu du plancher qu'il ne peut pas
 *      franchir.
 *   2. Une regle extraite se teste. Reproduire la meme arithmetique dans un test
 *      prouverait la copie, pas la route.
 */

export interface VerdictAjustement {
  ok: boolean;
  /** Total apres ajustement — calcule meme en cas de refus, pour le message. */
  newTotal: number;
  code?: 'INVALID_INPUT' | 'STOCK_BELOW_ISSUED';
  /**
   * PAS DE `message` (ADR 025). Cette regle est appelee hors de toute requete —
   * elle ne connait donc pas la langue du lecteur. Elle nomme le refus et
   * fournit de quoi le rendre (`details.tokensIssued`) ; la route s'en charge.
   */
  status?: 400 | 409;
  details?: { tokensIssued: number; currentAllocated: number; requestedTotal: number };
}

/**
 * Forme PLATE, pas une union discriminee : ce paquet compile avec
 * `strictNullChecks: false`, ou TypeScript ne retrecit pas sur `ok`.
 */
export function verifierAjustementStock(
  amount: unknown,
  stock: { total_allocated: number; tokens_issued: number } | null
): VerdictAjustement {
  const alloue = stock?.total_allocated || 0;
  const emis = stock?.tokens_issued || 0;

  // `NaN` et `Infinity` sont `typeof 'number'`. Un montant nul n'ajuste rien et
  // ne merite pas une entree dans la piste d'audit.
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) {
    return {
      ok: false,
      newTotal: alloue,
      code: 'INVALID_INPUT',
      status: 400,
    };
  }

  const newTotal = alloue + amount;

  // Borne INCLUSE : allouer exactement ce qui est emis reste coherent, il ne
  // reste simplement plus rien de disponible.
  if (newTotal < emis) {
    return {
      ok: false,
      newTotal,
      code: 'STOCK_BELOW_ISSUED',
      status: 409,
      details: { tokensIssued: emis, currentAllocated: alloue, requestedTotal: newTotal },
    };
  }

  return { ok: true, newTotal };
}
