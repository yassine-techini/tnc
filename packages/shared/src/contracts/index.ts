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
export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string;
  /** Charge utile libre, deja analysee. `null` si absente ou illisible. */
  data: unknown;
  read: boolean;
  createdAt: string;
}

/**
 * `GET /api/v1/users/me/notifications`
 *
 * Cette route existait, se remplissait, et n'etait lue par AUCUN client : une
 * notification manquee etait perdue pour de bon, faute d'historique consultable.
 */
export interface NotificationsData {
  items: NotificationView[];
  total: number;
  unread: number;
  page: number;
  limit: number;
}

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
// Analytique temps réel
// ─────────────────────────────────────────────────────────────

/**
 * `GET /api/v1/admin/analytics/realtime`
 *
 * Forme PLATE, telle que le Durable Object la construit. La route n'est qu'un
 * relais (`await response.json()`), donc `satisfies` n'y prouverait rien : le
 * contrat est applique a la SOURCE, sur `computeMetrics()`.
 *
 * Le client admin declarait une structure imbriquee `{ metrics: { … },
 * connectedClients, lastUpdate }` avec des noms qui n'existaient pas
 * (requestsLast1Hr, avgLatencyMs, p95LatencyMs, volumeLast24Hr…). L'ecran lisait
 * `data.metrics`, absent de la reponse : tout le tableau de bord temps reel
 * affichait donc 0 en permanence.
 */
export interface RealtimeMetricsData {
  timestamp: string;
  activeConnections: number;
  transactionsLastHour: number;
  transactionsLast5Min: number;
  buyVolumeLastHour: number;
  sellVolumeLastHour: number;
  buyVolumeLast24h: number;
  sellVolumeLast24h: number;
  errorRateLast5Min: number;
  requestsLast5Min: number;
  errorsLast5Min: number;
  /** Millisecondes. Le client attendait `avgLatencyMs` — nom inexistant. */
  avgLatencyLast5Min: number;
  pendingKyc: number;
  pendingWithdrawals: number;
  goldStockCoverage: number;
  newUsersToday: number;
  transactionFailureRate: number;
}

/** Un point de mesure horodaté, tel que le Durable Object les conserve. */
export interface MetricDataPoint {
  /** Millisecondes epoch — pas une chaîne ISO. */
  timestamp: number;
  value: number;
  metadata?: Record<string, unknown>;
}

/**
 * `GET /api/v1/admin/analytics/history`
 *
 * Quatre séries brutes, pas des instantanés agrégés. Le client admin déclarait
 * `{ snapshots: Array<{ timestamp: string; metrics: Record<string, number> }> }`
 * — une forme qui n'a jamais existé.
 */
export interface AnalyticsHistoryData {
  transactions: MetricDataPoint[];
  requests: MetricDataPoint[];
  errors: MetricDataPoint[];
  latencies: MetricDataPoint[];
}

export interface LogIndexEntry {
  id: string;
  timestamp: string;
  level: string;
  category: string;
  action: string | null;
  userId: string | null;
  requestId: string | null;
  messagePreview: string;
}

/** `GET /api/v1/admin/analytics/logs` */
export interface LogSearchData {
  logs: LogIndexEntry[];
  total: number;
}

/**
 * `GET /api/v1/admin/analytics/logs/:id` — le journal complet.
 *
 * Meme forme que celle ecrite par le service de journalisation : c est le
 * dossier lui-meme, pas une projection pour l ecran.
 */
export interface StructuredLogData {
  id: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  category: string;
  action?: string;
  message: string;
  userId?: string;
  requestId?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  stack?: string;
}

/** `GET /api/v1/admin/analytics/logs/stats` */
export interface LogStatsData {
  totalLogs: number;
  byLevel: Record<string, number>;
  byCategory: Record<string, number>;
  recentErrors: number;
}

export interface AlertRuleRow {
  id: string;
  name: string;
  metric: string;
  operator: string;
  threshold: number;
  severity: string;
  cooldown_minutes: number;
  notify_email: number;
  notify_sms: number;
  notify_webhook: string | null;
  enabled: number;
  last_triggered_at: string | null;
  created_at: string;
}

/** `GET /api/v1/admin/analytics/alerts/rules` */
export interface AlertRulesData {
  rules: AlertRuleRow[];
}

export interface AlertRow {
  id: string;
  rule_id: string;
  rule_name: string;
  severity: string;
  message: string;
  current_value: number;
  threshold: number;
  triggered_at: string;
  acknowledged: number;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved: number;
  resolved_at: string | null;
}

/** `GET /api/v1/admin/analytics/alerts` */
export interface AlertsData {
  alerts: AlertRow[];
  total: number;
  limit: number;
  offset: number;
}

/** Réponses d'action : ce que la route confirme avoir fait. */
export interface AlertRuleCreatedData {
  id: string;
}

export interface AlertAcknowledgedData {
  acknowledged: true;
}

export interface AlertResolvedData {
  resolved: true;
}

export interface AlertRuleDeletedData {
  deleted: true;
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

/** L'utilisateur tel que la connexion le renvoie. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  phone: string;
  country: string;
  kycLevel: KycLevelName;
  kycStatus: KycStatusName;
  emailVerified: boolean;
  phoneVerified: boolean;
  twoFactorEnabled: boolean;
}

/**
 * `POST /api/v1/auth/login`
 *
 * Les jetons sont AUSSI posés en cookies httpOnly. Ils restent dans le corps
 * pour le mobile, qui n'a pas de magasin de cookies partagé avec le navigateur.
 */
export interface LoginData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthenticatedUser;
  sessionId: string;
}

/**
 * `POST /api/v1/auth/2fa/setup-complete`
 *
 * Une connexion, plus une confirmation. Exprime en extension plutot que d
 * alourdir `LoginData` : les deux autres chemins de connexion n ont pas de
 * message, et un client ne devrait pas avoir a se demander lequel en porte un.
 */
export interface TwoFactorSetupCompleteData extends LoginData {
  message: string;
}

/** `POST /api/v1/auth/refresh` */
export interface RefreshData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** `POST /api/v1/auth/register` */
export interface RegisterData {
  message: string;
  userId: string;
  /** Évaluation de la robustesse du mot de passe choisi. */
  passwordStrength: string;
}

export interface SessionView {
  id: string;
  /** Colonnes reellement nullables en base — le contrat le dit plutot que de
   *  laisser un ecran supposer une chaine et afficher "undefined". */
  ipAddress: string | null;
  userAgent: string | null;
  deviceType: string | null;
  location: string | null;
  lastUsed: string | null;
  createdAt: string;
  /**
   * La session qui fait la requete. Determinee par la revendication `sid` du
   * jeton, avec repli sur l IP pour les jetons anterieurs a cette revendication.
   * C est l information qui dit laquelle on peut revoquer sans se deconnecter.
   */
  isCurrent: boolean;
}

/** `GET /api/v1/auth/sessions` */
export interface SessionsData {
  sessions: SessionView[];
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
