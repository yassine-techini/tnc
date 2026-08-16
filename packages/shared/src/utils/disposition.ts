/**
 * Répartition d'un lot entre vente, location et stockage.
 *
 * L'API exige que la somme des trois parts couvre EXACTEMENT le lot. Plutôt que
 * de rappeler cette règle à l'utilisateur jusqu'à ce qu'il tombe juste, les
 * écrans ne lui font saisir que la vente et la location : **le stockage est le
 * reste**. La règle devient structurelle — impossible à violer — au lieu d'être
 * un message d'erreur.
 *
 * Le stockage est le bon candidat pour absorber le reste : c'est la seule des
 * trois destinations qui n'exécute rien. Faire absorber le reste par la vente
 * ferait vendre de l'or par arrondi.
 */

export interface DispositionDraft {
  /** Grammes crédités au lot après essai. */
  creditedG: number;
  sellG: number;
  leaseG: number;
}

export type DispositionProblem =
  | 'NOTHING_CREDITED'
  | 'NEGATIVE_SHARE'
  | 'OVER_ALLOCATED'
  | 'LEASE_BELOW_MINIMUM';

export interface DispositionPlan {
  sellG: number;
  leaseG: number;
  /** Ce qui reste après vente et location — jamais négatif. */
  storeG: number;
  valid: boolean;
  problem: DispositionProblem | null;
}

const g = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Calculer la répartition à partir de ce que l'utilisateur a saisi.
 *
 * `leaseMinimumG` n'invalide la répartition que si une location est demandée :
 * ne rien louer est toujours permis, louer trop peu ne l'est pas.
 */
export function planDisposition(
  draft: DispositionDraft,
  options: { leaseMinimumG?: number } = {}
): DispositionPlan {
  const credited = g(draft.creditedG);
  const sellG = g(draft.sellG);
  const leaseG = g(draft.leaseG);
  const minimum = options.leaseMinimumG ?? 0;

  const base = { sellG, leaseG, storeG: 0, valid: false };

  if (!(credited > 0)) return { ...base, problem: 'NOTHING_CREDITED' };
  if (sellG < 0 || leaseG < 0) return { ...base, problem: 'NEGATIVE_SHARE' };

  const allocated = g(sellG + leaseG);
  if (allocated > credited + 0.0005) {
    // Le reste serait négatif : on ne le montre pas comme du stockage, on dit
    // que la répartition dépasse le lot.
    return { ...base, problem: 'OVER_ALLOCATED' };
  }

  if (leaseG > 0 && leaseG < minimum) {
    return { ...base, storeG: g(credited - allocated), problem: 'LEASE_BELOW_MINIMUM' };
  }

  return {
    sellG,
    leaseG,
    storeG: g(credited - allocated),
    valid: true,
    problem: null,
  };
}

/** Produit en XOF d'une vente au cours donné, arrondi au franc. */
export function dispositionProceedsXof(sellG: number, sellPricePerGram: number): number {
  if (!(sellG > 0) || !(sellPricePerGram > 0)) return 0;
  return Math.round(sellG * sellPricePerGram);
}
