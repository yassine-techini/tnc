/**
 * TNC Trading - Business Constants
 * Constantes métier pour la plateforme de tokenisation d'or
 */

// ============================================
// GENERAL
// ============================================
export const APP_NAME = 'TNC Trading';
export const APP_VERSION = '1.0.0';
export const DEFAULT_COUNTRY = 'BF'; // Burkina Faso
export const DEFAULT_CURRENCY = 'XOF';
export const DEFAULT_LANGUAGE = 'fr';

// ============================================
// GOLD & PRICING
// ============================================
export const GOLD_UNIT = 'gram'; // 1 token = 1 gramme
export const GOLD_PRECISION = 3; // 3 décimales (0.001g minimum)
export const CASH_PRECISION = 0; // XOF sans décimales

// Spreads par défaut (2%)
export const DEFAULT_SPREAD_BUY = 0.02;
export const DEFAULT_SPREAD_SELL = 0.02;

// Taux de change USD/XOF (fixe car CFA arrimé à l'Euro)
export const DEFAULT_USD_XOF_RATE = 615;

// Validité d'un devis (secondes)
export const QUOTE_VALIDITY_SECONDS = 60;

// Intervalle de mise à jour du prix (secondes)
export const PRICE_UPDATE_INTERVAL_SECONDS = 60;

// ============================================
// KYC LEVELS & LIMITS
// ============================================
export const KYC_LEVELS = {
  BASIC: 'BASIC',
  STANDARD: 'STANDARD',
  VERIFIED: 'VERIFIED',
} as const;

export type KycLevel = (typeof KYC_LEVELS)[keyof typeof KYC_LEVELS];

export const KYC_STATUSES = {
  PENDING: 'PENDING',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
} as const;

export type KycStatus = (typeof KYC_STATUSES)[keyof typeof KYC_STATUSES];

export const KYC_LIMITS = {
  BASIC: {
    dailyBuyGrams: 0,
    monthlyBuyGrams: 0,
    canSell: false,
    dailyWithdrawXof: 0,
  },
  STANDARD: {
    dailyBuyGrams: 100,
    monthlyBuyGrams: 500,
    canSell: true,
    dailyWithdrawXof: 500_000,
  },
  VERIFIED: {
    dailyBuyGrams: 1_000,
    monthlyBuyGrams: 5_000,
    canSell: true,
    dailyWithdrawXof: 5_000_000,
  },
} as const;

// Documents acceptés pour le KYC
export const KYC_DOCUMENT_TYPES = {
  CNIB: 'CNIB', // Carte Nationale d'Identité Burkinabè
  PASSPORT: 'PASSPORT',
  PERMIT: 'PERMIT', // Permis de conduire
  CEDEAO: 'CEDEAO', // Carte CEDEAO
} as const;

export type KycDocumentType = (typeof KYC_DOCUMENT_TYPES)[keyof typeof KYC_DOCUMENT_TYPES];

// Durée de validité des documents KYC (5 ans)
export const KYC_DOCUMENT_VALIDITY_YEARS = 5;

// ============================================
// TRANSACTIONS
// ============================================
export const TRANSACTION_TYPES = {
  BUY: 'BUY',
  SELL: 'SELL',
  DEPOSIT: 'DEPOSIT',
  WITHDRAWAL: 'WITHDRAWAL',
  FEE: 'FEE',
} as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[keyof typeof TRANSACTION_TYPES];

export const TRANSACTION_STATUSES = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[keyof typeof TRANSACTION_STATUSES];

// Montants minimum
export const MIN_BUY_GRAMS = 1;
export const MIN_SELL_GRAMS = 1;
export const MIN_DEPOSIT_XOF = 1_000;
export const MIN_WITHDRAWAL_XOF = 1_000;

// ============================================
// FEES
// ============================================
// Frais de garde annuels (prélevés mensuellement)
export const STORAGE_FEE_ANNUAL_PERCENT = 0.5;
export const STORAGE_FEE_MONTHLY_PERCENT = STORAGE_FEE_ANNUAL_PERCENT / 12;

