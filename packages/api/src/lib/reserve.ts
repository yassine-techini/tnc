/**
 * L'arithmetique de la reserve, a un seul endroit — ADR 012.
 *
 * Cinq routes du portail Etat et deux routes d'administration derivaient
 * « jetons emis » de `SUM(wallets.token_balance)`. Ce n'est pas la meme chose :
 * la location SORT les grammes du portefeuille et alimente `gold_on_loan` sans
 * toucher `tokens_issued`. Le jeton existe toujours, il est seulement prete.
 *
 * La somme des portefeuilles vaut donc `tokens_issued - gold_on_loan`, et le
 * portail l'affichait sous l'etiquette « Tokens Emis » — en surevaluant la
 * couverture de tout l'or en location, dans le sens flatteur.
 *
 * Les routes ne recalculent plus : elles lisent ce module.
 */

/** Les seules colonnes dont depend le calcul. */
export interface StockBrut {
  total_allocated: number;
  tokens_issued: number;
  gold_on_loan: number | null;
}

export interface ChiffresReserve {
  /** Or alloue par l'Etat. */
  alloueG: number;
  /** Jetons emis — `tokens_issued`, JAMAIS une somme de portefeuilles. */
  emisG: number;
  /** Or prete, donc absent du coffre. */
  preteG: number;
  /** Or physiquement en coffre : alloue moins prete. */
  enCoffreG: number;
  /** Encore emettable. Meme valeur que la colonne generee `available_stock`. */
  disponibleG: number;
  /**
   * `alloue / emis` — >= 1 est sain.
   *
   * `null` quand rien n'est emis : le ratio est alors sans objet, et non « zero ».
   * `Infinity` etait renvoye auparavant, que `JSON.stringify` transforme en
   * `null` — le contrat annoncait `number` et la route livrait `null`.
   */
  couverture: number | null;
  /** `emis / alloue` — <= 1. L'INVERSE de la couverture, d'ou un nom distinct. */
  utilisation: number | null;
  /** `tokens_issued <= total_allocated`. La base le garantit deja par CHECK. */
  invariantTenu: boolean;
  /**
   * `tokens_issued <= en coffre` — la definition de l'attestation SIGNEE.
   *
   * Le tableau de bord repondait « aucun gramme prete » a la meme question, si
   * bien qu'avec 1000 g alloues, 900 g emis et 50 g pretes l'attestation disait
   * oui et le portail affichait l'alerte rouge. « Rien n'est prete » reste
   * lisible dans `preteG`, qui est divulgue.
   */
  entierementEnCoffre: boolean;
}

/** Arrondit au milligramme : la precision d'un jeton. */
const g = (n: number) => Math.round(n * 1000) / 1000;

export function chiffresReserve(stock: StockBrut | null | undefined): ChiffresReserve {
  const alloueG = g(stock?.total_allocated || 0);
  const emisG = g(stock?.tokens_issued || 0);
  const preteG = g(stock?.gold_on_loan || 0);

  // `Math.max(0, …)` : une allocation reduite sous l'or deja prete rendrait un
  // coffre negatif, qui n'a pas de sens a afficher.
  const enCoffreG = Math.max(0, g(alloueG - preteG));

  return {
    alloueG,
    emisG,
    preteG,
    enCoffreG,
    disponibleG: g(alloueG - emisG),
    couverture: emisG > 0 ? Math.round((alloueG / emisG) * 100) / 100 : null,
    utilisation: alloueG > 0 ? Math.round((emisG / alloueG) * 10000) / 10000 : null,
    invariantTenu: emisG <= alloueG,
    entierementEnCoffre: emisG <= enCoffreG,
  };
}
