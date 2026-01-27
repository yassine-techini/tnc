/**
 * WalletBalance Component
 * Display user's gold and cash balances
 */

import React from 'react';
import { cn } from '../utils/cn';

export interface WalletBalanceProps {
  tokenBalance: number;
  cashBalance: number;
  pricePerGram?: number;
  showConversion?: boolean;
  variant?: 'card' | 'inline' | 'compact';
  className?: string;
}

const formatXOF = (amount: number): string => {
  return new Intl.NumberFormat('fr-FR', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatGrams = (grams: number): string => {
  if (grams === 0) return '0';
  if (grams < 0.001) return grams.toFixed(6);
  if (grams < 0.01) return grams.toFixed(5);
  if (grams < 0.1) return grams.toFixed(4);
  return grams.toFixed(3);
};

// Gold bar icon
const GoldIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M5 20h14l2-8H3l2 8zm1.5-2h11l-1-4h-9l-1 4zM3 10h18v2H3v-2zm3-6h12l2 4H4l2-4z" />
  </svg>
);

// Wallet icon
const WalletIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
    />
  </svg>
);

export const WalletBalance: React.FC<WalletBalanceProps> = ({
  tokenBalance,
  cashBalance,
  pricePerGram,
  showConversion = true,
  variant = 'card',
  className,
}) => {
  const goldValueXOF = pricePerGram ? tokenBalance * pricePerGram : undefined;
  const totalValueXOF = goldValueXOF !== undefined ? goldValueXOF + cashBalance : undefined;

  if (variant === 'compact') {
    return (
      <div className={cn('flex items-center gap-4', className)}>
        <div className="flex items-center gap-1.5">
          <GoldIcon className="w-4 h-4 text-amber-500" />
          <span className="font-semibold text-gray-900">{formatGrams(tokenBalance)} g</span>
        </div>
        <div className="flex items-center gap-1.5">
          <WalletIcon className="w-4 h-4 text-gray-400" />
          <span className="font-semibold text-gray-900">{formatXOF(cashBalance)} FCFA</span>
        </div>
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <div className={cn('flex items-center justify-between gap-4 p-3 bg-gray-50 rounded-lg', className)}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <GoldIcon className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <div className="text-sm text-gray-500">Or</div>
            <div className="font-semibold text-gray-900">{formatGrams(tokenBalance)} g</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
            <WalletIcon className="w-5 h-5 text-gray-600" />
          </div>
          <div>
            <div className="text-sm text-gray-500">Solde</div>
            <div className="font-semibold text-gray-900">{formatXOF(cashBalance)} FCFA</div>
          </div>
        </div>
      </div>
    );
  }

  // Card variant (default)
  return (
    <div className={cn('bg-gradient-to-br from-amber-500 to-amber-600 rounded-2xl p-5 text-white shadow-lg', className)}>
      {/* Gold Balance */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <GoldIcon className="w-5 h-5 text-amber-200" />
          <span className="text-amber-100 text-sm">Solde Or</span>
        </div>
        <div className="text-3xl font-bold">{formatGrams(tokenBalance)} g</div>
        {showConversion && goldValueXOF !== undefined && (
          <div className="text-amber-200 text-sm mt-1">
            ≈ {formatXOF(goldValueXOF)} FCFA
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="h-px bg-amber-400/30 my-4" />

      {/* Cash Balance */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <WalletIcon className="w-4 h-4 text-amber-200" />
            <span className="text-amber-100 text-sm">Espèces</span>
          </div>
          <div className="text-xl font-semibold">{formatXOF(cashBalance)} FCFA</div>
        </div>

        {/* Total Value */}
        {showConversion && totalValueXOF !== undefined && (
          <div className="text-right">
            <div className="text-amber-200 text-xs">Valeur totale</div>
            <div className="text-lg font-semibold">{formatXOF(totalValueXOF)} FCFA</div>
          </div>
        )}
      </div>
    </div>
  );
};

WalletBalance.displayName = 'WalletBalance';