// Frais de retrait
export const WITHDRAWAL_FEE_MOBILE_MONEY_PERCENT = 1;
export const WITHDRAWAL_FEE_MOBILE_MONEY_MIN_XOF = 500;
export const WITHDRAWAL_FEE_BANK_PERCENT = 0.5;
export const WITHDRAWAL_FEE_BANK_MIN_XOF = 1_000;

// ============================================
// PAYMENT METHODS
// ============================================
export const PAYMENT_METHODS = {
  ORANGE_MONEY: 'orange_money',
  MOOV_MONEY: 'moov_money',
  CINETPAY: 'cinetpay',
  CARD: 'card',
  BANK_TRANSFER: 'bank_transfer',
} as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[keyof typeof PAYMENT_METHODS];

// Méthodes disponibles pour le dépôt
export const DEPOSIT_METHODS = [
  PAYMENT_METHODS.ORANGE_MONEY,
  PAYMENT_METHODS.MOOV_MONEY,
  PAYMENT_METHODS.CINETPAY,
] as const;

// Méthodes disponibles pour le retrait
export const WITHDRAWAL_METHODS = [
  PAYMENT_METHODS.ORANGE_MONEY,
  PAYMENT_METHODS.MOOV_MONEY,
  PAYMENT_METHODS.BANK_TRANSFER,
] as const;

// Délais de traitement
export const WITHDRAWAL_DELAY = {
  [PAYMENT_METHODS.ORANGE_MONEY]: 0, // Instantané
  [PAYMENT_METHODS.MOOV_MONEY]: 0, // Instantané
  [PAYMENT_METHODS.BANK_TRANSFER]: 48 * 60 * 60, // 24-48h en secondes
} as const;

// ============================================
// AUTHENTICATION & SECURITY
// ============================================
// Sessions
export const SESSION_TIMEOUT_MINUTES = 30;
export const REFRESH_TOKEN_DAYS = 7;
export const ACCESS_TOKEN_MINUTES = 15;

// Rate limiting
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MINUTES = 15;
export const RATE_LIMIT_REQUESTS_PER_MINUTE = 100;
export const RATE_LIMIT_REQUESTS_PER_MINUTE_AUTH = 1000;

// Mot de passe
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_REQUIRE_UPPERCASE = true;
export const PASSWORD_REQUIRE_LOWERCASE = true;
export const PASSWORD_REQUIRE_NUMBER = true;
export const PASSWORD_REQUIRE_SPECIAL = true;

// 2FA
export const TWO_FACTOR_CODE_LENGTH = 6;
export const TWO_FACTOR_CODE_VALIDITY_SECONDS = 30;

// Vérification email/téléphone
export const VERIFICATION_CODE_LENGTH = 6;
export const VERIFICATION_CODE_VALIDITY_MINUTES = 15;

// ============================================
// STOCK & RESERVE
// ============================================
// Alerte si stock disponible < ce pourcentage
export const STOCK_LOW_ALERT_PERCENT = 10;

// Proof of Reserve
export const POR_GENERATION_INTERVAL_DAYS = 30;

// ============================================
// NOTIFICATIONS
// ============================================
export const NOTIFICATION_TYPES = {
  // Auth
  EMAIL_VERIFICATION: 'email_verification',
  PHONE_VERIFICATION: 'phone_verification',
  PASSWORD_RESET: 'password_reset',
  LOGIN_NEW_DEVICE: 'login_new_device',
  
  // KYC
  KYC_SUBMITTED: 'kyc_submitted',
  KYC_APPROVED: 'kyc_approved',
  KYC_REJECTED: 'kyc_rejected',
  KYC_EXPIRING: 'kyc_expiring',
  
  // Transactions
  BUY_COMPLETED: 'buy_completed',
  SELL_COMPLETED: 'sell_completed',
  DEPOSIT_COMPLETED: 'deposit_completed',
  WITHDRAWAL_INITIATED: 'withdrawal_initiated',
  WITHDRAWAL_COMPLETED: 'withdrawal_completed',
  WITHDRAWAL_REJECTED: 'withdrawal_rejected',
  
  // System
  PRICE_ALERT: 'price_alert',
  MAINTENANCE: 'maintenance',
} as const;

