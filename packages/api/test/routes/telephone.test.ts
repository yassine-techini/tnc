import { describe, expect, it } from 'vitest';
import { phoneSchema } from '@tnc-trading/shared/validators';

/**
 * Le numero de telephone — ADR 021, constat AM.
 *
 * L'inscription acceptait `/^\+?[0-9]{10,15}$/`, la mise a jour du profil
 * imposait `/^\+226\d{8}$/`. Un raffineur ougandais s'inscrivait donc sans peine,
 * puis ne pouvait plus jamais corriger son numero — deux regles pour un meme
 * champ, dont la plus stricte au mauvais bout.
 */

const accepte = (n: string) => phoneSchema.safeParse(n).success;

describe('Un numero de chaque pays servi passe', () => {
  const numeros = {
    'Burkina Faso': '+22670123456',
    'Côte d’Ivoire': '+2250701234567',
    Mali: '+22370123456',
    Sénégal: '+221701234567',
    Ouganda: '+256701234567',
    Ghana: '+233201234567',
    Kenya: '+254712345678',
  };

  for (const [pays, numero] of Object.entries(numeros)) {
    it(`${pays} : ${numero}`, () => {
      expect(accepte(numero), `${pays} doit pouvoir enregistrer son numero`).toBe(true);
    });
  }
});

describe('Une seule regle, aux deux bouts', () => {
  it('accepte encore ce que l inscription acceptait', () => {
    // La generalisation ne doit rien retirer a ceux qui pouvaient deja
    // s'inscrire.
    for (const n of ['+22670123456', '22670123456', '+256701234567']) {
      expect(accepte(n), n).toBe(true);
    }
  });

  it('refuse toujours ce qui n est pas un numero', () => {
    for (const n of ['', '12345', 'abcdefghij', '+226 70 12 34 56', '+226-70123456']) {
      expect(accepte(n), n).toBe(false);
    }
  });

  it('n impose pas l indicatif d un pays particulier', () => {
    // Le telephone sert au code a usage unique, qui fonctionne partout. Le
    // paiement mobile exige bien un numero local, mais c'est au retrait de le
    // dire, au moment ou la methode est choisie — pas ici, ou refuser bloquerait
    // un titulaire de la diaspora sur toutes ses operations.
    expect(accepte('+33612345678')).toBe(true);
  });
});
