/**
 * Ce que l'API repond quand elle refuse — dans la langue de qui ecoute (ADR 025).
 *
 * L'ADR 020 a traduit les notifications ; les reponses de l'API etaient restees
 * en francais. En francais ET en anglais, en realite : « Server misconfigured »,
 * « Unable to fetch gold price » et « Admin access required » partaient deja en
 * anglais. Le melange existait, il n'etait pas decide.
 *
 * LE TEXTE N'EST PLUS AU SITE D'APPEL. Un site nomme un code et ses parametres ;
 * ce fichier possede les deux langues. Garder le francais au site d'appel et
 * n'ajouter qu'une couche anglaise aurait laisse deux sources de verite pour le
 * meme message, qui divergent des la premiere retouche sans qu'aucun controle
 * puisse le voir. Le garde-fou `check:messages` refuse desormais tout texte
 * litteral dans une reponse d'erreur.
 *
 * LES CODES NE BOUGENT PAS. Un client peut aiguiller dessus. Les doublons de
 * l'inventaire sont conserves tels quels et signales ci-dessous : les unifier
 * est une decision d'API, pas de traduction.
 */

import type { Langue } from './textes-notification';

export type { Langue };

/** Un nombre, ecrit comme l'ecrit la langue qui le lit. */
function nombre(valeur: number, langue: Langue): string {
  return new Intl.NumberFormat(langue === 'en' ? 'en-US' : 'fr-FR').format(valeur);
}

/**
 * Ce qui peut manquer derriere un `NOT_FOUND`.
 *
 * Le code generique portait quinze messages differents — « Lot non trouve »,
 * « Position introuvable », « Aucune attestation publiee ». Les traduire
 * demandait de nommer la ressource : la voici, fermee et traduite une fois.
 */
export type Ressource =
  | 'alerte'
  | 'alerteAcquittee'
  | 'alerteResolue'
  | 'attestation'
  | 'attestationAucune'
  | 'consignation'
  | 'dossier'
  | 'journal'
  | 'position'
  | 'regle'
  | 'route'
  | 'soumissionKyc'
  | 'stock';

const RESSOURCES: Record<Ressource, { fr: string; en: string }> = {
  alerte: { fr: 'Alerte introuvable', en: 'Alert not found' },
  alerteAcquittee: {
    fr: 'Alerte introuvable ou deja acquittee',
    en: 'Alert not found or already acknowledged',
  },
  alerteResolue: {
    fr: 'Alerte introuvable ou deja resolue',
    en: 'Alert not found or already resolved',
  },
  attestation: { fr: 'Attestation inconnue', en: 'Unknown attestation' },
  attestationAucune: { fr: 'Aucune attestation publiee', en: 'No attestation published' },
  consignation: { fr: 'Lot introuvable', en: 'Consignment not found' },
  dossier: { fr: 'Dossier introuvable', en: 'Record not found' },
  journal: { fr: 'Journal introuvable', en: 'Log entry not found' },
  position: { fr: 'Position introuvable', en: 'Position not found' },
  regle: { fr: 'Regle introuvable', en: 'Rule not found' },
  route: { fr: 'Cette adresse n’existe pas', en: 'This route does not exist' },
  soumissionKyc: { fr: 'Soumission KYC introuvable', en: 'KYC submission not found' },
  stock: { fr: 'Aucun stock enregistre', en: 'No stock on record' },
};

/** L'operation qu'un niveau KYC insuffisant a empechee. */
export type OperationKyc = 'achat' | 'vente' | 'retrait' | 'consignation' | 'generique';

const OPERATIONS_KYC: Record<OperationKyc, { fr: string; en: string }> = {
  achat: {
    fr: 'Verification insuffisante pour acheter. Completez votre dossier.',
    en: 'Verification level too low to buy. Please complete your profile.',
  },
  vente: {
    fr: 'Verification insuffisante pour vendre. Completez votre dossier.',
    en: 'Verification level too low to sell. Please complete your profile.',
  },
  retrait: {
    fr: 'Verification insuffisante pour effectuer un retrait.',
    en: 'Verification level too low to withdraw.',
  },
  consignation: {
    fr: 'Verification requise avant de consigner un lot : completez votre dossier producteur.',
    en: 'Verification required before consigning: please complete your producer profile.',
  },
  generique: {
    fr: 'Verification insuffisante pour cette operation.',
    en: 'Verification level too low for this operation.',
  },
};