// ============================================
// ADMIN ROLES
// ============================================
export const ADMIN_ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  KYC_REVIEWER: 'kyc_reviewer',
  FINANCE: 'finance',
  SUPPORT: 'support',
  READ_ONLY: 'read_only',
} as const;

export type AdminRole = (typeof ADMIN_ROLES)[keyof typeof ADMIN_ROLES];

// ============================================
// ERROR CODES
// ============================================
export const ERROR_CODES = {
  // Auth
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_ACCOUNT_LOCKED: 'AUTH_ACCOUNT_LOCKED',
  AUTH_ACCOUNT_DISABLED: 'AUTH_ACCOUNT_DISABLED',
  AUTH_2FA_REQUIRED: 'AUTH_2FA_REQUIRED',
  AUTH_2FA_INVALID: 'AUTH_2FA_INVALID',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_EMAIL_NOT_VERIFIED: 'AUTH_EMAIL_NOT_VERIFIED',
  AUTH_PHONE_NOT_VERIFIED: 'AUTH_PHONE_NOT_VERIFIED',
  
  // KYC
  KYC_LEVEL_INSUFFICIENT: 'KYC_LEVEL_INSUFFICIENT',
  KYC_DOCUMENT_INVALID: 'KYC_DOCUMENT_INVALID',
  KYC_DOCUMENT_EXPIRED: 'KYC_DOCUMENT_EXPIRED',
  KYC_VERIFICATION_PENDING: 'KYC_VERIFICATION_PENDING',
  KYC_VERIFICATION_FAILED: 'KYC_VERIFICATION_FAILED',
  
  // Trading
  TRADING_INSUFFICIENT_STOCK: 'TRADING_INSUFFICIENT_STOCK',
  TRADING_INSUFFICIENT_BALANCE: 'TRADING_INSUFFICIENT_BALANCE',
  TRADING_LIMIT_EXCEEDED: 'TRADING_LIMIT_EXCEEDED',
  TRADING_DAILY_LIMIT_EXCEEDED: 'TRADING_DAILY_LIMIT_EXCEEDED',
  TRADING_MONTHLY_LIMIT_EXCEEDED: 'TRADING_MONTHLY_LIMIT_EXCEEDED',
  TRADING_PRICE_EXPIRED: 'TRADING_PRICE_EXPIRED',
  TRADING_QUOTE_EXPIRED: 'TRADING_QUOTE_EXPIRED',
  TRADING_QUOTE_INVALID: 'TRADING_QUOTE_INVALID',
  
  // Payment
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_CANCELLED: 'PAYMENT_CANCELLED',
  PAYMENT_PROVIDER_ERROR: 'PAYMENT_PROVIDER_ERROR',
  PAYMENT_METHOD_UNAVAILABLE: 'PAYMENT_METHOD_UNAVAILABLE',
  
  // Withdrawal
  WITHDRAWAL_LIMIT_EXCEEDED: 'WITHDRAWAL_LIMIT_EXCEEDED',
  WITHDRAWAL_PENDING: 'WITHDRAWAL_PENDING',
  WITHDRAWAL_FAILED: 'WITHDRAWAL_FAILED',
  
  // General
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// Messages d'erreur en français
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  // Auth
  AUTH_INVALID_CREDENTIALS: 'Email ou mot de passe incorrect',
  AUTH_ACCOUNT_LOCKED: 'Compte temporairement bloqué. Réessayez dans 15 minutes.',
  AUTH_ACCOUNT_DISABLED: 'Compte désactivé. Contactez le support.',
  AUTH_2FA_REQUIRED: 'Code de vérification requis',
  AUTH_2FA_INVALID: 'Code de vérification invalide',
  AUTH_TOKEN_EXPIRED: 'Session expirée. Veuillez vous reconnecter.',
  AUTH_TOKEN_INVALID: 'Session invalide. Veuillez vous reconnecter.',
  AUTH_EMAIL_NOT_VERIFIED: 'Veuillez vérifier votre adresse email',
  AUTH_PHONE_NOT_VERIFIED: 'Veuillez vérifier votre numéro de téléphone',
  
  // KYC
  KYC_LEVEL_INSUFFICIENT: 'Niveau de vérification insuffisant pour cette opération',
  KYC_DOCUMENT_INVALID: 'Document non reconnu ou illisible',
  KYC_DOCUMENT_EXPIRED: 'Document expiré. Veuillez soumettre un document valide.',
  KYC_VERIFICATION_PENDING: 'Vérification en cours. Veuillez patienter.',
  KYC_VERIFICATION_FAILED: 'Vérification échouée. Veuillez réessayer.',
  
  // Trading
  TRADING_INSUFFICIENT_STOCK: 'Stock insuffisant',
  TRADING_INSUFFICIENT_BALANCE: 'Solde insuffisant',
  TRADING_LIMIT_EXCEEDED: 'Limite dépassée',
  TRADING_DAILY_LIMIT_EXCEEDED: 'Limite journalière dépassée',
  TRADING_MONTHLY_LIMIT_EXCEEDED: 'Limite mensuelle dépassée',
  TRADING_PRICE_EXPIRED: 'Prix expiré. Veuillez actualiser.',
  TRADING_QUOTE_EXPIRED: 'Devis expiré. Veuillez en demander un nouveau.',
  TRADING_QUOTE_INVALID: 'Devis invalide',
  
  // Payment
  PAYMENT_FAILED: 'Paiement échoué',
  PAYMENT_CANCELLED: 'Paiement annulé',
  PAYMENT_PROVIDER_ERROR: 'Erreur du service de paiement. Réessayez plus tard.',
  PAYMENT_METHOD_UNAVAILABLE: 'Méthode de paiement indisponible',
  
  // Withdrawal
  WITHDRAWAL_LIMIT_EXCEEDED: 'Limite de retrait dépassée',
  WITHDRAWAL_PENDING: 'Un retrait est déjà en cours',
  WITHDRAWAL_FAILED: 'Retrait échoué',
  
  // General
  VALIDATION_ERROR: 'Données invalides',
  NOT_FOUND: 'Ressource non trouvée',
  FORBIDDEN: 'Accès non autorisé',
  RATE_LIMITED: 'Trop de requêtes. Veuillez patienter.',
  INTERNAL_ERROR: 'Erreur interne. Veuillez réessayer.',
  SERVICE_UNAVAILABLE: 'Service temporairement indisponible',
};

// ============================================
// PHONE FORMATS
// ============================================
export const PHONE_COUNTRY_CODES = {
  BF: '+226', // Burkina Faso
} as const;

// Regex pour valider les numéros de téléphone burkinabè
export const PHONE_REGEX_BF = /^\+226[567]\d{7}$/;

// ============================================
// DATE FORMATS
// ============================================
export const DATE_FORMAT = 'DD/MM/YYYY';
export const DATETIME_FORMAT = 'DD/MM/YYYY HH:mm';
export const TIME_FORMAT = 'HH:mm';

// Timezone Burkina Faso (GMT)
export const TIMEZONE = 'Africa/Ouagadougou';

// ============================================
// SUPPORT
// ============================================
export const SUPPORT_HOURS = {
  start: 8, // 8h GMT
  end: 20, // 20h GMT
};

export const SUPPORT_EMAIL = 'support@tnc-trading.com';
export const SUPPORT_PHONE = '+226XXXXXXXX';
