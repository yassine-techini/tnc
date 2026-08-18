/**
 * Une accumulation de grammes doit arrondir au milligramme — ADR 013.
 *
 * `token_balance` est un REAL. `token_balance = token_balance + ?` derive :
 * trois achats suffisent pour que le solde stocke tombe SOUS la valeur affichee,
 * et la vente du solde entier est alors refusee pour « solde insuffisant » — sur
 * le solde exact que l'ecran vient de montrer.
 *
 * La regle vit dans le SQL, pas dans une convention : ce controle refuse toute
 * accumulation ecrite sans `ROUND(..., 3)`.
 *
 * DETECTION SANS EXPRESSION REGULIERE. La premiere version construisait sa regex
 * dans une chaine gabarit, ou la limite de mot est en realite l'echappement
 * « backspace » : elle ne trouvait rien et se declarait satisfaite. Le meme piege
 * est documente dans `test/routes/state-payload.test.ts`. Comparer des chaines
 * apres normalisation des espaces n'a pas d'echappement du tout, donc pas de
 * piege — et se lit sans decodage.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Colonnes portant un poids en grammes, a la precision du milligramme. */
export const COLONNES_GRAMMES = ['token_balance', 'tokens_issued', 'gold_on_loan', 'total_allocated'];

/** Reduit toute suite d'espaces, tabulations et retours a la ligne a un espace. */
function normaliser(source) {
  return source.split(/\s+/).join(' ');
}

/**
 * Les accumulations NON arrondies : `col = col + ?` ou `col = col - ?`.
 *
 * `col = ROUND(col + ?, 3)` ne correspond pas, puisque `ROUND(` s'intercale
 * entre le `=` et le nom de colonne.
 */
export function accumulationsNonArrondies(source) {
  const plat = normaliser(source);
  const trouvees = [];

  for (const col of COLONNES_GRAMMES) {
    for (const signe of ['+', '-']) {
      const forme = col + ' = ' + col + ' ' + signe + ' ?';
      let depuis = 0;
      for (;;) {
        const at = plat.indexOf(forme, depuis);
        if (at === -1) break;
        trouvees.push({ colonne: col, extrait: forme });
        depuis = at + forme.length;
      }
    }
  }

  return trouvees;
}

/** Le numero de ligne d'une accumulation, pour que le message soit actionnable. */
function ligneDe(source, colonne, signe) {
  const forme = colonne + ' = ' + colonne + ' ' + signe;
  const lignes = source.split('\n');
  for (let i = 0; i < lignes.length; i++) {
    if (normaliser(lignes[i]).includes(forme)) return i + 1;
    // La requete peut etre repartie sur plusieurs lignes : on retombe alors sur
    // celle qui porte l'affectation.
    if (normaliser(lignes[i]).includes(colonne + ' = ' + colonne)) return i + 1;
  }
  return 0;
}

function fichiersSource(racine) {
  const out = [];
  for (const e of readdirSync(racine, { withFileTypes: true })) {
    const p = join(racine, e.name);
    if (e.isDirectory()) out.push(...fichiersSource(p));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

export function verifierLeDepot(racine = 'src') {
  const problemes = [];
  for (const fichier of fichiersSource(racine)) {
    const source = readFileSync(fichier, 'utf8');
    for (const p of accumulationsNonArrondies(source)) {
      const signe = p.extrait.includes(' + ?') ? '+' : '-';
      problemes.push({ ...p, fichier, ligne: ligneDe(source, p.colonne, signe) });
    }
  }
  return problemes;
}

// Execute directement (`node scripts/check-gram-rounding.mjs`), pas a l'import.
if (process.argv[1] && process.argv[1].endsWith('check-gram-rounding.mjs')) {
  const problemes = verifierLeDepot();
  if (problemes.length) {
    console.error('Accumulation de grammes sans arrondi au milligramme (ADR 013) :\n');
    for (const p of problemes) {
      console.error('  ' + p.fichier + ':' + p.ligne + '  ' + p.extrait);
      console.error('    attendu : ' + p.colonne + ' = ROUND(' + p.colonne + ' +/- ?, 3)\n');
    }
    process.exit(1);
  }
  console.log('Colonnes suivies : ' + COLONNES_GRAMMES.join(', ') + '.');
  console.log('Toutes les accumulations de grammes arrondissent au milligramme.');
}
