import { describe, expect, it } from 'vitest';
import {
  buyFormSchema,
  depositFormSchema,
  validateForm,
  withdrawFormSchema,
} from './validation';

/**
 * Cette validation s'execute AVANT l'appel reseau. Elle ne remplace pas celle
 * du serveur — elle evite d'envoyer une saisie manifestement fausse et rend
 * l'erreur lisible sur le champ concerne. Ce qui est verifie ici : que les
 * bornes soient les bonnes, et que le message revienne bien sur le bon champ.
 */

const DEPOT_VALIDE = {
  amount: 50_000,
  paymentMethod: 'orange_money' as const,
  phoneNumber: '+22670123456',
};

describe('Depot — bornes de montant', () => {
  it('accepte un montant courant', () => {
    expect(validateForm(depositFormSchema, DEPOT_VALIDE).success).toBe(true);
  });

  it('accepte exactement les bornes', () => {
    expect(validateForm(depositFormSchema, { ...DEPOT_VALIDE, amount: 1000 }).success).toBe(true);
    expect(validateForm(depositFormSchema, { ...DEPOT_VALIDE, amount: 5_000_000 }).success).toBe(
      true
    );
  });

  it('refuse en dessous du minimum', () => {
    const result = validateForm(depositFormSchema, { ...DEPOT_VALIDE, amount: 999 });

    expect(result.success).toBe(false);
    expect(result.errors.amount).toContain('1 000');
  });

  it('refuse au dessus du maximum', () => {
    const result = validateForm(depositFormSchema, { ...DEPOT_VALIDE, amount: 5_000_001 });

    expect(result.success).toBe(false);
    expect(result.errors.amount).toContain('5 000 000');
  });
});

describe('Depot — moyen de paiement et telephone', () => {
  it('refuse un operateur inconnu', () => {
    const result = validateForm(depositFormSchema, {
      ...DEPOT_VALIDE,
      paymentMethod: 'wave',
    });

    expect(result.success).toBe(false);
    expect(result.errors.paymentMethod).toBeTruthy();
  });

  it('refuse un numero sans indicatif', () => {
    const result = validateForm(depositFormSchema, {
      ...DEPOT_VALIDE,
      phoneNumber: '70123456',
    });

    expect(result.success).toBe(false);
    expect(result.errors.phoneNumber).toBeTruthy();
  });
});

describe('Retrait — memes bornes que le depot', () => {
  it('refuse un montant sous le minimum', () => {
    expect(validateForm(withdrawFormSchema, { ...DEPOT_VALIDE, amount: 500 }).success).toBe(false);
  });
});

describe('Achat — un montant doit etre strictement positif', () => {
  it('refuse zero', () => {
    // Zero passerait un simple `>= 0` et declencherait un ordre vide chez le
    // fournisseur de paiement.
    const result = validateForm(buyFormSchema, { amount: 0, amountType: 'grams' });

    expect(result.success).toBe(false);
    expect(result.errors.amount).toBeTruthy();
  });

  it('refuse un montant negatif', () => {
    expect(validateForm(buyFormSchema, { amount: -10, amountType: 'xof' }).success).toBe(false);
  });

  it('refuse une unite inconnue', () => {
    expect(validateForm(buyFormSchema, { amount: 5, amountType: 'onces' }).success).toBe(false);
  });
});

describe('validateForm — forme du resultat', () => {
  it('rend les donnees typees quand tout est valide', () => {
    const result = validateForm(depositFormSchema, DEPOT_VALIDE);

    expect(result.data).toMatchObject({ amount: 50_000, paymentMethod: 'orange_money' });
    expect(result.errors).toEqual({});
  });

  it('associe chaque message a son champ', () => {
    const result = validateForm(depositFormSchema, {
      amount: 10,
      paymentMethod: 'inconnu',
      phoneNumber: 'abc',
    });

    // Un formulaire affiche l'erreur SOUS le champ fautif : une liste de
    // messages sans clef obligerait a deviner lequel va ou.
    expect(Object.keys(result.errors).sort()).toEqual([
      'amount',
      'paymentMethod',
      'phoneNumber',
    ]);
    expect(result.firstError).toBeTruthy();
  });

  it('garde le premier message pour un resume', () => {
    const result = validateForm(buyFormSchema, { amount: 0, amountType: 'grams' });

    expect(result.firstError).toBe(result.errors.amount);
  });
});
