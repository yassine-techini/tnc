/**
 * Ce que la validation dit, dans la langue de qui ecoute — ADR 027.
 *
 * L'ADR 025 a rendu bilingues les reponses d'erreur de l'API, et a laisse un
 * reste nomme : les messages rediges DANS LES SCHEMAS Zod. Ils s'affichaient
 * tels quels — en francais — parce qu'un message pose sur un schema l'emporte
 * sur toute carte d'erreurs.
 *
 * DEUX MECANISMES, parce qu'il y a deux situations et pas une.
 *
 *   1. Ce qui est RECONSTRUCTIBLE depuis le probleme lui-meme : un champ requis,
 *      une longueur, un courriel mal forme, une valeur hors enumeration. Zod
 *      decrit tout cela dans l'objet `issue` — type, borne, valeur attendue. La
 *      `carteErreursZod` le remet en mots, dans les deux langues. Ces
 *      messages-la n'ont plus a etre ecrits nulle part.
 *
 *   2. Ce qui ne l'est PAS. `.regex(/[A-Z]/)` et `.regex(/[0-9]/)` produisent le
 *      meme probleme `invalid_string` : rien dans l'issue ne dit laquelle des
 *      deux regles a echoue. Supprimer leur message aurait remplace « au moins
 *      une majuscule » par « format invalide » — une perte, pas une traduction.
 *      Ces regles gardent donc un message, mais ce message est une CLE, et la
 *      cle a deux langues.
 *
 * LE NOM DU CHAMP est traduit lui aussi : « Mot de passe : 12 caracteres au
 * minimum » se lit mieux que « chaine trop courte », et c'est ce que les
 * anciens messages disaient chacun a leur maniere.
 */

import { z } from 'zod';

export type LangueValidation = 'fr' | 'en';

/** La langue d'une locale (`en-UG` -> `en`), avec le francais par defaut. */
export function langueValidation(locale: string | null | undefined): LangueValidation {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('en') ? 'en' : 'fr';
}

interface Bilingue {
  fr: string;
  en: string;
}

/**
 * Les regles dont l'intention ne se lit pas dans le probleme.
 *
 * Ce sont des cles, pas des phrases : c'est ce qui leur permet d'avoir deux
 * langues. Le garde-fou `check:messages` refuse toute prose dans un schema.
 */
export const REGLES_VALIDATION = {
  MDP_MAJUSCULE: {
    fr: 'Au moins une majuscule',
    en: 'At least one uppercase letter',
  },
  MDP_MINUSCULE: {
    fr: 'Au moins une minuscule',
    en: 'At least one lowercase letter',
  },
  MDP_CHIFFRE: { fr: 'Au moins un chiffre', en: 'At least one digit' },
  MDP_SPECIAL: {
    fr: 'Au moins un caractere special',
    en: 'At least one special character',
  },
  CODE_CHIFFRES_SEULEMENT: {
    fr: 'Uniquement des chiffres',
    en: 'Digits only',
  },
  TELEPHONE_INTERNATIONAL: {
    fr: 'Numero au format international attendu (indicatif compris)',
    en: 'International format expected (including the dialling code)',
  },
  DATE_ISO: { fr: 'Format attendu : AAAA-MM-JJ', en: 'Expected format: YYYY-MM-DD' },
  NOM_CARACTERES: {
    fr: 'Lettres, espaces, apostrophes et traits d’union seulement',
    en: 'Letters, spaces, apostrophes and hyphens only',
  },
  TYPE_DOCUMENT_FORME: {
    fr: 'Type de document invalide',
    en: 'Invalid document type',
  },
  IDENTIFIANT_REQUIS: {
    fr: 'Une adresse e-mail ou un numero de telephone est requis',
    en: 'An email address or a phone number is required',
  },
  MDP_CONFIRMATION: {
    fr: 'Les deux mots de passe ne correspondent pas',
    en: 'The two passwords do not match',
  },
  MOTIF_REJET_REQUIS: {
    fr: 'Un motif est requis pour rejeter',
    en: 'A reason is required to reject',
  },
  CHAMP_AU_MOINS_UN: {
    fr: 'Renseignez au moins un champ',
    en: 'Fill in at least one field',
  },
  PAIEMENT_DETAILS_INCOMPLETS: {
    fr: 'Details de paiement incomplets pour cette methode',
    en: 'Incomplete payment details for this method',
  },
  CORRIDOR_REQUIS: {
    fr: 'Un raffineur doit declarer son corridor : pays d’origine et pays d’affinage',
    en: 'A refiner must declare its corridor: origin and refining country',
  },
} satisfies Record<string, Bilingue>;