/**
 * Les parametres attendus par les codes qui en portent.
 *
 * Un code absent de cette interface se rend sans parametre — et le typage le
 * refuse s'il en recoit un.
 */
export interface ParamsErreur {
  ALERT_LIMIT_EXCEEDED: { max: number };
  AMOUNT_TOO_LOW: { minimum: number; devise: string };
  /** `minutes` absent : le blocage est connu, sa duree restante ne l'est pas. */
  AUTH_ACCOUNT_LOCKED: { minutes?: number };
  FILE_TOO_LARGE: { maxMo: number };
  INVALID_TRANSITION: { depuis: string; dejaTraite: boolean };
  KYC_DOCUMENT_TYPE_UNSUPPORTED: { pays: string; acceptes: string[] };
  KYC_LEVEL_INSUFFICIENT: { operation: OperationKyc };
  NOT_FOUND: { ressource: Ressource };
  /**
   * `emisG` absent : l'ajustement a ete refuse par la garde SQL parce qu'un
   * AUTRE ajustement est passe entre-temps (ADR 022). On ne connait alors pas
   * le total emis — le lire ici donnerait un chiffre deja perime.
   */
  STOCK_BELOW_ISSUED: { emisG?: number };
  TOO_MANY_USERS: { max: number };
  TRADING_AMOUNT_TOO_SMALL: {
    grammesMinimum: number;
    plancher?: { montant: number; devise: string };
  };
  TRADING_INVALID_QUOTE_TYPE: { attendu: 'achat' | 'vente' };
  TRADING_LIMIT_EXCEEDED: { limiteG: number; periode: 'jour' | 'mois' };
  WITHDRAWAL_LIMIT_EXCEEDED: { plafond: number; devise: string };
}

type Entree =
  | { fr: string; en: string }
  | { fr: (p: never) => string; en: (p: never) => string };

/**
 * Le catalogue. Un code, deux langues, jamais une seule.
 *
 * DOUBLONS CONSERVES (ADR 025) : `INVALID_PASSWORD` / `AUTH_INVALID_PASSWORD`,
 * `INVALID_CODE` / `AUTH_INVALID_CODE`, `KYC_PENDING` / `KYC_ALREADY_PENDING`,
 * `RATE_LIMITED` / `RATE_LIMIT_EXCEEDED` / `AUTH_RATE_LIMITED`. Ils disent la
 * meme chose sous deux codes ; les fusionner casserait un client qui aiguille
 * dessus.
 */
