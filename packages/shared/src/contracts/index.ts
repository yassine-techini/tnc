/**
 * Contrats de réponse de l'API — la forme du champ `data`.
 *
 * POURQUOI CE MODULE EXISTE.
 *
 * Les quatre clients (web, admin, mobile, portail État) déclaraient chacun à la
 * main ce qu'ils croyaient recevoir, sans aucun lien de compilation avec les
 * routes. Cinq défauts en sont sortis, tous du même moule et tous invisibles au
 * compilateur, parce que le mensonge vivait dans le paramètre de type du
 * client :
 *
 *   - le tableau de bord de l'État affichait 0 g de réserve nationale ;
 *   - son rapport de preuve de réserve affichait 0 g et un audit « En attente »
 *     permanent ;
 *   - son rapport mensuel affichait zéro partout sauf les nouveaux utilisateurs ;
 *   - l'activation 2FA était impossible sur le web ;
 *   - le graphique de prix mobile était vide, et fabriquait des prix aléatoires
 *     pour masquer ce vide.
 *
 * COMMENT CE MODULE FERME LA CATÉGORIE.
 *
 * Un contrat est déclaré ICI, puis utilisé DES DEUX CÔTÉS :
 *
 *   route   →  c.json({ success: true, data: { … } satisfies StateStockData, … })
 *   client  →  this.request<StateStockData>('/api/v1/state/stock')
 *
 * `satisfies` fait échouer la compilation de l'API si un champ manque ou change
 * de nom ; le client importe le même type, donc le renommage casse aussi chez
 * lui. Les deux côtés ne peuvent plus diverger en silence — ce qui était
 * exactement le défaut.
 *
 * PORTÉE ACTUELLE : les endpoints qui ont réellement produit un défaut. Étendre
 * un contrat est une addition, jamais une refonte — voir docs/RESTE-A-FAIRE.md.
 */

// ─────────────────────────────────────────────────────────────
// Portail État
// ─────────────────────────────────────────────────────────────

/** `GET /api/v1/state/dashboard` */
export interface StateDashboardData {
  totalUsers: number;
  totalTokens: number;
  totalVolume: number;
  goldAllocated: number;
  /** Or prêté, donc absent du coffre. Divulgué ici comme sur /reserve. */
  goldOnLoan: number;
  goldVaulted: number;
  fullyVaulted: boolean;
  coverageRatio: number;
  monthlyVolume: number;
  lastUpdate: string;
}

/** `GET /api/v1/state/stock` */
export interface StateStockData {
  totalAllocated: number;
  tokensIssued: number;
  availableStock: number;
  goldOnLoan: number;
  goldVaulted: number;
  fullyVaulted: boolean;
  /** Avertissement en clair sur le prêt — affiché tel quel, jamais reformulé. */
  lendingNotice: string;
  coverageRatio: number;
  lastAuditDate: string | null;
  lastAuditResult: string | null;
}

export interface WalletDistributionBucket {
  range: string;
  count: number;
}

export interface TransactionSummaryRow {
  type: string;
  count: number;
  total: number;
}

/** `GET /api/v1/state/reports/por` */
export interface StateProofOfReserveData {
  reportDate: string;
  goldAllocated: number;
  tokensInCirculation: number;
  coverageRatio: number;
  lastAuditDate: string | null;
  lastAuditResult: string | null;
  /** CERTIFIED | PENDING_AUDIT | UNDER_COLLATERALIZED */
  certificationStatus: string;
  walletDistribution: WalletDistributionBucket[];
  transactionSummary: TransactionSummaryRow[];
}

export interface MonthlyTransactionStat {
  type: string;
  count: number;
  total_cash: number;
  total_tokens: number;
  total_fees: number;
}

/**
 * `GET /api/v1/state/reports/monthly`
 *
 * Les totaux ne sont PAS pré-calculés : ils se dérivent de `transactionStats`.
 * Le client prétendait recevoir totalTransactions, totalVolume, buyVolume,
 * sellVolume et fees — d'où un écran à zéro.
 */
export interface StateMonthlyReportData {
  month: string;
  reportGeneratedAt: string;
  transactionStats: MonthlyTransactionStat[];
  newUsers: number;
  /** COUNT(DISTINCT …) : un agrégat, jamais une liste de comptes. */
  activeUsers: number;
  /** null quand aucun prix n'a été relevé ce mois-là — pas zéro. */
  averagePrice: number | null;
  kycStats: Array<{ kyc_level: string; count: number }>;
  stockStatus: {
    goldAllocated: number;
    tokensInCirculation: number;
    coverageRatio: number;
  };
}

// ─────────────────────────────────────────────────────────────
// Portefeuille — le chemin de l'argent
// ─────────────────────────────────────────────────────────────

