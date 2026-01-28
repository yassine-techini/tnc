/**
 * KYC Utilities
 * Helpers pour la gestion des niveaux KYC et limites
 */

import type { KycLevel, KycStatus } from '../types/index.js';
import { KYC_LIMITS, KYC_DOCUMENT_TYPES } from '../constants/index.js';

/**
 * Check if a KYC level can trade (buy/sell)
 */
export function canTrade(kycLevel: KycLevel): boolean {
  const limits = KYC_LIMITS[kycLevel];
  return limits.dailyBuyGrams > 0 || limits.canSell;
}

/**
 * Check if a KYC level can buy
 */
export function canBuy(kycLevel: KycLevel): boolean {
  return KYC_LIMITS[kycLevel].dailyBuyGrams > 0;
}

/**
 * Check if a KYC level can sell
 */
export function canSell(kycLevel: KycLevel): boolean {
  return KYC_LIMITS[kycLevel].canSell;
}

/**
 * Check if a KYC level can withdraw
 */
export function canWithdraw(kycLevel: KycLevel): boolean {
  return KYC_LIMITS[kycLevel].dailyWithdrawXof > 0;
}

/**
 * Get KYC limits for a level
 */
export function getKycLimits(kycLevel: KycLevel) {
  return KYC_LIMITS[kycLevel];
}

/**
 * Check if daily buy limit would be exceeded
 */
export function checkDailyBuyLimit(
  kycLevel: KycLevel,
  todayPurchases: number,
  requestedAmount: number
): {
  allowed: boolean;
  remaining: number;
  limit: number;
} {
  const limit = KYC_LIMITS[kycLevel].dailyBuyGrams;
  const remaining = Math.max(0, limit - todayPurchases);

  return {
    allowed: todayPurchases + requestedAmount <= limit,
    remaining,
    limit,
  };
}

/**
 * Check if monthly buy limit would be exceeded
 */
export function checkMonthlyBuyLimit(
  kycLevel: KycLevel,
  monthPurchases: number,
  requestedAmount: number
): {
  allowed: boolean;
  remaining: number;
  limit: number;
} {
  const limit = KYC_LIMITS[kycLevel].monthlyBuyGrams;
  const remaining = Math.max(0, limit - monthPurchases);

  return {
    allowed: monthPurchases + requestedAmount <= limit,
    remaining,
    limit,
  };
}

/**
 * Check if daily withdrawal limit would be exceeded
 */
export function checkDailyWithdrawLimit(
  kycLevel: KycLevel,
  todayWithdrawals: number,
  requestedAmount: number
): {
  allowed: boolean;
  remaining: number;
  limit: number;
} {
  const limit = KYC_LIMITS[kycLevel].dailyWithdrawXof;
  const remaining = Math.max(0, limit - todayWithdrawals);

  return {
    allowed: todayWithdrawals + requestedAmount <= limit,
    remaining,
    limit,
  };
}

/**
 * Get KYC level display name in French
 */
export function getKycLevelName(level: KycLevel): string {
  const names: Record<KycLevel, string> = {
    BASIC: 'Basique',
    STANDARD: 'Standard',
    VERIFIED: 'Verifie',
  };
  return names[level] || level;
}

/**
 * Get KYC status display name in French
 */
export function getKycStatusName(status: KycStatus): string {
  const names: Record<KycStatus, string> = {
    PENDING: 'En attente',
    SUBMITTED: 'Soumis',
    APPROVED: 'Approuve',
    REJECTED: 'Rejete',
    EXPIRED: 'Expire',
  };
  return names[status] || status;
}

/**
 * Get KYC status color class
 */
export function getKycStatusColor(status: KycStatus): string {
  const colors: Record<KycStatus, string> = {
    PENDING: 'text-gray-500 bg-gray-100',
    SUBMITTED: 'text-blue-600 bg-blue-100',
    APPROVED: 'text-green-600 bg-green-100',
    REJECTED: 'text-red-600 bg-red-100',
    EXPIRED: 'text-orange-600 bg-orange-100',
  };
  return colors[status] || 'text-gray-500 bg-gray-100';
}

/**
 * Get document type display name in French
 */
export function getDocumentTypeName(type: keyof typeof KYC_DOCUMENT_TYPES): string {
  const names: Record<string, string> = {
    CNIB: 'Carte Nationale d\'Identite Burkinabe',
    PASSPORT: 'Passeport',
    PERMIT: 'Permis de conduire',
    CEDEAO: 'Carte d\'identite CEDEAO',
  };
  return names[type] || type;
}

/**
 * Get document type short name
 */
export function getDocumentTypeShortName(type: keyof typeof KYC_DOCUMENT_TYPES): string {
  const names: Record<string, string> = {
    CNIB: 'CNIB',
    PASSPORT: 'Passeport',
    PERMIT: 'Permis',
    CEDEAO: 'CEDEAO',
  };
  return names[type] || type;
}

/**
 * Check if document type requires back image
 */
export function requiresBackImage(type: keyof typeof KYC_DOCUMENT_TYPES): boolean {
  // Passport typically doesn't need back image
  return type !== 'PASSPORT';
}

/**
 * Get required KYC level for an action
 */
export function getRequiredKycLevel(action: 'BUY' | 'SELL' | 'WITHDRAW'): KycLevel {
  switch (action) {
    case 'BUY':
    case 'SELL':
    case 'WITHDRAW':
      return 'STANDARD';
    default:
      return 'BASIC';
  }
}

/**
 * Check if user needs to upgrade KYC for an action
 */
export function needsKycUpgrade(
  currentLevel: KycLevel,
  action: 'BUY' | 'SELL' | 'WITHDRAW'
): {
  needsUpgrade: boolean;
  requiredLevel: KycLevel;
  message?: string;
} {
  const requiredLevel = getRequiredKycLevel(action);
  const levels = ['BASIC', 'STANDARD', 'VERIFIED'];
  const currentIndex = levels.indexOf(currentLevel);
  const requiredIndex = levels.indexOf(requiredLevel);

  if (currentIndex >= requiredIndex) {
    return { needsUpgrade: false, requiredLevel };
  }

  return {
    needsUpgrade: true,
    requiredLevel,
    message: `Niveau ${getKycLevelName(requiredLevel)} requis pour cette operation`,
  };
}

/**
 * Get KYC completion percentage for progress display
 */
export function getKycCompletionProgress(
  emailVerified: boolean,
  phoneVerified: boolean,
  kycStatus: KycStatus
): {
  percentage: number;
  steps: { label: string; completed: boolean }[];
} {
  const steps = [
    { label: 'Email verifie', completed: emailVerified },
    { label: 'Telephone verifie', completed: phoneVerified },
    { label: 'Documents soumis', completed: ['SUBMITTED', 'APPROVED'].includes(kycStatus) },
    { label: 'Verification complete', completed: kycStatus === 'APPROVED' },
  ];

  const completedSteps = steps.filter(s => s.completed).length;
  const percentage = Math.round((completedSteps / steps.length) * 100);

  return { percentage, steps };
}
