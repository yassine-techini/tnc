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

  it('affiche le message du premier probleme', () => {
    const { corps } = surErreurDeValidation(echec(), contexte()) as never as {
      corps: { error: { message: string; details: unknown[] } };
    };
    expect(corps.error.message).toBe('Adresse invalide');
    // Les autres problemes ne sont pas perdus pour autant.
    expect(corps.error.details).toHaveLength(2);
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

    expect(fr.corps.error.message).toBe('Donnees invalides');
    expect(en.corps.error.message).toBe('Invalid data');
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