export type RegleValidation = keyof typeof REGLES_VALIDATION;

/** Une cle du catalogue ? */
export function estRegleConnue(cle: string): cle is RegleValidation {
  return Object.prototype.hasOwnProperty.call(REGLES_VALIDATION, cle);
}

/**
 * Le nom d'un champ, tel qu'on le montre.
 *
 * Un champ absent d'ici n'est pas une erreur : le message se passe alors de
 * prefixe plutot que d'afficher `corridorOriginCountry` a un lecteur.
 */
const CHAMPS: Record<string, Bilingue> = {
  address: { fr: 'Adresse', en: 'Address' },
  amount: { fr: 'Montant', en: 'Amount' },
  city: { fr: 'Ville', en: 'City' },
  code: { fr: 'Code', en: 'Code' },
  confirmPassword: { fr: 'Confirmation', en: 'Confirmation' },
  corridorDestinationCountry: { fr: 'Pays d’affinage', en: 'Refining country' },
  corridorOriginCountry: { fr: 'Pays d’origine', en: 'Origin country' },
  country: { fr: 'Pays', en: 'Country' },
  currentPassword: { fr: 'Mot de passe actuel', en: 'Current password' },
  dateOfBirth: { fr: 'Date de naissance', en: 'Date of birth' },
  documentExpiryDate: { fr: 'Date d’expiration', en: 'Expiry date' },
  documentNumber: { fr: 'Numero de document', en: 'Document number' },
  documentType: { fr: 'Type de document', en: 'Document type' },
  email: { fr: 'Adresse e-mail', en: 'Email address' },
  firstName: { fr: 'Prenom', en: 'First name' },
  grams: { fr: 'Grammes', en: 'Grams' },
  identifier: { fr: 'Identifiant', en: 'Identifier' },
  lastName: { fr: 'Nom', en: 'Last name' },
  legalName: { fr: 'Raison sociale', en: 'Legal name' },
  nationality: { fr: 'Nationalite', en: 'Nationality' },
  newPassword: { fr: 'Nouveau mot de passe', en: 'New password' },
  password: { fr: 'Mot de passe', en: 'Password' },
  phone: { fr: 'Telephone', en: 'Phone' },
  phoneNumber: { fr: 'Telephone', en: 'Phone' },
  reason: { fr: 'Motif', en: 'Reason' },
  registrationNumber: { fr: 'Numero RCCM', en: 'Trade register number' },
  rejectionReason: { fr: 'Motif de rejet', en: 'Rejection reason' },
  representativeName: { fr: 'Representant legal', en: 'Legal representative' },
  setupToken: { fr: 'Jeton de configuration', en: 'Setup token' },
  targetPrice: { fr: 'Prix cible', en: 'Target price' },
  token: { fr: 'Jeton', en: 'Token' },
  totpCode: { fr: 'Code de verification', en: 'Verification code' },
};

function nomDuChamp(chemin: (string | number)[], langue: LangueValidation): string | null {
  const dernier = [...chemin].reverse().find((p) => typeof p === 'string') as string | undefined;
  if (!dernier) return null;
  return CHAMPS[dernier]?.[langue] ?? null;
}

/** « Mot de passe : au moins une majuscule ». Sans nom de champ, la phrase seule. */
function prefixer(champ: string | null, phrase: string): string {
  return champ ? `${champ} : ${phrase}` : phrase;
}

const REQUIS: Bilingue = { fr: 'Ce champ est requis', en: 'This field is required' };

/** Ce qu'on lit d'un probleme, quelle que soit sa forme exacte. */
export interface ProblemeLisible {
  code?: string;
  message?: string;
  path?: (string | number)[];
}

