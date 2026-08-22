/**
 * Une erreur de validation est une erreur comme les autres — ADR 026.
 *
 * `@hono/zod-validator` sans hook repond `c.json(result, 400)`, ou `result` est
 * le resultat brut de Zod. Mesure sur la version installee :
 *
 *   {"success":false,"error":{"issues":[…],"name":"ZodError"}}
 *
 *   error.code    -> undefined
 *   error.message -> undefined
 *   requestId     -> undefined
 *
 * Vingt-six routes repondaient ainsi — inscription, connexion, rafraichissement
 * de jeton, depot, retrait. Un client qui aiguille sur `error.code`, comme le
 * font le web et le mobile, n'y trouvait rien ; et il y trouvait en revanche un
 * `issues[0].code` valant `invalid_string`, c'est-a-dire le vocabulaire interne
 * d'une bibliotheque tierce.
 *
 * UN SEUL HOOK, pas vingt-six. Une regle recopiee vingt-six fois ne protege plus
 * que les chemins dont on se souvient — meme raisonnement qu'aux ADR 009 et 023.
 * `check:messages` refuse desormais un `zValidator` qui ne le porte pas.
 */

import type { Context } from 'hono';
import type { ZodError } from 'zod';
import { texte } from './reponse-erreur';

/**
 * Ce que `zValidator` passe a son hook.
 *
 * Forme PLATE, pas une union discriminee : ce paquet compile avec
 * `strictNullChecks: false`, ou TypeScript ne retrecit pas sur `success`. Meme
 * raison qu'a `stock-invariant` et `high-value-2fa` — une union serait ici une
 * elegance qui ne compile pas.
 */
interface ResultatValidation {
  success: boolean;
  error?: ZodError;
  data?: unknown;
}

/**
 * Rend la forme d'erreur de la plateforme, ou rien quand tout va bien.
 *
 * Le message est celui du PREMIER probleme — « Montant minimum : 1000 XOF » —
 * avec le catalogue en repli. C'est la forme deja retenue par l'ADR 025 pour les
 * routes qui parsent a la main : deux formes pour la meme situation auraient
 * ete une incoherence de plus.
 */
export const surErreurDeValidation = (
  resultat: ResultatValidation,
  c: Context
): Response | undefined => {
  if (resultat.success) return undefined;

  const problemes = resultat.error.issues ?? [];
  const premier = problemes[0];

  return c.json(
    {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: premier?.message || texte(c, 'VALIDATION_ERROR'),
        details: problemes,
      },
      // Meme repli que le gestionnaire d'erreurs global : l'en-tete du client
      // quand il en fournit un, sinon un identifiant neuf. C'est ce que
      // l'utilisateur donnera au support.
      requestId: c.req.header('X-Request-ID') || crypto.randomUUID(),
    },
    400
  );
};
