import { describe, expect, it } from 'vitest';
import { planchierXof } from '../../src/routes/market';

/**
 * Le plancher d'un ordre exprime en XOF — constat W du huitieme audit.
 *
 * `tokenAmount` est TRONQUE au milligramme. `MIN_XOF = 100` ne garantissait donc
 * une quantite non nulle que tant que le gramme valait moins de 100 000 XOF : la
 * constante encodait une hypothese sur le prix de l'or sans la nommer, et
 * l'echeance etait un doublement du cours.
 *
 * Au-dela, `tokenAmount` valait `0` et rien sur le chemin d'execution ne refusait
 * un devis a zero : ni `canPurchase(0)`, ni `generateQuote`, ni `/market/buy`.
 */

const COURS_ACTUEL = 53_000; // XOF/g, ordre de grandeur du marche

describe('Le plancher se deduit du cours', () => {
  it('reste au minimum de bon sens tant que le cours est bas', () => {
    // 0.001 g a 53 000 XOF/g = 53 XOF, sous le plancher absolu de 100.
    expect(planchierXof(COURS_ACTUEL)).toBe(100);
  });

  it('monte des qu un milligramme coute plus que ce minimum', () => {
    // A 150 000 XOF/g, un milligramme vaut 150 XOF : 100 XOF n'achetent plus
    // rien, et c'est exactement le cas que l'ancienne constante laissait passer.
    expect(planchierXof(150_000)).toBe(150);
  });

  it('arrondit au XOF SUPERIEUR', () => {
    // A 120 500 XOF/g, un milligramme vaut 120,5 XOF. Arrondir vers le bas
    // annoncerait 120 XOF a l'utilisateur — un montant que le controle
    // refuserait ensuite.
    expect(planchierXof(120_500)).toBe(121);
  });

  it('achete bien au moins un milligramme, a tout cours', () => {
    for (const cours of [1_000, 53_000, 100_000, 150_000, 1_000_000, 12_345_678]) {
      const plancher = planchierXof(cours);
      const grammes = Math.floor((plancher / cours) * 1000) / 1000;

      expect(grammes, `cours ${cours}`).toBeGreaterThanOrEqual(0.001);
    }
  });

  it('retombe sur le plancher absolu quand le cours est inutilisable', () => {
    // Un plancher INFINI fermerait le marche a tout le monde. `Infinity > 0`
    // etant vrai, un simple controle de signe laissait passer ce cas.
    for (const cours of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(planchierXof(cours as number), String(cours)).toBe(100);
    }
  });
});
