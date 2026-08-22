/**
 * Ce que la validation dit, dans les deux langues — ADR 027.
 *
 * Le point delicat est le partage des roles : ce qui se deduit du probleme est
 * ENGENDRE, ce qui ne s'en deduit pas est une CLE. Ces tests verifient les deux
 * cotes, et surtout qu'un `.regex(/[A-Z]/)` et un `.regex(/[0-9]/)` — meme code
 * de probleme, meme forme — ne disent pas la meme chose.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  REGLES_VALIDATION,
  estRegleConnue,
  traduireProbleme,
  carteErreursZod,
  langueValidation,
} from './messages';
import { passwordSchema, phoneSchema, registerSchema } from './index';

const problemes = (schema: z.ZodTypeAny, valeur: unknown) => {
  const r = schema.safeParse(valeur);
  return r.success ? [] : r.error.issues;
};

describe('Catalogue des regles', () => {
  it('porte les deux langues, et ne les confond pas', () => {
    for (const [cle, entree] of Object.entries(REGLES_VALIDATION)) {
      expect(entree.fr, `${cle}.fr`).toBeTruthy();
      expect(entree.en, `${cle}.en`).toBeTruthy();
      expect(entree.fr, cle).not.toBe(entree.en);
    }
  });

  it('reconnait ses cles, et seulement les siennes', () => {
    expect(estRegleConnue('MDP_MAJUSCULE')).toBe(true);
    expect(estRegleConnue('Le mot de passe doit contenir une majuscule')).toBe(false);
  });
});

describe('Les schemas ne portent plus de prose', () => {
  it('rend une cle, pas une phrase, pour une regle de mot de passe', () => {
    // C'est le contrat : le schema nomme la regle, la traduction la met en mots.
    const messages = problemes(passwordSchema, 'motdepassesansrien').map((p) => p.message);
    expect(messages).toContain('MDP_MAJUSCULE');
    expect(messages).toContain('MDP_CHIFFRE');
    expect(messages).toContain('MDP_SPECIAL');
  });

  it('distingue deux regex que Zod decrit de facon identique', () => {
    // `.regex(/[A-Z]/)` et `.regex(/[0-9]/)` produisent tous deux
    // `invalid_string`. Sans cle, les deux auraient dit « format invalide ».
    const sansMajuscule = traduireProbleme(
      { code: 'invalid_string', message: 'MDP_MAJUSCULE', path: ['password'] },
      'fr'
    );
    const sansChiffre = traduireProbleme(
      { code: 'invalid_string', message: 'MDP_CHIFFRE', path: ['password'] },
      'fr'
    );
    expect(sansMajuscule).not.toBe(sansChiffre);
    expect(sansMajuscule).toContain('majuscule');
    expect(sansChiffre).toContain('chiffre');
  });
});

describe('Mise en mots', () => {
  it('nomme le champ, puis la regle', () => {
    const fr = traduireProbleme(
      { code: 'invalid_string', message: 'MDP_MAJUSCULE', path: ['password'] },
      'fr'
    );
    const en = traduireProbleme(
      { code: 'invalid_string', message: 'MDP_MAJUSCULE', path: ['password'] },
      'en'
    );
    expect(fr).toBe('Mot de passe : Au moins une majuscule');
    expect(en).toBe('Password : At least one uppercase letter');
  });

  it('se passe de prefixe pour un champ inconnu du catalogue', () => {
    const sansNom = traduireProbleme(
      { code: 'invalid_string', message: 'MDP_MAJUSCULE', path: ['champInconnu'] },
      'fr'
    );
    // Mieux vaut pas de prefixe qu'un nom technique montre au lecteur.
    expect(sansNom).toBe('Au moins une majuscule');
  });

  it('engendre ce qui se deduit du probleme, sans qu on l ait ecrit', () => {
    const trop = problemes(z.object({ password: z.string().min(12) }), { password: 'court' });
    expect(traduireProbleme(trop[0], 'fr')).toBe('Mot de passe : 12 caracteres au minimum');
    expect(traduireProbleme(trop[0], 'en')).toBe('Password : At least 12 characters');
  });

  it('dit « requis » plutot que « trop court » pour un champ absent', () => {
    const absent = problemes(z.object({ email: z.string().email() }), {});
    expect(traduireProbleme(absent[0], 'fr')).toBe('Adresse e-mail : Ce champ est requis');
    expect(traduireProbleme(absent[0], 'en')).toBe('Email address : This field is required');
  });

  it('ne renomme pas le champ dans la phrase', () => {
    // « Adresse e-mail : adresse e-mail invalide » etait le resultat de la
    // premiere version.
    const invalide = problemes(z.object({ email: z.string().email() }), { email: 'pasunemail' });
    const fr = traduireProbleme(invalide[0], 'fr');
    expect(fr).toBe('Adresse e-mail : Adresse invalide');
    expect(fr.toLowerCase().split('adresse').length - 1).toBe(2);
  });

  it('liste les valeurs acceptees d une enumeration', () => {
    const hors = problemes(z.object({ code: z.enum(['A', 'B']) }), { code: 'Z' });
    expect(traduireProbleme(hors[0], 'fr')).toContain('A, B');
    expect(traduireProbleme(hors[0], 'en')).toContain('A, B');
  });
});

describe('Carte d erreurs Zod', () => {
  it('traduit a l analyse, pour qui lit le message de Zod directement', () => {
    // C'est le chemin des clients qui valident en local : ils n'ont pas de
    // reponse d'API a traduire.
    const r = registerSchema.safeParse(
      { email: 'x', phone: '123', password: 'court', country: 'BF' },
      { errorMap: carteErreursZod('en') }
    );
    expect(r.success).toBe(false);
    if (!r.success) {
      const messages = r.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('Invalid address'))).toBe(true);
      // Les cles, elles, passent au travers : c'est le rendu qui les traduit.
      expect(messages.some((m) => m === 'TELEPHONE_INTERNATIONAL' || m.includes('At least'))).toBe(
        true
      );
    }
  });

  it('deduit la langue d une locale', () => {
    expect(langueValidation('en-UG')).toBe('en');
    expect(langueValidation('fr-BF')).toBe('fr');
    expect(langueValidation(undefined)).toBe('fr');
    expect(langueValidation('de-DE')).toBe('fr');
  });
});

describe('Le telephone reste une seule regle', () => {
  it('accepte un numero international et refuse le reste', () => {
    expect(phoneSchema.safeParse('+22670000000').success).toBe(true);
    expect(phoneSchema.safeParse('+256700000000').success).toBe(true);
    expect(phoneSchema.safeParse('abc').success).toBe(false);
  });
});
