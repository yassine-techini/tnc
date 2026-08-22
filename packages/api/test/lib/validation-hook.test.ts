/**
 * Une erreur de validation est une erreur comme les autres — ADR 026.
 *
 * Ce qui est verifie ici est precisement ce que `@hono/zod-validator` ne faisait
 * pas : rendre la forme `ApiError` de la plateforme. Sans hook, il repond
 * `c.json(result, 400)` — le ZodError brut, ou `error.code`, `error.message` et
 * `requestId` valent tous `undefined`.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { surErreurDeValidation } from '../../src/lib/validation-hook';

/** Un contexte reduit a ce que le hook consulte. */
function contexte(acceptLanguage?: string, requestId?: string) {
  const entetes: Record<string, string | undefined> = {
    'Accept-Language': acceptLanguage,
    'X-Request-ID': requestId,
  };
  return {
    req: { header: (nom: string) => entetes[nom] },
    json: (corps: unknown, statut: number) => ({ corps, statut }),
  } as never;
}

const schema = z.object({
  email: z.string().email('Adresse invalide'),
  montant: z.number().min(1000, 'Montant minimum : 1000 XOF'),
});

const echec = () => schema.safeParse({ email: 'pasunemail', montant: 5 }) as never;

describe('Hook de validation', () => {
  it('laisse passer un corps valide', () => {
    const ok = schema.safeParse({ email: 'a@b.co', montant: 5000 }) as never;
    expect(surErreurDeValidation(ok, contexte())).toBeUndefined();
  });

  it('rend la forme ApiError, la ou Zod rendait son propre objet', () => {
    const { corps, statut } = surErreurDeValidation(echec(), contexte()) as never as {
      corps: { success: boolean; error: { code: string; message: string; details: unknown[] }; requestId: string };
      statut: number;
    };

    expect(statut).toBe(400);
    expect(corps.success).toBe(false);
    // Les trois champs qui valaient `undefined` sur vingt-six routes.
    expect(corps.error.code).toBe('VALIDATION_ERROR');
    expect(corps.error.message).toBeTruthy();
    expect(corps.requestId).toBeTruthy();
  });

  it('affiche le premier probleme, mis en mots dans la langue du lecteur', () => {
    // Depuis l'ADR 027, le message d'un schema est une CLE et le texte est
    // engendre : le champ est nomme, puis la regle.
    const fr = surErreurDeValidation(echec(), contexte('fr')) as never as {
      corps: { error: { message: string; details: Array<{ message: string }> } };
    };
    const en = surErreurDeValidation(echec(), contexte('en')) as never as {
      corps: { error: { message: string } };
    };

    expect(fr.corps.error.message).toBe('Adresse e-mail : Adresse invalide');
    expect(en.corps.error.message).toBe('Email address : Invalid address');
    // Les autres problemes ne sont pas perdus, et sont traduits aussi.
    expect(fr.corps.error.details).toHaveLength(2);
    // `montant` n'est pas au catalogue des champs : le message se passe alors de
    // prefixe plutot que d'afficher le nom technique au lecteur.
    expect(fr.corps.error.details[1].message).toBe('Minimum 1000');
  });

  it('retombe sur le catalogue quand le probleme n a pas de message', () => {
    const sansMessage = {
      success: false,
      error: { issues: [{ code: 'custom', path: [], message: '' }] },
    } as never;

    const fr = surErreurDeValidation(sansMessage, contexte('fr')) as never as {
      corps: { error: { message: string } };
    };
    const en = surErreurDeValidation(sansMessage, contexte('en')) as never as {
      corps: { error: { message: string } };
    };

    // Un probleme sans message reconnaissable est tout de meme mis en mots,
    // dans les deux langues, plutot que rendu tel quel.
    expect(fr.corps.error.message).toBe('Valeur invalide');
    expect(en.corps.error.message).toBe('Invalid value');
  });

  it('reprend le X-Request-ID du client quand il en fournit un', () => {
    const { corps } = surErreurDeValidation(echec(), contexte('fr', 'req-123')) as never as {
      corps: { requestId: string };
    };
    expect(corps.requestId).toBe('req-123');
  });

  it('en fabrique un quand le client n en fournit pas', () => {
    const { corps } = surErreurDeValidation(echec(), contexte()) as never as {
      corps: { requestId: string };
    };
    // C'est ce que l'utilisateur donnera au support : il doit exister.
    expect(corps.requestId).toMatch(/[0-9a-f-]{16,}/);
  });
});
