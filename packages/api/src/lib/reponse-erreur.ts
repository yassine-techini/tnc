/**
 * La langue d'une reponse d'erreur, et le texte qui va avec — ADR 025.
 *
 * POURQUOI PAS LA BASE. `langueDeLUtilisateur` existe et lit
 * `country_config.locale` ; c'est le bon signal pour une notification, qui n'a
 * pas de requete sous la main. Ici il y en a une, et le client declare sa
 * langue. Surtout : appeler la base mettrait une lecture sur le chemin
 * d'erreur, c'est-a-dire la ou la base est parfois la cause de l'erreur. Une
 * reponse d'erreur ne doit dependre de rien qui puisse echouer a son tour.
 *
 * Sans en-tete exploitable, on repond en francais.
 */

import type { Context } from 'hono';
import { traduireProbleme } from '@tnc-trading/shared/validators';
import { messageErreur, type CodeErreur, type Langue, type ParamsErreur } from './messages-erreur';

/**
 * La langue demandee par `Accept-Language`, francais par defaut.
 *
 * On lit la premiere langue reconnue et on s'arrete la : les poids `q` et les
 * variantes regionales n'apportent rien tant qu'il y a deux langues (ADR 025).
 */
export function langueDeLaRequete(c: Pick<Context, 'req'>): Langue {
  const entete = c.req.header('Accept-Language');
  if (!entete) return 'fr';

  for (const morceau of entete.split(',')) {
    const etiquette = morceau.split(';')[0].trim().toLowerCase();
    if (etiquette.startsWith('en')) return 'en';
    if (etiquette.startsWith('fr')) return 'fr';
  }
  return 'fr';
}

type CodesAvecParams = keyof ParamsErreur;
type CodesSansParams = Exclude<CodeErreur, CodesAvecParams>;

/**
 * Le texte d'un code d'erreur, dans la langue de qui lit.
 *
 * Le code est repete a cote du `code:` de la reponse ; c'est voulu, et
 * `check:messages` verifie que les deux concordent. La reponse garde sa forme,
 * seul le texte quitte le site d'appel.
 */
export function texte<C extends CodesAvecParams>(
  c: Pick<Context, 'req'>,
  code: C,
  params: ParamsErreur[C]
): string;
export function texte(c: Pick<Context, 'req'>, code: CodesSansParams): string;
export function texte(c: Pick<Context, 'req'>, code: CodeErreur, params?: unknown): string {
  // Les surcharges publiques garantissent l'accord code/parametres ; l'appel
  // interne doit contourner leur typage pour rester unique.
  return (messageErreur as (co: CodeErreur, la: Langue, pa?: unknown) => string)(
    code,
    langueDeLaRequete(c),
    params
  );
}

/**
 * Le premier probleme de validation, mis en mots — ADR 027.
 *
 * A utiliser partout ou un schema est analyse a la main, plutot que de lire
 * `issues[0].message` : ce message est une CLE depuis l'ADR 027, et l'afficher
 * tel quel montrerait `CORRIDOR_REQUIS` au lecteur.
 */
export function messageValidation(
  c: Pick<Context, 'req'>,
  problemes: readonly unknown[] | undefined,
  repli: CodeErreur = 'INVALID_INPUT'
): string {
  const premier = problemes?.[0];
  if (!premier) return texte(c, repli as never);
  return traduireProbleme(premier as never, langueDeLaRequete(c));
}