/** `GET /api/v1/wallet` */
export interface WalletData {
  id: string;
  userId: string;
  /** Grammes détenus. Exclut ce qui est placé en location. */
  tokenBalance: number;
  cashBalance: number;
  estimatedValue: number;
  averageBuyPrice: number;
  profitLoss: number;
  profitLossPercent: number;
  createdAt: string;
  updatedAt: string;
}

export interface WalletTransaction {
  id: string;
  type: string;
  status: string;
  tokenAmount: number | null;
  cashAmount: number;
  pricePerGram: number | null;
  fees: number | null;
  paymentMethod: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** `GET /api/v1/wallet/transactions` */
export interface WalletTransactionsData {
  items: WalletTransaction[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/** `POST /api/v1/wallet/deposit` */
export interface DepositData {
  transactionId: string;
  amount: number;
  paymentMethod: string;
  /** Absent selon le prestataire : certains renvoient un code USSD à la place. */
  paymentUrl?: string;
  paymentToken?: string;
  ussdCode?: string;
  status: string;
  expiresIn: number;
}

/** `POST /api/v1/wallet/withdraw` */
export interface WithdrawData {
  withdrawalId: string;
  transactionId: string;
  amount: number;
  fees: number;
  netAmount: number;
  paymentMethod: string;
  status: string;
  /** Délai indicatif, dépendant du canal de paiement. */
  estimatedTime: string;
}

// ─────────────────────────────────────────────────────────────
// Marché
// ─────────────────────────────────────────────────────────────

/** `GET /api/v1/market/stock` */
export interface MarketStockData {
  totalAllocated: number;
  tokensIssued: number;
  availableStock: number;
  /** Ratio, pas un pourcentage. `coverageRatio` côté État — noms distincts. */
  coverage: number;
  lastAuditDate: string | null;
}

export type TradeSide = 'BUY' | 'SELL';

/** `POST /api/v1/market/quote` */
export interface QuoteData {
  quoteId: string;
  /** Contraint par le CHECK de la table `quotes` — le contrat le reflete. */
  type: TradeSide;
  tokenAmount: number;
  cashAmount: number;
  pricePerGram: number;
  fees: number;
  total: number;
  /** Un devis expire : un prix accepté hier n'engage personne aujourd'hui. */
  expiresAt: string;
}

/** `POST /api/v1/market/buy` et `POST /api/v1/market/sell` */
export interface TradeExecutionData {
  transactionId: string;
  type: TradeSide;
  tokenAmount: number;
  cashAmount: number;
  status: string;
}

// ─────────────────────────────────────────────────────────────
// Location d or et repartition d un lot
// ─────────────────────────────────────────────────────────────

/** `GET /api/v1/lease/terms` */
export interface LeaseTermsData {
  annualRate: number;
  annualRatePercent: number;
  exitSettlementBusinessDays: number;
  minimumGrams: number;
  /** Avertissement en clair sur le pret. Affiche verbatim, jamais reformule. */
  disclosure: string;
}

export type LeasePositionStatus = 'ACTIVE' | 'EXITING' | 'CLOSED';

export interface LeasePositionView {
  id: string;
  principalG: number;
  annualRate: number;
  /** Rendement accumule, en XOF. Le principal reste en grammes. */
  accruedXof: number;
  principalValueXof: number;
  lastAccruedOn: string | null;
  status: LeasePositionStatus;
  openedAt: string;
  closedAt: string | null;
}

/** `GET /api/v1/lease/positions` */
export interface LeasePositionsData {
  positions: LeasePositionView[];
  totalPrincipalG: number;
  totalAccruedXof: number;
}

export interface LeaseAccrualView {
  date: string;
  principalG: number;
  pricePerGram: number;
  annualRate: number;
  amountXof: number;
}

/** `GET /api/v1/lease/positions/:id/accruals` */
export interface LeaseAccrualsData {
  positionId: string;
  accruedXof: number;
  /** Jour par jour : le total se recalcule au lieu d etre cru. */
  accruals: LeaseAccrualView[];
}

/** `POST /api/v1/lease/positions/:id/exit` */
export interface LeaseExitData {
  positionId: string;
  /** Date de reglement en jours ouvres — le rappel du pret. */
  settlesOn: string;
  message: string;
}

/** `GET /api/v1/producer/storage-fees` */
export interface StorageFeesData {
  outstandingCount: number;
  outstandingXof: number;
  accruals: Array<{
    accrual_date: string;
    stored_g: number;
    price_per_gram: number;
    amount_xof: number;
    status: 'PAID' | 'OUTSTANDING';
  }>;
  notice: string;
}

// ─────────────────────────────────────────────────────────────
// Utilisateur
// ─────────────────────────────────────────────────────────────

export type KycLevelName = 'BASIC' | 'STANDARD' | 'VERIFIED';
export type KycStatusName = 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

/** `GET /api/v1/users/me` */
export interface UserProfileData {
  id: string;
  email: string;
  phone: string;
  country: string;
  kycLevel: KycLevelName;
  kycStatus: KycStatusName;
  role: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  twoFactorEnabled: boolean;
  createdAt: string;
  /** null tant qu aucun portefeuille n a ete cree pour ce compte. */
  wallet: {
    tokenBalance: number;
    cashBalance: number;
    totalBought: number;
    totalSpent: number;
  } | null;
}

/**
 * `GET /api/v1/users/me/kyc/status`
 *
 * `document` au singulier : la route renvoie le dernier dossier, pas une liste.
 * Le client web declarait `documents` — champ qui n a jamais existe.
 */
export interface KycStatusData {
  level: KycLevelName;
  status: KycStatusName;
  document: {
    id: string;
    documentType: string;
    status: string;
    rejectionReason: string | null;
    submittedAt: string;
    reviewedAt: string | null;
  } | null;
}

/** `POST /api/v1/users/me/kyc` */
export interface KycSubmitData {
  kycId: string;
  status: string;
  /** false quand aucun prestataire de verification n est configure. */
  verificationStarted: boolean;
}

/** `GET|PATCH /api/v1/users/me/preferences/notifications` */
export interface NotificationPreferencesData {
  email: boolean;
  sms: boolean;
  priceAlerts: boolean;
  transactionAlerts: boolean;
  marketingEmails: boolean;
}

export interface PriceAlertView {
  id: string;
  alertType: 'ABOVE' | 'BELOW';
  targetPrice: number;
  currency: string;
  notificationMethod: string;
  isActive: boolean;
  triggered: boolean;
  triggeredAt: string | null;
  triggeredPrice: number | null;
  note: string | null;
  createdAt: string;
}

/** `GET /api/v1/users/me/price-alerts` */
export interface PriceAlertsData {
  items: PriceAlertView[];
  total: number;
}

// ─────────────────────────────────────────────────────────────
// Back-office
// ─────────────────────────────────────────────────────────────

export interface AdminRecentTransaction {
  id: string;
  type: string;
  amount: number;
  status: string;
  createdAt: string;
  /** Le back-office voit les identites — contrairement au portail Etat. */
  userEmail: string | null;
}

/** `GET /api/v1/admin/dashboard` */
export interface AdminDashboardData {
  totalUsers: number;
  activeUsers: number;
  totalTransactions: number;
  totalVolume: number;
  pendingKyc: number;
  pendingWithdrawals: number;
  recentTransactions: AdminRecentTransaction[];
  /**
   * Prix lu depuis le cache KV et deserialise : null quand rien n est en cache.
   * Sa forme depend du producteur du cache, d ou `unknown` plutot qu un type
   * invente qui donnerait une fausse assurance.
   */
  currentPrice: unknown;
}

/**
 * `GET /api/v1/admin/stock`
 *
 * `coverage` est ici le taux d UTILISATION (emis / alloue), l inverse du
 * `coverageRatio` du portail Etat (alloue / emis). Deux notions, deux noms —
 * les confondre inverserait la lecture.
 */
export interface AdminStockData {
  totalAllocated: number;
  tokensIssued: number;
  availableStock: number;
  lastAuditDate: string | null;
  lastAuditResult: string | null;
  coverage: number;
}

/** `GET /api/v1/admin/me/permissions` */
export interface AdminPermissionsData {
  permissions: Record<string, string[]>;
}

// ─────────────────────────────────────────────────────────────
// Authentification
// ─────────────────────────────────────────────────────────────

/**
 * `POST /api/v1/auth/2fa/setup`
 *
 * Aucune image de QR : la faire générer par un service externe enverrait la
 * graine TOTP de chaque utilisateur à un tiers. Les clients déclaraient
 * `qrCodeUrl` et l'écran web conditionnait tout son bloc à ce champ absent,
 * rendant l'activation 2FA impossible.
 */
export interface TwoFactorSetupData {
  secret: string;
  /** otpauth://… — à ouvrir dans l'application d'authentification. */
  uri: string;
  issuer: string;
  message: string;
}

// ─────────────────────────────────────────────────────────────
// Marché
// ─────────────────────────────────────────────────────────────

export interface PricePoint {
  timestamp: string;
  priceXof: number;
}

/**
 * `GET /api/v1/market/price/history`
 *
 * `items`, pas `prices` : le nom déclaré côté mobile n'existait pas, donc le
 * graphique restait vide.
 */
export interface PriceHistoryData {
  items: PricePoint[];
  period: string;
}
