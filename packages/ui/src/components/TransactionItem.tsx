/**
 * TransactionItem Component
 * Display a single transaction in history
 */

import React from 'react';
import { cn } from '../utils/cn';

export type TransactionType = 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL' | 'FEE';
export type TransactionStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface TransactionItemProps {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  tokenAmount?: number;
  cashAmount: number;
  createdAt: string | Date;
  onClick?: () => void;
  className?: string;
}

const typeConfig: Record<TransactionType, { icon: React.ReactNode; label: string; color: string }> = {
  BUY: {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
    ),
    label: 'Achat',
    color: 'bg-green-100 text-green-600',
  },
  SELL: {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
      </svg>
    ),
    label: 'Vente',
    color: 'bg-amber-100 text-amber-600',
  },
  DEPOSIT: {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    ),
    label: 'Dépôt',
    color: 'bg-blue-100 text-blue-600',
  },
  WITHDRAWAL: {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
      </svg>
    ),
    label: 'Retrait',
    color: 'bg-purple-100 text-purple-600',
  },
  FEE: {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    ),
    label: 'Frais',
    color: 'bg-gray-100 text-gray-600',
  },
};

const statusConfig: Record<TransactionStatus, { label: string; color: string }> = {
  PENDING: { label: 'En attente', color: 'text-yellow-600' },
  PROCESSING: { label: 'En cours', color: 'text-blue-600' },
  COMPLETED: { label: 'Terminé', color: 'text-green-600' },
  FAILED: { label: 'Échoué', color: 'text-red-600' },
  CANCELLED: { label: 'Annulé', color: 'text-gray-500' },
};

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('fr-FR', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount) + ' FCFA';
};

const formatGrams = (amount: number): string => {
  if (amount >= 1) {
    return amount.toFixed(3) + ' g';
  }
  return (amount * 1000).toFixed(0) + ' mg';
};

const formatDate = (date: string | Date): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
};

export const TransactionItem: React.FC<TransactionItemProps> = ({
  type,
  status,
  tokenAmount,
  cashAmount,
  createdAt,
  onClick,
  className,
}) => {
  const typeInfo = typeConfig[type];
  const statusInfo = statusConfig[status];
  const isClickable = !!onClick;

  return (
    <div
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg',
        isClickable && 'cursor-pointer hover:bg-gray-50 transition-colors',
        className
      )}
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
    >
      {/* Icon */}
      <div className={cn('w-10 h-10 rounded-full flex items-center justify-center', typeInfo.color)}>
        {typeInfo.icon}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900">{typeInfo.label}</span>
          {status !== 'COMPLETED' && (
            <span className={cn('text-xs font-medium', statusInfo.color)}>
              {statusInfo.label}
            </span>
          )}
        </div>
        <div className="text-sm text-gray-500">{formatDate(createdAt)}</div>
      </div>

      {/* Amount */}
      <div className="text-right">
        {tokenAmount !== undefined && (
          <div className="font-semibold text-gray-900">
            {type === 'BUY' ? '+' : type === 'SELL' ? '-' : ''}
            {formatGrams(tokenAmount)}
          </div>
        )}
        <div className={cn('text-sm', tokenAmount ? 'text-gray-500' : 'font-semibold text-gray-900')}>
          {type === 'DEPOSIT' ? '+' : type === 'WITHDRAWAL' || type === 'FEE' || type === 'BUY' ? '-' : '+'}
          {formatCurrency(cashAmount)}
        </div>
      </div>

      {/* Arrow */}
      {isClickable && (
        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      )}
    </div>
  );
};

TransactionItem.displayName = 'TransactionItem';
