/**
 * Gold & Token Utilities
 * Calculs et formatage pour les tokens d'or
 */

import {
  GOLD_PRECISION,
  DEFAULT_SPREAD_BUY,
  DEFAULT_SPREAD_SELL,
  MIN_BUY_GRAMS,
  MIN_SELL_GRAMS,
} from '../constants/index.js';

/**
 * Format a token amount (grammes) for display
 * @example formatGrams(5.123) => "5.123 g"
 * @example formatGrams(5) => "5.000 g"
 */
export function formatGrams(amount: number, options: {
  showUnit?: boolean;
  precision?: number;
} = {}): string {
  const { showUnit = true, precision = GOLD_PRECISION } = options;

  const formatted = amount.toFixed(precision);
  return showUnit ? `${formatted} g` : formatted;
}

/**
 * Format token balance for display (grammes with full precision)
 */
export function formatTokenBalance(amount: number): string {
  return formatGrams(amount, { showUnit: true, precision: 3 });
}

/**
 * Round a token amount to the allowed precision (0.001g)
 */
export function roundTokenAmount(amount: number): number {
  const multiplier = Math.pow(10, GOLD_PRECISION);
  return Math.round(amount * multiplier) / multiplier;
}

/**
 * Calculate buy price with spread
 * @param basePrice - Base price per gram (XOF)
 * @param spread - Spread percentage (default 2%)
 */
export function calculateBuyPrice(basePrice: number, spread: number = DEFAULT_SPREAD_BUY): number {
  return Math.round(basePrice * (1 + spread));
}

/**
 * Calculate sell price with spread
 * @param basePrice - Base price per gram (XOF)
 * @param spread - Spread percentage (default 2%)
 */
export function calculateSellPrice(basePrice: number, spread: number = DEFAULT_SPREAD_SELL): number {
  return Math.round(basePrice * (1 - spread));
}

/**
 * Calculate total cost for a purchase
 */
export function calculatePurchaseCost(
  grams: number,
  pricePerGram: number,
  feePercent: number = 0
): {
  subtotal: number;
  fees: number;
  total: number;
} {
  const subtotal = Math.round(grams * pricePerGram);
  const fees = Math.round(subtotal * feePercent);

  return {
    subtotal,
    fees,
    total: subtotal + fees,
  };
}

/**
 * Calculate proceeds from a sale
 */
export function calculateSaleProceeds(
  grams: number,
  pricePerGram: number,
  feePercent: number = 0
): {
  subtotal: number;
  fees: number;
  net: number;
} {
  const subtotal = Math.round(grams * pricePerGram);
  const fees = Math.round(subtotal * feePercent);

  return {
    subtotal,
    fees,
    net: subtotal - fees,
  };
}

/**
 * Calculate grams from XOF amount at a given price
 */
export function xofToGrams(xof: number, pricePerGram: number): number {
  if (pricePerGram <= 0) return 0;
  return roundTokenAmount(xof / pricePerGram);
}

/**
 * Calculate XOF value from grams at a given price
 */
export function gramsToXof(grams: number, pricePerGram: number): number {
  return Math.round(grams * pricePerGram);
}

/**
 * Calculate profit/loss
 */
export function calculateProfitLoss(
  tokenBalance: number,
  totalInvested: number,
  currentSellPrice: number
): {
  currentValue: number;
  profitLoss: number;
  profitLossPercent: number;
  isProfit: boolean;
} {
  const currentValue = Math.round(tokenBalance * currentSellPrice);
  const profitLoss = currentValue - totalInvested;
  const profitLossPercent = totalInvested > 0 ? (profitLoss / totalInvested) : 0;

  return {
    currentValue,
    profitLoss,
    profitLossPercent,
    isProfit: profitLoss >= 0,
  };
}

/**
 * Calculate average purchase price
 */
export function calculateAverageBuyPrice(totalInvested: number, totalGrams: number): number {
  if (totalGrams <= 0) return 0;
  return Math.round(totalInvested / totalGrams);
}

/**
 * Validate buy amount
 */
export function validateBuyAmount(grams: number): {
  isValid: boolean;
  error?: string;
} {
  if (grams < MIN_BUY_GRAMS) {
    return {
      isValid: false,
      error: `Montant minimum: ${formatGrams(MIN_BUY_GRAMS)}`,
    };
  }

  // Check precision
  const rounded = roundTokenAmount(grams);
  if (Math.abs(grams - rounded) > 0.0001) {
    return {
      isValid: false,
      error: `Precision maximale: ${GOLD_PRECISION} decimales (0.001g)`,
    };
  }

  return { isValid: true };
}

/**
 * Validate sell amount
 */
export function validateSellAmount(grams: number, balance: number): {
  isValid: boolean;
  error?: string;
} {
  if (grams < MIN_SELL_GRAMS) {
    return {
      isValid: false,
      error: `Montant minimum: ${formatGrams(MIN_SELL_GRAMS)}`,
    };
  }

  if (grams > balance) {
    return {
      isValid: false,
      error: `Solde insuffisant. Disponible: ${formatGrams(balance)}`,
    };
  }

  return { isValid: true };
}

/**
 * Calculate stock availability percentage
 */
export function calculateStockAvailability(
  totalAllocated: number,
  tokensIssued: number
): {
  available: number;
  percentage: number;
  isLow: boolean;
} {
  const available = totalAllocated - tokensIssued;
  const percentage = totalAllocated > 0 ? (available / totalAllocated) * 100 : 0;

  return {
    available,
    percentage,
    isLow: percentage < 10,
  };
}

/**
 * Format gold equivalent display
 * @example formatGoldEquivalent(5.5) => "5,5 grammes d'or pur 24 carats"
 */
export function formatGoldEquivalent(grams: number): string {
  const formatted = grams.toFixed(3).replace('.', ',');
  return `${formatted} gramme${grams !== 1 ? 's' : ''} d'or pur 24 carats`;
}
