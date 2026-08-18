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
 * Une somme de soldes est LEGITIME quand la question porte reellement sur les
 * portefeuilles : une repartition par tranche compte des portefeuilles, pas des
 * jetons emis. Ce qui distingue les deux n'est pas le nom de l'alias — la
 * premiere version de ce controle s'y fiait et a lache des qu'un alias a change
 * — mais la presence d'un `GROUP BY` dans la meme requete.
 */
function sommesNonGroupees(source: string): string[] {
  const trouvees: string[] = [];
  const aiguille = 'SUM(token_balance)';
  let depuis = 0;

  for (;;) {
    const at = source.indexOf(aiguille, depuis);
    if (at === -1) break;
    depuis = at + aiguille.length;

    // La requete autour : large assez pour porter son GROUP BY, assez etroite
    // pour ne pas emprunter celui de la requete suivante.
    const fenetre = source.slice(at, Math.min(source.length, at + 500));
    const finRequete = fenetre.search(/`|'\)|"\)/);
    const requete = finRequete === -1 ? fenetre : fenetre.slice(0, finRequete);

    if (!/GROUP BY/i.test(requete)) {
      trouvees.push(source.slice(Math.max(0, at - 120), at + 80).trim());
    }
  }

  return trouvees;
}

describe('Les jetons emis ne viennent jamais d une somme de portefeuilles', () => {
  for (const fichier of ['state.ts', 'admin.ts', 'market.ts']) {
    it(`${fichier} n interroge les portefeuilles que pour les repartir`, () => {
      // Toute somme de soldes hors repartition confondrait « emis » et « detenu
      // en portefeuille » — l'ecart etant exactement l'or place en location.
      expect(sommesNonGroupees(source(fichier))).toEqual([]);
    });
  }

  it('sait reperer une somme qui ne repartit rien', () => {
    // Sans ce controle du controle, un detecteur casse rendrait zero probleme et
    // les tests ci-dessus passeraient au vert sans rien avoir verifie.
    const faute = "db.prepare('SELECT COALESCE(SUM(token_balance), 0) as total FROM wallets')";

    expect(sommesNonGroupees(faute)).toHaveLength(1);
  });

  it('laisse passer une repartition par tranche', () => {
    const licite = "db.prepare(`SELECT tier, SUM(token_balance) as total FROM wallets GROUP BY tier`)";

    expect(sommesNonGroupees(licite)).toEqual([]);
  });
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

/** Le source prive de ses commentaires — la prose n'est pas du code. */
function sansCommentaires(source: string): string {
  // `String.fromCharCode(10)` plutot que le litteral : ecrit autrement, la
  // sequence d'echappement se fait manger par l'outillage avant d'atteindre le
  // fichier, et la chaine se retrouve coupee en deux lignes.
  const RETOUR = String.fromCharCode(10);
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(RETOUR)
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join(RETOUR);
}

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
    //
    // Le controle porte sur le CODE, pas sur la prose : la premiere version
    // interdisait le mot partout et s'est declenchee sur un commentaire qui
    // expliquait precisement pourquoi `Infinity` est un piege.
    expect(sansCommentaires(source('market.ts'))).not.toMatch(/Infinity/);
  });
});
