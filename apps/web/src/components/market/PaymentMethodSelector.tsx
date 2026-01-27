import { useState } from 'react';
import { PAYMENT_METHODS, type PaymentMethodId } from '../../lib/constants';
import { FormField, Input } from '../ui/FormField';

export interface PaymentMethodSelectorProps {
  selectedMethod: PaymentMethodId | null;
  onSelect: (method: PaymentMethodId) => void;
  phoneNumber?: string;
  onPhoneChange?: (phone: string) => void;
  disabled?: boolean;
  error?: string;
  showPhoneInput?: boolean;
}

/**
 * Payment Method Selector Component
 */
export function PaymentMethodSelector({
  selectedMethod,
  onSelect,
  phoneNumber = '',
  onPhoneChange,
  disabled = false,
  error,
  showPhoneInput = true,
}: PaymentMethodSelectorProps) {
  const selectedPayment = PAYMENT_METHODS.find((m) => m.id === selectedMethod);
  const requiresPhone = selectedPayment?.prefix !== null;

  return (
    <div className="space-y-4">
      {/* Payment Method Options */}
      <div className="space-y-2">
        {PAYMENT_METHODS.map((method) => (
          <PaymentMethodOption
            key={method.id}
            method={method}
            isSelected={selectedMethod === method.id}
            onSelect={() => onSelect(method.id)}
            disabled={disabled}
          />
        ))}
      </div>

      {/* Phone Number Input (for mobile money) */}
      {showPhoneInput && requiresPhone && onPhoneChange && (
        <div className="mt-4 pl-10">
          <FormField
            label="Numéro de téléphone"
            error={error}
            helperText={`Format: ${selectedPayment?.prefix} XX XX XX XX`}
          >
            <div className="flex">
              <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-slate-600 bg-slate-700 text-slate-300 text-sm">
                {selectedPayment?.prefix}
              </span>
              <Input
                id="payment-phone-input"
                type="tel"
                value={phoneNumber}
                onChange={(e) => onPhoneChange(e.target.value.replace(/\D/g, ''))}
                placeholder="70 12 34 56"
                className="rounded-l-none"
                maxLength={8}
                disabled={disabled}
              />
            </div>
          </FormField>
        </div>
      )}
    </div>
  );
}

interface PaymentMethodOptionProps {
  method: typeof PAYMENT_METHODS[number];
  isSelected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}

function PaymentMethodOption({
  method,
  isSelected,
  onSelect,
  disabled = false,
}: PaymentMethodOptionProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`
        w-full flex items-center gap-3 p-4 rounded-lg border-2 transition-all text-left
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${isSelected
          ? 'border-amber-500 bg-amber-500/10'
          : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
        }
      `}
    >
      {/* Radio Circle */}
      <div
        className={`
          w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0
          ${isSelected ? 'border-amber-500' : 'border-slate-500'}
        `}
      >
        {isSelected && <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />}
      </div>

      {/* Icon */}
      <span className="text-2xl">{method.icon}</span>

      {/* Name and Description */}
      <div className="flex-1">
        <p className={`font-medium ${isSelected ? 'text-white' : 'text-slate-200'}`}>
          {method.name}
        </p>
        {method.prefix && (
          <p className="text-sm text-slate-400">Paiement mobile {method.prefix}</p>
        )}
        {method.id === 'card' && (
          <p className="text-sm text-slate-400">Visa, Mastercard (CinetPay)</p>
        )}
        {method.id === 'stripe' && (
          <p className="text-sm text-slate-400">Visa, Mastercard, Apple Pay (Stripe)</p>
        )}
      </div>

      {/* Check Icon for Selected */}
      {isSelected && (
        <svg className="w-5 h-5 text-amber-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
      )}
    </button>
  );
}

/**
 * Compact Payment Method Display (for summary/confirmation)
 */
export function PaymentMethodDisplay({
  methodId,
  phoneNumber,
}: {
  methodId: PaymentMethodId;
  phoneNumber?: string;
}) {
  const method = PAYMENT_METHODS.find((m) => m.id === methodId);

  if (!method) return null;

  return (
    <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg">
      <span className="text-2xl">{method.icon}</span>
      <div>
        <p className="font-medium text-white">{method.name}</p>
        {phoneNumber && method.prefix && (
          <p className="text-sm text-slate-400">{method.prefix} {phoneNumber}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Quick Amount Selector
 */
export function QuickAmountSelector({
  amounts,
  selectedAmount,
  onSelect,
  currency = 'FCFA',
  disabled = false,
}: {
  amounts: readonly number[];
  selectedAmount: number | null;
  onSelect: (amount: number) => void;
  currency?: string;
  disabled?: boolean;
}) {
  const [customAmount, setCustomAmount] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('fr-FR').format(amount);
  };

  return (
    <div className="space-y-3">
      {/* Preset Amounts */}
      <div className="grid grid-cols-3 gap-2">
        {amounts.map((amount) => (
          <button
            key={amount}
            type="button"
            onClick={() => {
              onSelect(amount);
              setShowCustom(false);
              setCustomAmount('');
            }}
            disabled={disabled}
            className={`
              py-3 px-4 rounded-lg text-center transition-all font-medium
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              ${selectedAmount === amount && !showCustom
                ? 'bg-amber-500 text-black'
                : 'bg-slate-800 text-white hover:bg-slate-700'
              }
            `}
          >
            {formatAmount(amount)}
          </button>
        ))}
      </div>

      {/* Custom Amount */}
      <div>
        <button
          type="button"
          onClick={() => setShowCustom(!showCustom)}
          disabled={disabled}
          className={`
            w-full py-2 text-center text-sm transition-colors
            ${showCustom ? 'text-amber-400' : 'text-slate-400 hover:text-white'}
          `}
        >
          {showCustom ? 'Utiliser un montant prédéfini' : 'Montant personnalisé'}
        </button>

        {showCustom && (
          <div className="mt-2">
            <div className="flex">
              <Input
                type="number"
                value={customAmount}
                onChange={(e) => {
                  setCustomAmount(e.target.value);
                  const amount = parseInt(e.target.value, 10);
                  if (!isNaN(amount) && amount > 0) {
                    onSelect(amount);
                  }
                }}
                placeholder="Entrez un montant"
                className="rounded-r-none"
                disabled={disabled}
              />
              <span className="inline-flex items-center px-3 rounded-r-lg border border-l-0 border-slate-600 bg-slate-700 text-slate-300 text-sm">
                {currency}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default PaymentMethodSelector;
