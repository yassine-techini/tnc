/**
 * L'argent connait sa devise — ADR 019.
 *
 * `wallets.cash_balance`, `transactions.cash_amount`, `fees` : rien ne portait de
 * devise. L'unite vivait dans un commentaire du schema — « Total XOF depenses ».
 * Et `gold_prices` ne stockait qu'une conversion, si bien qu'un utilisateur
 * ougandais aurait recu un prix en francs CFA presente comme le sien.
 *
 * Ce module porte les deux regles qui manquaient : convertir depuis la reference
 * en dollars vers la devise demandee, et arrondir selon les decimales de CETTE
 * devise.
 */

import type { D1Database } from '@cloudflare/workers-types';

/**
 * Fragment SQL rendant les decimales de la devise d'un portefeuille.
 *
 * Les decimales sont une propriete de la DEVISE (norme ISO 4217), pas du pays :
 * les cinq pays de l'UEMOA partagent le XOF et ses zero decimales. `MIN` rend
 * donc le resultat deterministe quand plusieurs pays declarent la meme devise.
 *
 * Le fragment voyage avec la ligne qui en a besoin, plutot qu'une requete par
 * calcul : le travail de rendement parcourt les positions une a une, et chacune
 * peut appartenir a une devise differente.
 */
export const DECIMALES_DU_PORTEFEUILLE = `COALESCE(
  (SELECT MIN(cc.currency_decimals) FROM country_config cc WHERE cc.currency = w.currency), 0
)`;

/** Un prix du gramme, dans une devise nommee. */
export interface PrixDuGramme {
  devise: string;
  /** Cours au comptant, converti depuis la reference en dollars. */
  spot: number;
  achat: number;
  vente: number;
  /** Taux retenu, pour que le chiffre soit refaisable. */
  tauxParUsd: number;
  /** Horodatage du relevé de prix utilisé. */
  releveLe: string;
}

/**
 * Arrondit un montant selon les decimales de sa devise.
 *
 * Quatre services portaient la meme ligne, `const xof = (n) => Math.round(n)` :
 * juste pour le XOF et l'UGX, qui n'ont pas de sous-unite, faux pour le cedi, le
 * shilling kenyan, le naira ou le rand, qui en ont deux — chaque frais et chaque
 * rendement y aurait perdu ses centimes, toujours dans le meme sens (constat AL).
 */
export function arrondirMonnaie(montant: number, decimales: number): number {
  if (!Number.isFinite(montant)) return 0;
  // `decimales` vient de la configuration : on ne lui fait pas confiance
  // aveuglement, une valeur absurde produirait un arrondi absurde.
  const d = Number.isInteger(decimales) && decimales >= 0 && decimales <= 4 ? decimales : 0;
  const facteur = 10 ** d;
  return Math.round(montant * facteur) / facteur;
}

/** Le dernier taux connu pour une devise, ou `null`. */
export async function tauxDuJour(db: D1Database, devise: string): Promise<{ rate: number; at: string } | null> {
  const ligne = await db
    .prepare(
      `SELECT rate_per_usd, timestamp FROM exchange_rates
       WHERE currency = ? ORDER BY timestamp DESC LIMIT 1`
    )
    .bind(devise)
    .first<{ rate_per_usd: number; timestamp: string }>();

  return ligne && ligne.rate_per_usd > 0 ? { rate: ligne.rate_per_usd, at: ligne.timestamp } : null;
}

/**
 * Le prix du gramme dans une devise donnee.
 *
 * ECHOUE FERME : sans taux pour cette devise, on rend `null` plutot que de
 * servir le prix d'un autre pays. Servir des francs CFA a un Ougandais parce que
 * le sien manque serait pire que de ne rien servir — le chiffre aurait l'air
 * juste.
 */
export async function prixDuGramme(
  db: D1Database,
  devise: string,
  spreads: { achat: number; vente: number },
  decimales = 0
): Promise<PrixDuGramme | null> {
  const releve = await db
    .prepare('SELECT price_usd, timestamp FROM gold_prices ORDER BY timestamp DESC LIMIT 1')
    .bind()
    .first<{ price_usd: number; timestamp: string }>();

  if (!releve || !(releve.price_usd > 0)) return null;

  const taux = await tauxDuJour(db, devise);
  if (!taux) return null;

  const spot = releve.price_usd * taux.rate;

  return {
    devise,
    spot: arrondirMonnaie(spot, decimales),
    achat: arrondirMonnaie(spot * (1 + spreads.achat), decimales),
    vente: arrondirMonnaie(spot * (1 - spreads.vente), decimales),
    tauxParUsd: taux.rate,
    releveLe: releve.timestamp,
  };
}

/**
 * Verifie qu'un mouvement se fait dans la devise du portefeuille.
 *
 * L'invariant qui remplace dix-neuf colonnes : un portefeuille a UNE devise, et
 * tout ce qui s'y regle la partage. Sans ce controle, la dimension ajoutee ne
 * serait qu'une etiquette.
 */
export function memeDevise(devisePortefeuille: string, deviseMouvement: string): boolean {
  return devisePortefeuille === deviseMouvement;
}
