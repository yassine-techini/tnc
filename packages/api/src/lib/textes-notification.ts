/**
 * Ce que la plateforme dit, dans la langue de qui l'ecoute — ADR 020.
 *
 * `country_config.locale` etait expose par la route publique et jamais consulte
 * cote serveur. L'Ouganda est declare `en-UG` : un raffineur ougandais recevait
 * « Bienvenue sur TNC Trading », puis « Votre KYC a ete approuve ».
 *
 * Ce n'est pas une question de confort. Ces messages portent des instructions —
 * quel document fournir, quelle limite est atteinte, pourquoi un retrait est
 * refuse — et un message incompris devient un appel au support, ou un abandon.
 *
 * LE TEXTE EST SEPARE DE LA MISE EN PAGE. Les gabarits melaient l'un et l'autre
 * sur des centaines de lignes de HTML ; les dupliquer par langue aurait double le
 * fichier et cree un piege d'entretien. Une coquille unique, un texte par langue.
 */

export type Langue = 'fr' | 'en';

/** La langue d'une locale (`en-UG` → `en`), avec le francais par defaut. */
export function langueDe(locale: string | null | undefined): Langue {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('en') ? 'en' : 'fr';
}

/** Le contenu d'un courriel, sans mise en page. */
export interface TexteCourriel {
  sujet: string;
  titre: string;
  paragraphes: string[];
  puces?: string[];
  bouton?: { libelle: string; lien: string };
}

type Catalogue<A extends unknown[]> = Record<Langue, (...args: A) => TexteCourriel>;

/**
 * L'accroche ne nomme AUCUN pays.
 *
 * Elle disait « la plateforme souveraine de tokenisation d'or du Burkina Faso »
 * et « Investissez dans l'or du Burkina Faso » — vrai d'un pays, faux des le
 * deuxieme, et adresse a des raffineurs qui n'y sont pas.
 */
export const ACCROCHE: Record<Langue, string> = {
  fr: "Plateforme de tokenisation d'or",
  en: 'Gold tokenisation platform',
};

export const PIED: Record<Langue, string> = {
  fr: 'TNC Trading — tous droits réservés.',
  en: 'TNC Trading — all rights reserved.',
};

export const BIENVENUE: Catalogue<[string]> = {
  fr: (nom) => ({
    sujet: 'Bienvenue sur TNC Trading',
    titre: `Bienvenue ${nom} !`,
    paragraphes: ['Merci de rejoindre TNC Trading.', 'Avec TNC Trading, vous pouvez :'],
    puces: [
      "Acheter des tokens adossés à de l'or physique",
      'Suivre la valeur de votre portefeuille en temps réel',
      'Vendre vos tokens à tout moment',
      'Obtenir un certificat de propriété',
    ],
    bouton: { libelle: 'Compléter mon KYC', lien: 'https://app.tnc-trading.com/kyc' },
  }),
  en: (nom) => ({
    sujet: 'Welcome to TNC Trading',
    titre: `Welcome ${nom}!`,
    paragraphes: ['Thank you for joining TNC Trading.', 'With TNC Trading you can:'],
    puces: [
      'Buy tokens backed by physical gold',
      'Follow your holdings in real time',
      'Sell your tokens at any time',
      'Obtain a certificate of ownership',
    ],
    bouton: { libelle: 'Complete my KYC', lien: 'https://app.tnc-trading.com/kyc' },
  }),
};

export const CODE_VERIFICATION: Catalogue<[string, 'email' | 'phone']> = {
  fr: (code, type) => ({
    sujet: `Code de vérification TNC Trading : ${code}`,
    titre: 'Votre code de vérification',
    paragraphes: [
      `Voici votre code pour vérifier votre ${type === 'email' ? 'adresse e-mail' : 'numéro de téléphone'} :`,
      code,
      "Ce code expire dans 10 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.",
    ],
  }),
  en: (code, type) => ({
    sujet: `TNC Trading verification code: ${code}`,
    titre: 'Your verification code',
    paragraphes: [
      `Here is your code to verify your ${type === 'email' ? 'email address' : 'phone number'}:`,
      code,
      'This code expires in 10 minutes. If you did not request it, please ignore this message.',
    ],
  }),
};

export const KYC_APPROUVE: Catalogue<[string, string]> = {
  fr: (nom, niveau) => ({
    sujet: 'Votre KYC a été approuvé — TNC Trading',
    titre: `Bonne nouvelle, ${nom}`,
    paragraphes: [
      `Votre vérification d'identité a été approuvée. Votre compte est désormais au niveau ${niveau}.`,
      'Vous pouvez maintenant acheter et vendre des tokens.',
    ],
    bouton: { libelle: 'Accéder à mon compte', lien: 'https://app.tnc-trading.com' },
  }),
  en: (nom, niveau) => ({
    sujet: 'Your KYC has been approved — TNC Trading',
    titre: `Good news, ${nom}`,
    paragraphes: [
      `Your identity verification has been approved. Your account is now at level ${niveau}.`,
      'You can now buy and sell tokens.',
    ],
    bouton: { libelle: 'Go to my account', lien: 'https://app.tnc-trading.com' },
  }),
};

