/**
 * Une echeance s'ecrit avec l'horloge de la base — ADR 017.
 *
 * Deux formats de date coexistaient : celui de JavaScript
 * (`new Date().toISOString()` → « 2026-08-18T10:08:06.589Z ») et celui de SQLite
 * (`datetime('now')` → « 2026-08-18 10:08:06 »). Les colonnes sont comparees
 * COMME DES CHAINES : au rang 11, `T` (0x54) l'emporte sur l'espace (0x20).
 *
 * Consequences mesurees : un devis expire depuis une heure restait consommable,
 * et une suspension survivait a son terme jusqu'a minuit UTC.
 *
 * Ce controle refuse qu'une colonne d'echeance soit alimentee depuis JavaScript.
 * Il ne se prononce PAS sur `created_at` / `updated_at`, qui prennent le defaut
 * de la colonne et ne sont jamais compares a une horloge.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Colonnes comparees a `datetime('now')` quelque part dans le depot. Ce sont les
 * seules ou le format compte.
 */
export const COLONNES_ECHEANCE = [
  'expires_at',
  'suspended_until',
  'locked_until',
  'tokens_invalid_before',
  'settles_on',
  'due_at',
];

/** Vrai quand la position tombe dans un commentaire de ligne. */
function dansUnCommentaire(source, position) {
  const RETOUR = String.fromCharCode(10);
  const debutLigne = source.lastIndexOf(RETOUR, position) + 1;
  const avant = source.slice(debutLigne, position);
  return avant.includes('//') || /^\s*\*/.test(avant);
}

/**
 * Les ecritures suspectes : une colonne d'echeance dont la valeur liee vient
 * d'un `toISOString()` proche.
 *
 * On reste volontairement simple — on cherche `toISOString` dans la meme
 * instruction que la colonne. Un controle plus fin demanderait un analyseur ;
 * celui-ci suffit a arreter la forme qui a cause les deux defauts.
 */
export function ecrituresSuspectes(source, fichier = '?') {
  const suspectes = [];

  for (const colonne of COLONNES_ECHEANCE) {
    let depuis = 0;
    for (;;) {
      const at = source.indexOf(colonne, depuis);
      if (at === -1) break;
      depuis = at + colonne.length;
      if (dansUnCommentaire(source, at)) continue;

      // Une ECRITURE : la colonne apparait dans un INSERT ou un SET.
      const avant = source.slice(Math.max(0, at - 400), at);
      const estEcriture = /INSERT INTO|SET\s|VALUES/i.test(avant);
      if (!estEcriture) continue;

      // La valeur liee dans la meme instruction.
      const fenetre = source.slice(at, Math.min(source.length, at + 700));
      if (/toISOString\(\)/.test(fenetre) && !dansUnCommentaire(source, at)) {
        suspectes.push({
          colonne,
          fichier,
          ligne: source.slice(0, at).split(String.fromCharCode(10)).length,
        });
      }
    }
  }

  return suspectes;
}

function fichiersSource(racine) {
  const out = [];
  for (const e of readdirSync(racine, { withFileTypes: true })) {
    const p = join(racine, e.name);
    if (e.isDirectory()) out.push(...fichiersSource(p));
    else if (e.name.endsWith('.ts') && !e.name.includes('.test.')) out.push(p);
  }
  return out;
}

export function verifierLeDepot(racine = 'src') {
  const problemes = [];
  for (const f of fichiersSource(racine)) {
    problemes.push(...ecrituresSuspectes(readFileSync(f, 'utf8'), f));
  }
  return problemes;
}

if (process.argv[1] && process.argv[1].endsWith('check-date-columns.mjs')) {
  const problemes = verifierLeDepot();
  if (problemes.length) {
    console.error("Echeance ecrite depuis JavaScript (ADR 017) :\n");
    for (const p of problemes) {
      console.error(`  ${p.fichier}:${p.ligne}  ${p.colonne}`);
      console.error(`    attendu : datetime('now', '+' || ? || ' minutes') — l horloge de la base\n`);
    }
    process.exit(1);
  }
  console.log(`Colonnes d echeance suivies : ${COLONNES_ECHEANCE.join(', ')}.`);
  console.log("Toutes sont ecrites par l horloge de la base.");
}