export const MESSAGES = {
  /**
   * — Double authentification des portails privilegies ————————————
   *
   * Ces codes commencent par un CHIFFRE, et c'est ce qui les a rendus
   * invisibles : l'inventaire, le codemod et la premiere version du garde-fou
   * cherchaient tous `'[A-Z][A-Z0-9_]*'`. Quinze sites d'erreur ont traverse
   * trois passes sans etre vus. Les outils comptent desormais les chiffres.
   *
   * Ils font doublon avec les `AUTH_2FA_*` du portail client (ADR 025) ; les
   * fusionner casserait un client qui aiguille dessus.
   */
  '2FA_ALREADY_ENABLED': {
    fr: 'La double authentification est deja activee',
    en: 'Two-factor authentication is already enabled',
  },
  '2FA_INVALID': {
    fr: 'Code de double authentification invalide',
    en: 'Invalid two-factor code',
  },
  '2FA_INVALID_CODE': {
    fr: 'Code incorrect. Verifiez l’heure de votre appareil.',
    en: 'Incorrect code. Check your device clock.',
  },
  '2FA_INVALID_SECRET': { fr: 'Secret invalide', en: 'Invalid secret' },
  '2FA_NOT_ENABLED': {
    fr: 'La double authentification n’est pas activee',
    en: 'Two-factor authentication is not enabled',
  },
  '2FA_REQUIRED': {
    fr: 'Code de double authentification requis',
    en: 'A two-factor code is required',
  },
  '2FA_SETUP_EXPIRED': {
    fr: 'Session de configuration expiree. Recommencez.',
    en: 'Setup session expired. Please start again.',
  },
  '2FA_SETUP_REQUIRED': {
    fr: 'Double authentification obligatoire. Scannez le QR code pour l’activer.',
    en: 'Two-factor authentication is mandatory. Scan the QR code to enable it.',
  },

  // — Administration —————————————————————————————————————————————
  ADMIN_ACCESS_DENIED: {
    fr: 'Acces administrateur non autorise',
    en: 'Administrator access denied',
  },
  ADMIN_AUTH_FAILED: { fr: 'Authentification echouee', en: 'Authentication failed' },
  ADMIN_AUTH_REQUIRED: {
    fr: 'Authentification administrateur requise',
    en: 'Administrator authentication required',
  },
  ADMIN_NOT_FOUND: { fr: 'Administrateur introuvable', en: 'Administrator not found' },

  // — Alertes de prix ————————————————————————————————————————————
  ALERT_LIMIT_EXCEEDED: {
    fr: (p: ParamsErreur['ALERT_LIMIT_EXCEEDED']) =>
      `Vous avez atteint la limite de ${p.max} alertes actives`,
    en: (p: ParamsErreur['ALERT_LIMIT_EXCEEDED']) =>
      `You have reached the limit of ${p.max} active alerts`,
  },
  ALERT_NOT_FOUND: { fr: 'Alerte introuvable', en: 'Alert not found' },
  DUPLICATE_ALERT: { fr: 'Une alerte similaire existe deja', en: 'A similar alert already exists' },
  INVALID_DIRECTION: {
    fr: 'La direction doit etre « above » ou « below »',
    en: 'Direction must be "above" or "below"',
  },
  INVALID_REQUEST: {
    fr: 'Un prix cible et une direction sont requis',
    en: 'A target price and a direction are required',
  },

  // — Authentification ———————————————————————————————————————————
  AUTH_2FA_INVALID: {
    fr: 'Code de double authentification invalide',
    en: 'Invalid two-factor code',
  },
  AUTH_2FA_REQUIRED: {
    fr: 'Code de double authentification requis pour cette operation',
    en: 'A two-factor code is required for this operation',
  },
  /**
   * Deux situations, un seul texte : la connexion a un portail qui l'exige, et
   * une operation qui depasse le seuil de verification renforcee (ADR 009). La
   * consigne est la meme — activer le second facteur — et c'est elle qui compte.
   */
  AUTH_2FA_SETUP_REQUIRED: {
    fr: 'Double authentification requise. Activez-la dans vos parametres de securite pour poursuivre.',
    en: 'Two-factor authentication required. Enable it in your security settings to continue.',
  },
  AUTH_ACCOUNT_LOCKED: {
    fr: (p: ParamsErreur['AUTH_ACCOUNT_LOCKED']) =>
      p.minutes === undefined
        ? 'Compte bloque a la suite de plusieurs tentatives echouees'
        : `Compte temporairement bloque. Reessayez dans ${p.minutes} minute(s).`,
    en: (p: ParamsErreur['AUTH_ACCOUNT_LOCKED']) =>
      p.minutes === undefined
        ? 'Account locked after several failed attempts'
        : `Account temporarily locked. Try again in ${p.minutes} minute(s).`,
  },
  AUTH_ACCOUNT_SUSPENDED: { fr: 'Compte suspendu', en: 'Account suspended' },
  AUTH_EMAIL_EXISTS: {
    fr: 'Un compte avec cette adresse existe deja',
    en: 'An account with this email already exists',
  },
  AUTH_INVALID_CODE: {
    fr: 'Code de verification invalide ou expire',
    en: 'Invalid or expired verification code',
  },
  AUTH_INVALID_CREDENTIALS: {
    fr: 'Adresse ou mot de passe incorrect',
    en: 'Incorrect email or password',
  },
  AUTH_INVALID_PASSWORD: { fr: 'Mot de passe incorrect', en: 'Incorrect password' },
  AUTH_INVALID_REFRESH_TOKEN: {
    fr: 'Jeton de rafraichissement invalide ou expire',
    en: 'Invalid or expired refresh token',
  },
  AUTH_INVALID_RESET_TOKEN: {
    fr: 'Lien de reinitialisation invalide ou expire',
    en: 'Invalid or expired reset link',
  },
  AUTH_INVALID_TOKEN: { fr: 'Jeton invalide ou expire', en: 'Invalid or expired token' },
  AUTH_INVALID_TOKEN_TYPE: { fr: 'Type de jeton invalide', en: 'Invalid token type' },
  AUTH_PHONE_EXISTS: {
    fr: 'Un compte avec ce numero de telephone existe deja',
    en: 'An account with this phone number already exists',
  },
  AUTH_RATE_LIMITED: {
    fr: 'Trop de demandes. Reessayez dans quelques minutes.',
    en: 'Too many requests. Try again in a few minutes.',
  },
  AUTH_REFRESH_TOKEN_REQUIRED: {
    fr: 'Jeton de rafraichissement requis',
    en: 'A refresh token is required',
  },
  AUTH_REQUIRED: { fr: 'Authentification requise', en: 'Authentication required' },
  AUTH_TOO_MANY_ATTEMPTS: {
    fr: 'Trop de tentatives. Demandez un nouveau code.',
    en: 'Too many attempts. Please request a new code.',
  },
  AUTH_USER_NOT_FOUND: { fr: 'Utilisateur introuvable', en: 'User not found' },
  INVALID_CODE: { fr: 'Code de verification invalide', en: 'Invalid verification code' },
  INVALID_CURRENT_PASSWORD: {
    fr: 'Mot de passe actuel incorrect',
    en: 'Current password is incorrect',
  },
  INVALID_PASSWORD: { fr: 'Mot de passe incorrect', en: 'Incorrect password' },
  PASSWORD_RECENTLY_USED: {
    fr: 'Ce mot de passe a ete utilise recemment. Choisissez-en un autre.',
    en: 'This password was used recently. Please choose a different one.',
  },
  PASSWORD_REQUIRED: {
    fr: 'Mot de passe requis pour supprimer le compte',
    en: 'Password required to delete the account',
  },
  WEAK_PASSWORD: {
    fr: 'Mot de passe non conforme aux exigences de securite',
    en: 'Password does not meet the security requirements',
  },

  // — Acces reseau et portails ———————————————————————————————————
  CSRF_ORIGIN_REJECTED: { fr: 'Origine non autorisee', en: 'Origin not allowed' },
  IP_BLOCKED: {
    fr: 'Acces temporairement bloque. Contactez le support.',
    en: 'Access temporarily blocked. Please contact support.',
  },
  IP_NOT_ALLOWED: { fr: 'Acces refuse depuis ce reseau', en: 'Access denied from this network' },
  STATE_ACCESS_DENIED: { fr: 'Acces au portail Etat refuse', en: 'State portal access denied' },
  STATE_AUTH_FAILED: { fr: 'Authentification echouee', en: 'Authentication failed' },
  STATE_AUTH_REQUIRED: { fr: 'Authentification requise', en: 'Authentication required' },
  UNAUTHORIZED: { fr: 'Acces refuse', en: 'Access denied' },

  // — KYC / KYB ——————————————————————————————————————————————————
  ALREADY_VERIFIED: {
    fr: 'Dossier deja valide — contactez le support pour le modifier',
    en: 'Record already approved — contact support to change it',
  },
  DOCUMENTS_REQUIRED: {
    fr: 'Veuillez d’abord televerser vos documents',
    en: 'Please upload your documents first',
  },
  KYC_ALREADY_APPROVED: {
    fr: 'Votre verification est deja approuvee',
    en: 'Your verification is already approved',
  },
  KYC_ALREADY_PENDING: {
    fr: 'Une demande de verification est deja en cours',
    en: 'A verification request is already in progress',
  },
  KYC_ALREADY_VERIFIED: { fr: 'Verification deja effectuee', en: 'Already verified' },
  KYC_DOCUMENT_NOT_FOUND: { fr: 'Document introuvable', en: 'Document not found' },
  KYC_DOCUMENT_TYPE_UNSUPPORTED: {
    fr: (p: ParamsErreur['KYC_DOCUMENT_TYPE_UNSUPPORTED']) =>
      `Ce type de document n’est pas accepte pour ${p.pays}. Documents acceptes : ${p.acceptes.join(', ')}.`,
    en: (p: ParamsErreur['KYC_DOCUMENT_TYPE_UNSUPPORTED']) =>
      `This document type is not accepted for ${p.pays}. Accepted documents: ${p.acceptes.join(', ')}.`,
  },
  KYC_LEVEL_INSUFFICIENT: {
    fr: (p: ParamsErreur['KYC_LEVEL_INSUFFICIENT']) => OPERATIONS_KYC[p.operation].fr,
    en: (p: ParamsErreur['KYC_LEVEL_INSUFFICIENT']) => OPERATIONS_KYC[p.operation].en,
  },
  KYC_PENDING: {
    fr: 'Une demande de verification est deja en cours',
    en: 'A verification request is already in progress',
  },
  INVALID_DOCUMENT_KEY: { fr: 'Reference de document invalide', en: 'Invalid document reference' },
  INVALID_DOCUMENT_TYPE: {
    fr: 'Type de document invalide (recto, verso, selfie)',
    en: 'Invalid document type (front, back, selfie)',
  },
  INVALID_PHOTO_KEY: { fr: 'Reference de photo invalide', en: 'Invalid photo reference' },
  REGISTRATION_REQUIRED: {
    fr: 'Numero RCCM requis pour une cooperative ou une societe',
    en: 'A trade-register number is required for a cooperative or a company',
  },

  // — Fichiers ———————————————————————————————————————————————————
  FILE_TOO_LARGE: {
    fr: (p: ParamsErreur['FILE_TOO_LARGE']) => `Fichier trop volumineux (max ${p.maxMo} Mo)`,
    en: (p: ParamsErreur['FILE_TOO_LARGE']) => `File too large (max ${p.maxMo} MB)`,
  },
  INVALID_FILE_TYPE: {
    fr: 'Format de fichier non supporte',
    en: 'Unsupported file format',
  },

  // — Marche et transactions —————————————————————————————————————
  MARKET_PRICE_UNAVAILABLE: {
    fr: 'Prix du marche temporairement indisponible',
    en: 'Market price temporarily unavailable',
  },
  PRICE_FETCH_FAILED: {
    fr: 'Prix de l’or indisponible',
    en: 'Gold price unavailable',
  },
  TRADING_AMOUNT_TOO_SMALL: {
    fr: (p: ParamsErreur['TRADING_AMOUNT_TOO_SMALL']) =>
      p.plancher
        ? `Montant trop faible : il faut au moins ${nombre(p.plancher.montant, 'fr')} ${p.plancher.devise} pour ${p.grammesMinimum} g au cours actuel.`
        : `Quantite nulle apres arrondi au milligramme. Minimum : ${p.grammesMinimum} g.`,
    en: (p: ParamsErreur['TRADING_AMOUNT_TOO_SMALL']) =>
      p.plancher
        ? `Amount too small: at least ${nombre(p.plancher.montant, 'en')} ${p.plancher.devise} is needed for ${p.grammesMinimum} g at the current price.`
        : `Quantity rounds down to zero at milligram precision. Minimum: ${p.grammesMinimum} g.`,
  },
  TRADING_CONFLICT: {
    fr: 'Transaction non aboutie, veuillez reessayer.',
    en: 'The transaction did not complete, please try again.',
  },
  TRADING_INSUFFICIENT_BALANCE: {
    fr: 'Solde insuffisant. Veuillez recharger votre compte.',
    en: 'Insufficient balance. Please top up your account.',
  },
  TRADING_INSUFFICIENT_STOCK: {
    fr: 'Stock insuffisant pour cette transaction',
    en: 'Not enough stock for this transaction',
  },
  TRADING_INVALID_AMOUNT: { fr: 'Montant de transaction invalide', en: 'Invalid transaction amount' },
  TRADING_INVALID_QUOTE_TYPE: {
    fr: (p: ParamsErreur['TRADING_INVALID_QUOTE_TYPE']) =>
      p.attendu === 'achat'
        ? 'Ce devis n’est pas un devis d’achat'
        : 'Ce devis n’est pas un devis de vente',
    en: (p: ParamsErreur['TRADING_INVALID_QUOTE_TYPE']) =>
      p.attendu === 'achat' ? 'This quote is not a buy quote' : 'This quote is not a sell quote',
  },
  TRADING_LIMIT_EXCEEDED: {
    fr: (p: ParamsErreur['TRADING_LIMIT_EXCEEDED']) =>
      p.periode === 'jour'
        ? `Limite journaliere depassee. Maximum ${p.limiteG} g par jour.`
        : `Limite mensuelle depassee. Maximum ${p.limiteG} g par mois.`,
    en: (p: ParamsErreur['TRADING_LIMIT_EXCEEDED']) =>
      p.periode === 'jour'
        ? `Daily limit exceeded. Maximum ${p.limiteG} g per day.`
        : `Monthly limit exceeded. Maximum ${p.limiteG} g per month.`,
  },
  TRADING_PRICE_EXPIRED: {
    fr: 'Devis expire ou invalide. Demandez un nouveau devis.',
    en: 'Quote expired or invalid. Please request a new one.',
  },
  TRANSACTION_ACCESS_DENIED: { fr: 'Acces refuse', en: 'Access denied' },
  TRANSACTION_LOCKED: {
    fr: 'Une operation est deja en cours',
    en: 'An operation is already in progress',
  },
  TRANSACTION_NOT_FOUND: { fr: 'Transaction introuvable', en: 'Transaction not found' },

  // — Portefeuille, depots, retraits ——————————————————————————————
  AMOUNT_TOO_LOW: {
    fr: (p: ParamsErreur['AMOUNT_TOO_LOW']) =>
      `Depot minimum : ${nombre(p.minimum, 'fr')} ${p.devise}`,
    en: (p: ParamsErreur['AMOUNT_TOO_LOW']) =>
      `Minimum deposit: ${nombre(p.minimum, 'en')} ${p.devise}`,
  },
  CANNOT_CANCEL: {
    fr: 'Ce depot est deja en cours de traitement et ne peut plus etre annule',
    en: 'This deposit is already being processed and can no longer be cancelled',
  },
  DEPOSIT_NOT_FOUND: { fr: 'Depot introuvable', en: 'Deposit not found' },
  NO_TOKENS: {
    fr: 'Vous n’avez aucun gramme a certifier',
    en: 'You have no grams to certify',
  },
  PAYMENT_ERROR: {
    fr: 'Le paiement n’a pas pu etre initialise',
    en: 'The payment could not be initialised',
  },
  PAYMENT_INIT_FAILED: {
    fr: 'Le paiement n’a pas pu etre initialise',
    en: 'The payment could not be initialised',
  },
  PAYOUT_FAILED: {
    fr: 'Le versement n’a pas pu etre effectue',
    en: 'The payout could not be completed',
  },
  PHONE_REQUIRED: {
    fr: 'Numero de telephone requis pour le paiement mobile',
    en: 'A phone number is required for mobile payment',
  },
  WALLET_NOT_FOUND: { fr: 'Portefeuille introuvable', en: 'Wallet not found' },
  WITHDRAWAL_ALREADY_PROCESSED: {
    fr: 'Ce retrait a deja ete traite',
    en: 'This withdrawal has already been processed',
  },
  WITHDRAWAL_LIMIT_EXCEEDED: {
    fr: (p: ParamsErreur['WITHDRAWAL_LIMIT_EXCEEDED']) =>
      `Limite de retrait journaliere depassee. Maximum ${nombre(p.plafond, 'fr')} ${p.devise} par jour.`,
    en: (p: ParamsErreur['WITHDRAWAL_LIMIT_EXCEEDED']) =>
      `Daily withdrawal limit exceeded. Maximum ${nombre(p.plafond, 'en')} ${p.devise} per day.`,
  },
  WITHDRAWAL_NOT_FOUND: { fr: 'Retrait introuvable', en: 'Withdrawal not found' },
  WITHDRAWAL_PENDING: {
    fr: 'Un retrait est deja en cours de traitement',
    en: 'A withdrawal is already being processed',
  },

  // — Filiere or —————————————————————————————————————————————————
  ALREADY_ATTACHED: {
    fr: 'Ce document est deja rattache a un lot',
    en: 'This document is already attached to a consignment',
  },
  NOT_A_PRODUCER: { fr: 'Acces reserve aux producteurs', en: 'Producers only' },
  NOT_SETTLED: {
    fr: 'Ce lot n’est pas encore regle',
    en: 'This consignment is not settled yet',
  },
  INVALID_TRANSITION: {
    fr: (p: ParamsErreur['INVALID_TRANSITION']) =>
      p.dejaTraite
        ? `Dossier deja traite (${p.depuis})`
        : `Transition invalide depuis l’etat ${p.depuis}`,
    en: (p: ParamsErreur['INVALID_TRANSITION']) =>
      p.dejaTraite
        ? `Record already processed (${p.depuis})`
        : `Invalid transition from state ${p.depuis}`,
  },

  // — Preuve de reserve et certificats ————————————————————————————
  CERTIFICATE_ACCESS_DENIED: { fr: 'Acces refuse', en: 'Access denied' },
  CERTIFICATE_INVALID: { fr: 'Certificat invalide', en: 'Invalid certificate' },
  CERTIFICATE_NOT_FOUND: {
    fr: 'Certificat introuvable ou expire',
    en: 'Certificate not found or expired',
  },
  EXPORT_NOT_TRACEABLE: {
    fr: 'Export impossible : la tracabilite ne peut pas etre etablie',
    en: 'Export refused: traceability cannot be established',
  },
  INVALID_DIGEST: { fr: 'Empreinte invalide', en: 'Invalid digest' },
  NOT_CONFIGURED: {
    fr: 'Aucune cle de verification publiee',
    en: 'No verification key published',
  },

  // — Administration des utilisateurs —————————————————————————————
  INVALID_ACTION: {
    fr: 'Action invalide. Utilisez « approve » ou « reject ».',
    en: 'Invalid action. Use "approve" or "reject".',
  },
  TOO_MANY_USERS: {
    fr: (p: ParamsErreur['TOO_MANY_USERS']) => `Maximum ${p.max} utilisateurs par requete`,
    en: (p: ParamsErreur['TOO_MANY_USERS']) => `At most ${p.max} users per request`,
  },
  USER_ALREADY_SUSPENDED: { fr: 'Utilisateur deja suspendu', en: 'User already suspended' },
  USER_NOT_FOUND: { fr: 'Utilisateur introuvable', en: 'User not found' },
  USER_NOT_SUSPENDED: { fr: 'Utilisateur non suspendu', en: 'User is not suspended' },
  STOCK_BELOW_ISSUED: {
    fr: (p: ParamsErreur['STOCK_BELOW_ISSUED']) =>
      p.emisG === undefined
        ? 'Ajustement impossible : un autre ajustement vient de modifier le stock. Reessayez.'
        : `Ajustement impossible : ${nombre(p.emisG, 'fr')} g sont deja emis, l’allocation ne peut pas descendre en dessous.`,
    en: (p: ParamsErreur['STOCK_BELOW_ISSUED']) =>
      p.emisG === undefined
        ? 'Adjustment refused: another adjustment just changed the stock. Please try again.'
        : `Adjustment refused: ${nombre(p.emisG, 'en')} g are already issued, the allocation cannot go below that.`,
  },

  // — Initialisation de la plateforme —————————————————————————————
  ALREADY_INITIALIZED: {
    fr: 'Les administrateurs sont deja initialises',
    en: 'Administrators are already initialised',
  },
  FORBIDDEN_IN_PRODUCTION: {
    fr: 'Operation interdite en production',
    en: 'Operation forbidden in production',
  },
  SEED_FAILED: {
    fr: 'L’initialisation des donnees a echoue',
    en: 'Data seeding failed',
  },
  SETUP_DISABLED: { fr: 'Initialisation indisponible', en: 'Setup unavailable' },
  SETUP_EXPIRED: {
    fr: 'Session d’initialisation expiree. Recommencez.',
    en: 'Setup session expired. Please start again.',
  },
  SETUP_FAILED: { fr: 'L’initialisation a echoue', en: 'Setup failed' },
  SETUP_TOKEN_EXPIRED: {
    fr: 'Session d’initialisation expiree. Reconnectez-vous.',
    en: 'Setup session expired. Please sign in again.',
  },

  // — Generiques —————————————————————————————————————————————————
  ANALYTICS_ERROR: {
    fr: 'Les indicateurs sont momentanement indisponibles',
    en: 'Metrics are temporarily unavailable',
  },
  CONFIG_ERROR: {
    fr: 'Service mal configure',
    en: 'Service misconfigured',
  },
  CONFLICT: {
    fr: 'Operation non aboutie, veuillez reessayer.',
    en: 'The operation did not complete, please try again.',
  },
  ENCRYPTION_UNAVAILABLE: {
    fr: 'Service temporairement indisponible. Reessayez plus tard.',
    en: 'Service temporarily unavailable. Please try again later.',
  },
  /**
   * UN SEUL MESSAGE, DELIBEREMENT (ADR 025).
   *
   * Ce code portait une cinquantaine de phrases nommant l'etape interne ayant
   * echoue — « Erreur lors du chargement des logs d'audit ». Elles renseignent
   * un appelant sur la structure de la plateforme sans lui servir a rien. Le
   * detail part dans les journaux ; le `requestId` reste le lien avec le
   * support.
   */
  INTERNAL_ERROR: {
    fr: 'Une erreur interne est survenue. Reessayez, ou contactez le support avec le numero de requete.',
    en: 'An internal error occurred. Please retry, or contact support with the request id.',
  },
  INVALID_INPUT: { fr: 'Donnees invalides', en: 'Invalid input' },
  NOTIFICATION_NOT_FOUND: { fr: 'Notification introuvable', en: 'Notification not found' },
  NOT_FOUND: {
    fr: (p: ParamsErreur['NOT_FOUND']) => RESSOURCES[p.ressource].fr,
    en: (p: ParamsErreur['NOT_FOUND']) => RESSOURCES[p.ressource].en,
  },
  RATE_LIMITED: {
    fr: 'Trop de requetes. Reessayez plus tard.',
    en: 'Too many requests. Please try again later.',
  },
  RATE_LIMIT_EXCEEDED: {
    fr: 'Trop de requetes. Reessayez dans quelques instants.',
    en: 'Too many requests. Please try again shortly.',
  },
  SERVICE_UNAVAILABLE: {
    fr: 'Service temporairement indisponible. Veuillez reessayer.',
    en: 'Service temporarily unavailable. Please try again.',
  },
  VALIDATION_ERROR: { fr: 'Donnees invalides', en: 'Invalid data' },
  WEBSOCKET_REQUIRED: {
    fr: 'Cette adresse requiert une connexion WebSocket',
    en: 'This endpoint requires a WebSocket connection',
  },
} satisfies Record<string, Entree>;

