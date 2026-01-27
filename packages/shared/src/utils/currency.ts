/**
 * Currency Formatting Utilities
 * Formatage des montants XOF et conversion
 */

import { DEFAULT_CURRENCY, CASH_PRECISION, DEFAULT_USD_XOF_RATE } from '../constants/index.js';

/**
 * Format a number as XOF currency
 * @example formatXOF(50000) => "50 000 FCFA"
 */
export function formatXOF(amount: number, options: {
  showCurrency?: boolean;
  showSign?: boolean;
  compact?: boolean;
} = {}): string {
  const { showCurrency = true, showSign = false, compact = false } = options;

  // Round to no decimals for XOF
  const rounded = Math.round(amount);

  // Handle sign
  const sign = showSign && rounded > 0 ? '+' : '';
  const absValue = Math.abs(rounded);

  let formatted: string;

  if (compact && absValue >= 1_000_000) {
    // Format as millions (e.g., 1.5M)
    formatted = (absValue / 1_000_000).toFixed(1).replace('.0', '') + 'M';
  } else if (compact && absValue >= 1_000) {
    // Format as thousands (e.g., 50K)
    formatted = (absValue / 1_000).toFixed(0) + 'K';
  } else {
    // Standard format with space separators (French convention)
    formatted = absValue.toLocaleString('fr-FR');
  }

  // Add sign back for negative numbers
  if (rounded < 0) {
    formatted = '-' + formatted;
  } else if (sign) {
    formatted = sign + formatted;
  }

  // Append currency
  if (showCurrency) {
    formatted += ' FCFA';
  }

  return formatted;
}

/**
 * Format a number as USD currency
 * @example formatUSD(75.50) => "$75.50"
 */
export function formatUSD(amount: number, options: {
  showCurrency?: boolean;
  decimals?: number;
} = {}): string {
  const { showCurrency = true, decimals = 2 } = options;

  const formatted = amount.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return showCurrency ? `$${formatted}` : formatted;
}

/**
 * Convert USD to XOF
 */
export function usdToXof(usd: number, exchangeRate: number = DEFAULT_USD_XOF_RATE): number {
  return Math.round(usd * exchangeRate);
}

/**
 * Convert XOF to USD
 */
export function xofToUsd(xof: number, exchangeRate: number = DEFAULT_USD_XOF_RATE): number {
  return xof / exchangeRate;
}

/**
 * Parse a currency string to number
 * @example parseCurrencyString("50 000 FCFA") => 50000
 */
export function parseCurrencyString(value: string): number {
  // Remove all non-numeric characters except minus and decimal
  const cleaned = value.replace(/[^\d.-]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Format a percentage
 * @example formatPercent(0.0234) => "+2.34%"
 */
export function formatPercent(value: number, options: {
  showSign?: boolean;
  decimals?: number;
} = {}): string {
  const { showSign = true, decimals = 2 } = options;

  const percent = value * 100;
  const sign = showSign && percent > 0 ? '+' : '';

  return `${sign}${percent.toFixed(decimals)}%`;
}

/**
 * Format a price change with color indicator
 * Returns the formatted string and whether it's positive
 */
export function formatPriceChange(value: number): {
  formatted: string;
  isPositive: boolean;
  isNeutral: boolean;
} {
  const isPositive = value > 0;
  const isNeutral = value === 0;

  return {
    formatted: formatPercent(value),
    isPositive,
    isNeutral,
  };
}

/**
 * Calculate total with fees
 */
export function calculateTotalWithFees(amount: number, feePercent: number): {
  amount: number;
  fees: number;
  total: number;
} {
  const fees = Math.round(amount * feePercent);
  return {
    amount,
    fees,
    total: amount + fees,
  };
}

/**
 * Calculate net amount after fees
 */
export function calculateNetAfterFees(amount: number, feePercent: number): {
  amount: number;
  fees: number;
  net: number;
} {
  const fees = Math.round(amount * feePercent);
  return {
    amount,
    fees,
    net: amount - fees,
  };
}