function longueur(
  n: number,
  langue: LangueValidation,
  type: 'string' | 'number' | 'array',
  sens: 'min' | 'max' | 'exact'
): string {
  if (type === 'number') {
    if (sens === 'exact') return langue === 'en' ? `Must be ${n}` : `Doit valoir ${n}`;
    return sens === 'min'
      ? langue === 'en'
        ? `Minimum ${n}`
        : `Minimum ${n}`
      : langue === 'en'
        ? `Maximum ${n}`
        : `Maximum ${n}`;
  }
  const unite =
    type === 'array'
      ? langue === 'en'
        ? n > 1
          ? 'items'
          : 'item'
        : n > 1
          ? 'elements'
          : 'element'
      : langue === 'en'
        ? n > 1
          ? 'characters'
          : 'character'
        : n > 1
          ? 'caracteres'
          : 'caractere';
  if (sens === 'exact') return langue === 'en' ? `Exactly ${n} ${unite}` : `Exactement ${n} ${unite}`;
  return sens === 'min'
    ? langue === 'en'
      ? `At least ${n} ${unite}`
      : `${n} ${unite} au minimum`
    : langue === 'en'
      ? `At most ${n} ${unite}`
      : `${n} ${unite} au maximum`;
}

/**
 * Remet un probleme Zod en mots, dans une langue.
 *
 * Le message pose sur le schema l'emporte toujours sur une carte d'erreurs ;
 * quand ce message est une CLE du catalogue, c'est ici qu'il redevient une
 * phrase. C'est pourquoi la traduction se fait au rendu et pas seulement a
 * l'analyse.
 */
export function traduireProbleme(
  entree: ProblemeLisible,
  langue: LangueValidation
): string {
  // `ZodIssue` est une union de formes ; les champs utiles ici — `minimum`,
  // `validation`, `options` — n'existent que sur certaines d'entre elles. On lit
  // donc a plat plutot que d'imposer une intersection que `ZodIssue` ne satisfait
  // pas.
  const probleme = entree as Record<string, unknown> & ProblemeLisible;
  const champ = nomDuChamp(probleme.path ?? [], langue);

  if (probleme.message && estRegleConnue(probleme.message)) {
    return prefixer(champ, REGLES_VALIDATION[probleme.message][langue]);
  }

  switch (probleme.code) {
    case 'invalid_type':
      return probleme.received === 'undefined' || probleme.received === 'null'
        ? prefixer(champ, REQUIS[langue])
        : prefixer(champ, langue === 'en' ? 'Unexpected value' : 'Valeur inattendue');

    case 'too_small': {
      const type = (probleme.type as 'string' | 'number' | 'array') ?? 'string';
      const n = Number(probleme.minimum);
      if (type === 'string' && n <= 1) return prefixer(champ, REQUIS[langue]);
      return prefixer(champ, longueur(n, langue, type, probleme.exact ? 'exact' : 'min'));
    }

    case 'too_big': {
      const type = (probleme.type as 'string' | 'number' | 'array') ?? 'string';
      return prefixer(
        champ,
        longueur(Number(probleme.maximum), langue, type, probleme.exact ? 'exact' : 'max')
      );
    }

    case 'invalid_string':
      // Les phrases ne renomment PAS le champ : le prefixe s'en charge, et
      // « Adresse e-mail : adresse e-mail invalide » etait le resultat de la
      // premiere version.
      if (probleme.validation === 'email')
        return prefixer(champ, langue === 'en' ? 'Invalid address' : 'Adresse invalide');
      if (probleme.validation === 'uuid')
        return prefixer(champ, langue === 'en' ? 'Invalid identifier' : 'Identifiant invalide');
      if (probleme.validation === 'url')
        return prefixer(champ, langue === 'en' ? 'Invalid web address' : 'Adresse web invalide');
      return prefixer(champ, langue === 'en' ? 'Invalid format' : 'Format invalide');

    case 'invalid_enum_value': {
      const options = Array.isArray(probleme.options) ? probleme.options.join(', ') : '';
      return prefixer(
        champ,
        langue === 'en' ? `Expected one of: ${options}` : `Valeurs acceptees : ${options}`
      );
    }

    case 'invalid_date':
      return prefixer(champ, langue === 'en' ? 'Invalid date' : 'Date invalide');

    default:
      return prefixer(champ, langue === 'en' ? 'Invalid value' : 'Valeur invalide');
  }
}

/**
 * La carte d'erreurs a passer a `safeParse`.
 *
 * Elle couvre ce que Zod decrit assez pour etre remis en mots. Un message pose
 * sur le schema la court-circuite — c'est le comportement de Zod, et c'est
 * pourquoi `traduireProbleme` est appele une seconde fois au rendu.
 */
export function carteErreursZod(langue: LangueValidation): z.ZodErrorMap {
  return (probleme, contexte) => {
    const traduit = traduireProbleme(
      probleme as unknown as Parameters<typeof traduireProbleme>[0],
      langue
    );
    return { message: traduit || contexte.defaultError };
  };
}