export const KYC_REFUSE: Catalogue<[string, string]> = {
  fr: (nom, motif) => ({
    sujet: 'Action requise : vérification KYC — TNC Trading',
    titre: `${nom}, votre dossier doit être corrigé`,
    paragraphes: [
      "Votre vérification d'identité n'a pas pu être validée.",
      `Motif : ${motif}`,
      'Vous pouvez soumettre un nouveau dossier à tout moment.',
    ],
    bouton: { libelle: 'Reprendre ma vérification', lien: 'https://app.tnc-trading.com/kyc' },
  }),
  en: (nom, motif) => ({
    sujet: 'Action required: KYC verification — TNC Trading',
    titre: `${nom}, your application needs correcting`,
    paragraphes: [
      'Your identity verification could not be approved.',
      `Reason: ${motif}`,
      'You may submit a new application at any time.',
    ],
    bouton: { libelle: 'Resume my verification', lien: 'https://app.tnc-trading.com/kyc' },
  }),
};

export const TRANSACTION_TERMINEE: Catalogue<[string, string, number]> = {
  fr: (type, montant, grammes) => ({
    sujet: 'Transaction confirmée — TNC Trading',
    titre: 'Votre transaction est confirmée',
    paragraphes: [
      `Opération : ${type}`,
      `Montant : ${montant}`,
      `Quantité : ${grammes} g`,
      'Le détail figure dans votre historique.',
    ],
  }),
  en: (type, montant, grammes) => ({
    sujet: 'Transaction confirmed — TNC Trading',
    titre: 'Your transaction is confirmed',
    paragraphes: [
      `Operation: ${type}`,
      `Amount: ${montant}`,
      `Quantity: ${grammes} g`,
      'The details appear in your history.',
    ],
  }),
};

export const ALERTE_SECURITE: Catalogue<[string, string]> = {
  fr: (action, details) => ({
    sujet: 'Alerte de sécurité — TNC Trading',
    titre: 'Activité inhabituelle sur votre compte',
    paragraphes: [
      `Action : ${action}`,
      details,
      "Si vous n'êtes pas à l'origine de cette action, changez votre mot de passe immédiatement.",
    ],
    bouton: { libelle: 'Sécuriser mon compte', lien: 'https://app.tnc-trading.com/security' },
  }),
  en: (action, details) => ({
    sujet: 'Security alert — TNC Trading',
    titre: 'Unusual activity on your account',
    paragraphes: [
      `Action: ${action}`,
      details,
      'If this was not you, change your password immediately.',
    ],
    bouton: { libelle: 'Secure my account', lien: 'https://app.tnc-trading.com/security' },
  }),
};

export const RETRAIT_APPROUVE: Catalogue<[string, string]> = {
  fr: (montant, methode) => ({
    sujet: 'Retrait approuvé — TNC Trading',
    titre: 'Votre retrait est en route',
    paragraphes: [`Montant : ${montant}`, `Méthode : ${methode}`, 'Les délais dépendent de votre opérateur.'],
  }),
  en: (montant, methode) => ({
    sujet: 'Withdrawal approved — TNC Trading',
    titre: 'Your withdrawal is on its way',
    paragraphes: [`Amount: ${montant}`, `Method: ${methode}`, 'Timing depends on your provider.'],
  }),
};

/** Les SMS : une ligne, pas de mise en page. */
export const SMS: Record<string, Record<Langue, (...args: never[]) => string>> = {
  CODE_VERIFICATION: {
    fr: ((code: string) => `TNC Trading : votre code de verification est ${code}. Valable 10 minutes.`) as never,
    en: ((code: string) => `TNC Trading: your verification code is ${code}. Valid for 10 minutes.`) as never,
  },
  ALERTE_CONNEXION: {
    fr: ((ip: string) => `TNC Trading : connexion depuis ${ip}. Si ce n'est pas vous, changez votre mot de passe.`) as never,
    en: ((ip: string) => `TNC Trading: sign-in from ${ip}. If this was not you, change your password.`) as never,
  },
  TRANSACTION_TERMINEE: {
    fr: ((type: string, montant: string) => `TNC Trading : ${type} confirme, ${montant}.`) as never,
    en: ((type: string, montant: string) => `TNC Trading: ${type} confirmed, ${montant}.`) as never,
  },
  RETRAIT_APPROUVE: {
    fr: ((montant: string) => `TNC Trading : votre retrait de ${montant} est approuve.`) as never,
    en: ((montant: string) => `TNC Trading: your withdrawal of ${montant} is approved.`) as never,
  },
  CODE_2FA: {
    fr: ((code: string) => `TNC Trading : code de securite ${code}. Ne le communiquez a personne.`) as never,
    en: ((code: string) => `TNC Trading: security code ${code}. Do not share it with anyone.`) as never,
  },
};
