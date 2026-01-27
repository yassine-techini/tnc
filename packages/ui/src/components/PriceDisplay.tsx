/**
 * PriceDisplay Component
 * Display gold prices with buy/sell rates
 */

import React from 'react';
import { cn } from '../utils/cn';

export interface PriceDisplayProps {
  buyPrice: number;
  sellPrice: number;
  priceChange?: number;
  currency?: string;
  size?: 'sm' | 'md' | 'lg';
  showLabels?: boolean;
  className?: string;
}

const formatPrice = (price: number, currency: string): string => {
  if (currency === 'XOF') {
    return new Intl.NumberFormat('fr-FR', {
      style: 'decimal',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price) + ' FCFA';
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(price);
};

const sizeStyles = {
  sm: {
    price: 'text-lg font-semibold',
    label: 'text-xs',
    change: 'text-xs',
  },
  md: {
    price: 'text-2xl font-bold',
    label: 'text-sm',
    change: 'text-sm',
  },
  lg: {
    price: 'text-3xl font-bold',
    label: 'text-base',
    change: 'text-base',
  },
};

export const PriceDisplay: React.FC<PriceDisplayProps> = ({
  buyPrice,
  sellPrice,
  priceChange,
  currency = 'XOF',
  size = 'md',
  showLabels = true,
  className,
}) => {
  const styles = sizeStyles[size];
  const isPositive = priceChange !== undefined && priceChange >= 0;

  return (
    <div className={cn('space-y-3', className)}>
      {/* Main Price Display */}
      <div className="flex items-center justify-between">
        {/* Buy Price */}
        <div className="text-center">
          {showLabels && (
            <span className={cn('block text-gray-500 mb-1', styles.label)}>
              Achat
            </span>
          )}
          <span className={cn('text-amber-600', styles.price)}>
            {formatPrice(buyPrice, currency)}
          </span>
          {showLabels && (
            <span className={cn('block text-gray-400 mt-0.5', styles.label)}>
              par gramme
            </span>
          )}
        </div>

        {/* Divider */}
        <div className="h-12 w-px bg-gray-200 mx-4" />

        {/* Sell Price */}
        <div className="text-center">
          {showLabels && (
            <span className={cn('block text-gray-500 mb-1', styles.label)}>
              Vente
            </span>
          )}
          <span className={cn('text-gray-700', styles.price)}>
            {formatPrice(sellPrice, currency)}
          </span>
          {showLabels && (
            <span className={cn('block text-gray-400 mt-0.5', styles.label)}>
              par gramme
            </span>
          )}
        </div>
      </div>

      {/* Price Change Indicator */}
      {priceChange !== undefined && (
        <div className="flex items-center justify-center gap-1">
          <span
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full',
              styles.change,
              isPositive
                ? 'bg-green-100 text-green-700'
                : 'bg-red-100 text-red-700'
            )}
          >
            {isPositive ? (
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M14.707 10.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V5a1 1 0 012 0v7.586l2.293-2.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            )}
            {isPositive ? '+' : ''}
            {priceChange.toFixed(2)}%
          </span>
          <span className={cn('text-gray-400', styles.label)}>24h</span>
        </div>
      )}
    </div>
  );
};

PriceDisplay.displayName = 'PriceDisplay';
