/**
 * TNC Trading - Shared Types
 */

// ============================================
// USER TYPES
// ============================================

export type KycLevel = 'BASIC' | 'STANDARD' | 'VERIFIED';
export type KycStatus = 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

export interface User {
  id: string;
  email: string;
  phone: string;
  country: string;
  kycLevel: KycLevel;
  kycStatus: KycStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
  twoFactorEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile extends User {
  wallet: Wallet;
}

// ============================================
// WALLET TYPES
// ============================================

export interface Wallet {
  id: string;
  userId: string;
  tokenBalance: number;    // Grammes d'or
  cashBalance: number;     // XOF
  estimatedValue: number;  // Valeur en XOF (tokenBalance × prix actuel)
  averageBuyPrice: number; // Prix d'achat moyen XOF/g
  profitLoss: number;      // Gain/perte en XOF
  profitLossPercent: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// TRANSACTION TYPES
// ============================================

export type TransactionType = 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL' | 'FEE';
export type TransactionStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type PaymentMethod = 'orange_money' | 'moov_money' | 'card' | 'bank';

export interface Transaction {
  id: string;
  userId: string;
  walletId: string;
  type: TransactionType;
  status: TransactionStatus;
  tokenAmount?: number;
  cashAmount: number;
  pricePerGram?: number;
  fees: number;
  paymentMethod?: PaymentMethod;
  paymentReference?: string;
  failureReason?: string;
  createdAt: string;
  completedAt?: string;
}

export interface TransactionDetail extends Transaction {
  payoutMethod?: PaymentMethod;
  payoutReference?: string;
}

// ============================================
// MARKET TYPES
// ============================================

export interface GoldPrice {
  lbmaUsd: number;         // Prix LBMA en USD/g
  priceXof: number;        // Prix en XOF/g
  buyPrice: number;        // Prix d'achat avec spread
  sellPrice: number;       // Prix de vente avec spread
  spreadBuy: number;       // Spread achat (0.02 = 2%)
  spreadSell: number;      // Spread vente
  exchangeRate: number;    // Taux USD/XOF
  change24h: number;       // Variation 24h en %
  updatedAt: string;
}

export interface GoldPriceHistory {
  timestamp: string;
  priceXof: number;
}

export interface Quote {
  quoteId: string;
  type: 'BUY' | 'SELL';
  tokenAmount: number;     // Grammes
  cashAmount: number;      // XOF
  pricePerGram: number;
  fees: number;
  total: number;
  expiresAt: string;
}

export interface GoldStock {
  totalAllocated: number;  // Total or alloué (grammes)
  tokensIssued: number;    // Tokens en circulation
  availableStock: number;  // Disponible à la vente
  coverage: number;        // Ratio de couverture (≥ 1.0)
  lastAuditDate?: string;
}

// ============================================
// KYC TYPES
// ============================================

export type DocumentType = 'CNIB' | 'PASSPORT' | 'PERMIT' | 'CEDEAO';
export type KycDocumentStatus = 'SUBMITTED' | 'PROCESSING' | 'VERIFIED' | 'REJECTED';

export interface KycDocument {
  id: string;
  userId: string;
  documentType: DocumentType;
  documentNumber?: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  nationality: string;
  address?: string;
  city?: string;
  status: KycDocumentStatus;
  rejectionReason?: string;
  createdAt: string;
  verifiedAt?: string;
}

export interface UserKycInfo {
  level: KycLevel;
  status: KycStatus;
  rejectionReason?: string;
  submittedAt?: string;
  verifiedAt?: string;
  expiresAt?: string;
}

// ============================================
// NOTIFICATION TYPES
// ============================================

export type NotificationType = 'TRANSACTION' | 'KYC' | 'SECURITY' | 'MARKETING' | 'SYSTEM';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  read: boolean;
  readAt?: string;
  createdAt: string;
}

// ============================================
// API RESPONSE TYPES
// ============================================

export interface ApiResponse<T = unknown> {
  success: true;
  data: T;
  requestId: string;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  requestId: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// ============================================
// AUTH TYPES
// ============================================

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginResponse extends AuthTokens {
  user: User;
}

export interface RegisterRequest {
  email: string;
  phone: string;
  password: string;
  country: string;
}

export interface LoginRequest {
  identifier: string;  // Email or phone
  password: string;
  totpCode?: string;
}

// ============================================
// ADMIN TYPES
// ============================================

export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'KYC_REVIEWER' | 'FINANCE' | 'SUPPORT' | 'STATE_OPERATOR';

export interface Admin {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  active: boolean;
  lastLoginAt?: string;
}

export interface AuditLog {
  id: string;
  adminId?: string;
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  ipAddress?: string;
  createdAt: string;
}

// ============================================
// REPORT TYPES
// ============================================

export interface ProofOfReserve {
  id: string;
  reportDate: string;
  totalGoldAllocated: number;
  tokensIssued: number;
  coverageRatio: number;
  auditorName?: string;
  reportUrl?: string;
  createdAt: string;
}

export interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  totalTokens: number;
  totalVolume: number;
  todayTransactions: number;
  pendingKyc: number;
  pendingWithdrawals: number;
}
