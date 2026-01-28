/**
 * Shared constants for TNC Trading Web App
 */

// Payment Methods
export const PAYMENT_METHODS = [
  { id: 'orange_money', name: 'Orange Money', icon: '🟠', prefix: '+226' },
  { id: 'moov_money', name: 'Moov Money', icon: '🔵', prefix: '+226' },
  { id: 'card', name: 'Carte Bancaire', icon: '💳', prefix: null },
  { id: 'stripe', name: 'Carte Internationale', icon: '💳', prefix: null },
] as const;

export type PaymentMethodId = typeof PAYMENT_METHODS[number]['id'];

// Quick amounts for deposits/withdrawals
export const QUICK_AMOUNTS = [5000, 10000, 25000, 50000, 100000] as const;

// Transaction types
export const TRANSACTION_TYPES = {
  BUY: { label: 'Achat', icon: '↓', color: 'green' },
  SELL: { label: 'Vente', icon: '↑', color: 'red' },
  DEPOSIT: { label: 'Depot', icon: '↓', color: 'blue' },
  WITHDRAWAL: { label: 'Retrait', icon: '↑', color: 'yellow' },
  FEE: { label: 'Frais', icon: '−', color: 'gray' },
} as const;

export type TransactionType = keyof typeof TRANSACTION_TYPES;

// Transaction status
export const TRANSACTION_STATUS = {
  PENDING: { label: 'En attente', color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  PROCESSING: { label: 'En cours', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  COMPLETED: { label: 'Complete', color: 'text-green-400', bg: 'bg-green-500/20' },
  FAILED: { label: 'Echoue', color: 'text-red-400', bg: 'bg-red-500/20' },
  CANCELLED: { label: 'Annule', color: 'text-slate-400', bg: 'bg-slate-500/20' },
} as const;

export type TransactionStatus = keyof typeof TRANSACTION_STATUS;

// KYC Levels
export const KYC_LEVELS = {
  BASIC: {
    label: 'Basique',
    color: 'text-slate-400',
    dailyBuy: 0,
    monthlyBuy: 0,
    canSell: false,
    dailyWithdraw: 0,
  },
  STANDARD: {
    label: 'Standard',
    color: 'text-blue-400',
    dailyBuy: 100,
    monthlyBuy: 500,
    canSell: true,
    dailyWithdraw: 500000,
  },
  VERIFIED: {
    label: 'Vérifié',
    color: 'text-green-400',
    dailyBuy: 1000,
    monthlyBuy: 5000,
    canSell: true,
    dailyWithdraw: 5000000,
  },
} as const;

export type KycLevel = keyof typeof KYC_LEVELS;

// KYC Status
export const KYC_STATUS = {
  PENDING: { label: 'En attente', color: 'text-yellow-400' },
  SUBMITTED: { label: 'Soumis', color: 'text-blue-400' },
  APPROVED: { label: 'Approuve', color: 'text-green-400' },
  REJECTED: { label: 'Rejete', color: 'text-red-400' },
  EXPIRED: { label: 'Expire', color: 'text-orange-400' },
} as const;

export type KycStatus = keyof typeof KYC_STATUS;

// Document types for KYC
export const DOCUMENT_TYPES = [
  { id: 'CNIB', label: 'CNIB (Carte Nationale d\'Identite)', hasBack: true },
  { id: 'PASSPORT', label: 'Passeport', hasBack: false },
  { id: 'PERMIT', label: 'Permis de conduire', hasBack: true },
  { id: 'CEDEAO', label: 'Carte CEDEAO', hasBack: false },
] as const;

export type DocumentType = typeof DOCUMENT_TYPES[number]['id'];

// Price alert types
export const ALERT_TYPES = {
  ABOVE: { label: 'Au-dessus de', icon: '↑', color: 'green' },
  BELOW: { label: 'En-dessous de', icon: '↓', color: 'red' },
} as const;

export type AlertType = keyof typeof ALERT_TYPES;

// Notification methods
export const NOTIFICATION_METHODS = [
  { id: 'EMAIL', label: 'Email' },
  { id: 'SMS', label: 'SMS' },
  { id: 'PUSH', label: 'Push' },
  { id: 'ALL', label: 'Toutes' },
] as const;

export type NotificationMethod = typeof NOTIFICATION_METHODS[number]['id'];

// Chart periods
export const CHART_PERIODS = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7j' },
  { id: '30d', label: '30j' },
  { id: '1y', label: '1an' },
] as const;

export type ChartPeriod = typeof CHART_PERIODS[number]['id'];

// Countries (Burkina Faso + CEDEAO)
export const COUNTRIES = [
  { code: 'BF', name: 'Burkina Faso', prefix: '+226' },
  { code: 'CI', name: 'Cote d\'Ivoire', prefix: '+225' },
  { code: 'ML', name: 'Mali', prefix: '+223' },
  { code: 'NE', name: 'Niger', prefix: '+227' },
  { code: 'SN', name: 'Senegal', prefix: '+221' },
  { code: 'TG', name: 'Togo', prefix: '+228' },
  { code: 'BJ', name: 'Benin', prefix: '+229' },
  { code: 'GH', name: 'Ghana', prefix: '+233' },
  { code: 'NG', name: 'Nigeria', prefix: '+234' },
] as const;

// Spreads (as per CLAUDE.md)
export const SPREADS = {
  BUY: 0.02, // 2%
  SELL: 0.02, // 2%
} as const;

// API endpoints base
export const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8787' : '');

// Session timeout (30 minutes as per CLAUDE.md)
export const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes in ms

// Rate limits
export const RATE_LIMITS = {
  REQUESTS_PER_MINUTE_IP: 100,
  REQUESTS_PER_MINUTE_USER: 1000,
} as const;
