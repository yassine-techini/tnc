import { describe, it, expect } from 'vitest';
import { planDisposition, dispositionProceedsXof } from './disposition.js';

const credited = 910;

describe('planDisposition', () => {
  it('met le reste en stockage', () => {
    expect(planDisposition({ creditedG: credited, sellG: 300, leaseG: 400 })).toEqual({
      sellG: 300,
      leaseG: 400,
      storeG: 210,
      valid: true,
      problem: null,
    });
  });

  it('couvre toujours exactement le lot, quelle que soit la saisie', () => {
    // C'est tout l'intérêt : la règle de l'API devient impossible à violer.
    for (const [sellG, leaseG] of [
      [0, 0],
      [910, 0],
      [0, 910],
      [455, 455],
      [1, 2],
    ]) {
      const plan = planDisposition({ creditedG: credited, sellG, leaseG });
      expect(plan.valid, `${sellG}/${leaseG}`).toBe(true);
      expect(plan.sellG + plan.leaseG + plan.storeG).toBeCloseTo(credited, 3);
    }
  });

  it('met tout en stockage quand rien n’est saisi', () => {
    expect(planDisposition({ creditedG: credited, sellG: 0, leaseG: 0 })).toMatchObject({
      storeG: 910,
      valid: true,
    });
  });

  it('refuse de dépasser le lot au lieu d’afficher un reste négatif', () => {
    expect(planDisposition({ creditedG: credited, sellG: 600, leaseG: 400 })).toMatchObject({
      valid: false,
      problem: 'OVER_ALLOCATED',
    });
  });

  it('accepte de tout allouer au gramme près', () => {
    expect(planDisposition({ creditedG: credited, sellG: 909.999, leaseG: 0.001 })).toMatchObject({
      storeG: 0,
      valid: true,
    });
  });

  it('refuse une part négative', () => {
    expect(planDisposition({ creditedG: credited, sellG: -100, leaseG: 500 })).toMatchObject({
      valid: false,
      problem: 'NEGATIVE_SHARE',
    });
  });

  it('refuse une location sous le minimum, mais pas une location nulle', () => {
    // Ne rien louer est toujours permis ; louer trop peu ne l'est pas.
    expect(
      planDisposition({ creditedG: credited, sellG: 0, leaseG: 0.5 }, { leaseMinimumG: 1 })
    ).toMatchObject({ valid: false, problem: 'LEASE_BELOW_MINIMUM' });

    expect(
      planDisposition({ creditedG: credited, sellG: 0, leaseG: 0 }, { leaseMinimumG: 1 }).valid
    ).toBe(true);
  });

  it('montre quand même le reste sur une location trop faible', () => {
    // L'utilisateur doit voir ce qui se passerait s'il corrigeait, pas un écran
    // vide qui lui cache l'effet de sa saisie.
    const plan = planDisposition(
      { creditedG: credited, sellG: 300, leaseG: 0.5 },
      { leaseMinimumG: 1 }
    );
    expect(plan.storeG).toBe(609.5);
  });

  it('refuse de répartir un lot sans rien de crédité', () => {
    expect(planDisposition({ creditedG: 0, sellG: 0, leaseG: 0 })).toMatchObject({
      valid: false,
      problem: 'NOTHING_CREDITED',
    });
  });

  it('arrondit au milligramme, l’unité de compte de la plateforme', () => {
    const plan = planDisposition({ creditedG: 910, sellG: 303.3333, leaseG: 303.3333 });
    expect(plan.sellG).toBe(303.333);
    expect(plan.storeG).toBe(303.334);
  });
});

describe('dispositionProceedsXof', () => {
  it('est le produit du poids par le cours, au franc', () => {
    expect(dispositionProceedsXof(300, 53_000)).toBe(15_900_000);
  });

  it('vaut zéro sans poids ou sans cours — plutôt que NaN', () => {
    expect(dispositionProceedsXof(0, 53_000)).toBe(0);
    expect(dispositionProceedsXof(300, 0)).toBe(0);
  });
});
