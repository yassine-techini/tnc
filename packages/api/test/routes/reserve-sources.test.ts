import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * D'ou viennent les chiffres de la reserve — ADR 012.
 *
 * Cinq routes du portail Etat et deux routes d'administration derivaient
 * « jetons emis » de `SUM(wallets.token_balance)`. La location sortant les
 * grammes du portefeuille, cette somme vaut `tokens_issued - gold_on_loan` : le
 * ministere lisait 500 g emis au lieu de 900, 500 g disponibles au lieu de 100,
 * et une couverture de 200 % au lieu de 111 %.
 *
 * Le test existant (`state-payload.test.ts`) epingle les NOMS des champs — il est
 * ne de la confusion `coverage` / `coverageRatio` qui affichait 0 %. Il ne dit
 * rien de ce que le chiffre CONTIENT. Ces tests-ci gardent la source.
 */

function source(fichier: string): string {
  return readFileSync(new URL(`../../src/routes/${fichier}`, import.meta.url), 'utf8');
}

/**
 * Les sommes de portefeuilles legitimes : celles qui repondent a une question
 * portant reellement sur les portefeuilles. Une repartition par tranche compte
 * des portefeuilles, pas des jetons emis.
 */
const REPARTITIONS_LEGITIMES = /COALESCE\(SUM\(token_balance\), 0\) as total(_tokens)?\s*\n\s*FROM wallets\s*\n\s*GROUP BY/g;

describe('Les jetons emis ne viennent jamais d une somme de portefeuilles', () => {
  for (const fichier of ['state.ts', 'admin.ts', 'market.ts']) {
    it(`${fichier} n interroge les portefeuilles que pour les repartir`, () => {
      const s = source(fichier).replace(REPARTITIONS_LEGITIMES, '');

      // Ce qui reste ne doit plus contenir aucune somme de soldes : toute autre
      // utilisation confondrait « emis » et « detenu en portefeuille ».
      expect(s).not.toMatch(/SUM\(token_balance\)/);
      expect(s).not.toMatch(/SUM\(w\.token_balance\)/);
    });
  }
});

describe('Les routes ne recalculent plus l arithmetique de la reserve', () => {
  for (const fichier of ['state.ts', 'admin.ts', 'market.ts']) {
    it(`${fichier} passe par chiffresReserve`, () => {
      expect(source(fichier)).toMatch(/chiffresReserve\(/);
    });

    it(`${fichier} ne divise plus l alloue par autre chose a la main`, () => {
      // `total_allocated / (…)` etait la forme exacte des quatre definitions
      // divergentes de la couverture.
      expect(source(fichier)).not.toMatch(/total_allocated\s*\/\s*\(/);
    });
  }
});

describe('Le vocabulaire', () => {
  it('n emploie plus `coverage` tout court dans une charge utile', () => {
    // Deux contrats portaient un champ `coverage` de sens RECIPROQUE : ratio
    // cote public, taux d'utilisation cote administration. Le back-office
    // testait `coverage >= 1` sur le second.
    for (const fichier of ['state.ts', 'admin.ts', 'market.ts']) {
      expect(/\bcoverage:/.test(source(fichier)), fichier).toBe(false);
    }
  });

  it('n emploie plus `Infinity` comme couverture', () => {
    // `JSON.stringify(Infinity)` vaut `null` : le contrat annoncait `number` et
    // la route livrait `null`, sur le chemin le plus public de la plateforme.
    expect(source('market.ts')).not.toMatch(/Infinity/);
  });
});
