/**
 * GoldAmountInput Component
 * Specialized input for gold amount with gram/XOF conversion
 */

import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '../utils/cn';

export interface GoldAmountInputProps {
  value: number;
  onChange: (grams: number) => void;
  pricePerGram: number;
  minAmount?: number;
  maxAmount?: number;
  balance?: number;
  mode?: 'buy' | 'sell';
  disabled?: boolean;
  error?: string;
  className?: string;
}

type InputMode = 'grams' | 'xof';

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

const presetAmounts = [
  { label: '0.1g', grams: 0.1 },
  { label: '0.5g', grams: 0.5 },
  { label: '1g', grams: 1 },
  { label: '5g', grams: 5 },
];

export const GoldAmountInput: React.FC<GoldAmountInputProps> = ({
  value,
  onChange,
  pricePerGram,
  minAmount = 0.001,
  maxAmount,
  balance,
  mode = 'buy',
  disabled = false,
  error,
  className,
}) => {
  const [inputMode, setInputMode] = useState<InputMode>('grams');
  const [inputValue, setInputValue] = useState<string>(value > 0 ? formatGrams(value) : '');

  // Calculate XOF equivalent
  const xofAmount = value * pricePerGram;

  // Update input value when external value changes
  useEffect(() => {
    if (inputMode === 'grams') {
      setInputValue(value > 0 ? formatGrams(value) : '');
    } else {
      setInputValue(value > 0 ? formatXOF(xofAmount) : '');
    }
  }, [value, inputMode, xofAmount]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const rawValue = e.target.value.replace(/[^\d.,]/g, '').replace(',', '.');
      setInputValue(rawValue);

      const numValue = parseFloat(rawValue);
      if (isNaN(numValue) || numValue < 0) {
        onChange(0);
        return;
      }

      if (inputMode === 'grams') {
        onChange(numValue);
      } else {
        // Convert XOF to grams
        const grams = numValue / pricePerGram;
        onChange(grams);
      }
    },
    [inputMode, onChange, pricePerGram]
  );

  const handleModeSwitch = useCallback(() => {
    setInputMode((prev) => (prev === 'grams' ? 'xof' : 'grams'));
  }, []);

  const handlePresetClick = useCallback(
    (grams: number) => {
      onChange(grams);
    },
    [onChange]
  );

  const handleMaxClick = useCallback(() => {
    if (mode === 'sell' && balance !== undefined) {
      onChange(balance);
    } else if (maxAmount !== undefined) {
      onChange(maxAmount);
    }
  }, [mode, balance, maxAmount, onChange]);

  const isValidAmount = value >= minAmount && (!maxAmount || value <= maxAmount);
  const showMaxButton = (mode === 'sell' && balance !== undefined) || maxAmount !== undefined;

  return (
    <div className={cn('space-y-3', className)}>
      {/* Input Field */}
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={inputValue}
          onChange={handleInputChange}
          disabled={disabled}
          placeholder={inputMode === 'grams' ? '0.000' : '0'}
          className={cn(
            'w-full px-4 py-3 pr-20 text-2xl font-semibold text-center rounded-xl border-2 transition-colors',
            'focus:outline-none focus:ring-0',
            error
              ? 'border-red-300 focus:border-red-500'
              : isValidAmount || value === 0
              ? 'border-gray-200 focus:border-amber-500'
              : 'border-yellow-300 focus:border-yellow-500',
            disabled && 'bg-gray-100 cursor-not-allowed'
          )}
        />
        <button
          type="button"
          onClick={handleModeSwitch}
          disabled={disabled}
          className={cn(
            'absolute right-3 top-1/2 -translate-y-1/2',
            'px-3 py-1 rounded-lg text-sm font-medium',
            'bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        >
          {inputMode === 'grams' ? 'g' : 'FCFA'}
        </button>
      </div>

      {/* Conversion Display */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-500">
          {inputMode === 'grams' ? 'Équivalent:' : 'Quantité:'}
        </span>
        <span className="font-medium text-gray-700">
          {inputMode === 'grams'
            ? `${formatXOF(xofAmount)} FCFA`
            : `${formatGrams(value)} g`}
        </span>
      </div>

      {/* Preset Amounts */}
      <div className="flex items-center gap-2">
        {presetAmounts.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => handlePresetClick(preset.grams)}
            disabled={disabled || (maxAmount !== undefined && preset.grams > maxAmount)}
            className={cn(
              'flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors',
              value === preset.grams
                ? 'bg-amber-100 text-amber-700 border-2 border-amber-300'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border-2 border-transparent',
              (disabled || (maxAmount !== undefined && preset.grams > maxAmount)) &&
                'opacity-50 cursor-not-allowed'
            )}
          >
            {preset.label}
          </button>
        ))}
        {showMaxButton && (
          <button
            type="button"
            onClick={handleMaxClick}
            disabled={disabled}
            className={cn(
              'py-2 px-3 rounded-lg text-sm font-medium transition-colors',
              'bg-amber-600 text-white hover:bg-amber-700',
              disabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            MAX
          </button>
        )}
      </div>

      {/* Balance/Limit Info */}
      {mode === 'sell' && balance !== undefined && (
        <div className="text-sm text-gray-500 text-center">
          Solde disponible: <span className="font-medium">{formatGrams(balance)} g</span>
        </div>
      )}

      {/* Error Message */}
      {error && <p className="text-sm text-red-500 text-center">{error}</p>}

      {/* Validation Messages */}
      {!error && value > 0 && value < minAmount && (
        <p className="text-sm text-yellow-600 text-center">
          Montant minimum: {formatGrams(minAmount)} g
        </p>
      )}
      {!error && maxAmount && value > maxAmount && (
        <p className="text-sm text-yellow-600 text-center">
          Montant maximum: {formatGrams(maxAmount)} g
        </p>
      )}
    </div>
  );
};

GoldAmountInput.displayName = 'GoldAmountInput';
