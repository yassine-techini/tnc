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