export type CodeErreur = keyof typeof MESSAGES;

/** Les codes du catalogue, pour le garde-fou `check:messages`. */
export const CODES_ERREUR = Object.keys(MESSAGES) as CodeErreur[];

/** Un code du catalogue ? */
export function estCodeConnu(code: string): code is CodeErreur {
  return Object.prototype.hasOwnProperty.call(MESSAGES, code);
}

type CodesAvecParams = keyof ParamsErreur;
type CodesSansParams = Exclude<CodeErreur, CodesAvecParams>;

/**
 * Le message d'un code, dans une langue.
 *
 * Les surcharges rendent l'oubli d'un parametre impossible a compiler : un code
 * declare dans `ParamsErreur` en exige un, les autres n'en acceptent pas.
 */
export function messageErreur<C extends CodesAvecParams>(
  code: C,
  langue: Langue,
  params: ParamsErreur[C]
): string;
export function messageErreur(code: CodesSansParams, langue: Langue): string;
export function messageErreur(code: CodeErreur, langue: Langue, params?: unknown): string {
  const entree = MESSAGES[code] as { fr: unknown; en: unknown };
  const texte = langue === 'en' ? entree.en : entree.fr;
  return typeof texte === 'function' ? (texte as (p: unknown) => string)(params) : (texte as string);
}
