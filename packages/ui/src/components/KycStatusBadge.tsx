/**
 * KycStatusBadge Component
 * Display KYC verification status
 */

import React from 'react';
import { cn } from '../utils/cn';

export type KycLevel = 'BASIC' | 'STANDARD' | 'VERIFIED';
export type KycStatus = 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

export interface KycStatusBadgeProps {
  level: KycLevel;
  status?: KycStatus;
  showLevel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const levelConfig: Record<KycLevel, { label: string; description: string; icon: React.ReactNode; color: string }> = {
  BASIC: {
    label: 'Basique',
    description: 'Email vérifié',
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
      </svg>
    ),
    color: 'bg-gray-100 text-gray-700 border-gray-200',
  },
  STANDARD: {
    label: 'Standard',
    description: 'Identité vérifiée',
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
      </svg>
    ),
    color: 'bg-blue-100 text-blue-700 border-blue-200',
  },
  VERIFIED: {
    label: 'Vérifié',
    description: 'Accès complet',
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
      </svg>
    ),
    color: 'bg-amber-100 text-amber-700 border-amber-200',
  },
};

const statusConfig: Record<KycStatus, { label: string; color: string; icon: React.ReactNode }> = {
  PENDING: {
    label: 'Non soumis',
    color: 'bg-gray-100 text-gray-600',
    icon: (
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
      </svg>
    ),
  },
  SUBMITTED: {
    label: 'En révision',
    color: 'bg-yellow-100 text-yellow-700',
    icon: (
      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
    ),
  },
  APPROVED: {
    label: 'Approuvé',
    color: 'bg-green-100 text-green-700',
    icon: (
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
      </svg>
    ),
  },
  REJECTED: {
    label: 'Rejeté',
    color: 'bg-red-100 text-red-700',
    icon: (
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
      </svg>
    ),
  },
  EXPIRED: {
    label: 'Expiré',
    color: 'bg-orange-100 text-orange-700',
    icon: (
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
    ),
  },
};

const sizeStyles = {
  sm: 'px-2 py-0.5 text-xs gap-1',
  md: 'px-2.5 py-1 text-sm gap-1.5',
  lg: 'px-3 py-1.5 text-base gap-2',
};

export const KycStatusBadge: React.FC<KycStatusBadgeProps> = ({
  level,
  status,
  showLevel = true,
  size = 'md',
  className,
}) => {
  const levelInfo = levelConfig[level];

  // If showing status instead of level
  if (status && !showLevel) {
    const statusInfo = statusConfig[status];
    return (
      <span
        className={cn(
          'inline-flex items-center font-medium rounded-full',
          sizeStyles[size],
          statusInfo.color,
          className
        )}
      >
        {statusInfo.icon}
        {statusInfo.label}
      </span>
    );
  }

  return (
    <div className={cn('inline-flex items-center', className)}>
      <span
        className={cn(
          'inline-flex items-center font-medium rounded-full border',
          sizeStyles[size],
          levelInfo.color
        )}
      >
        {levelInfo.icon}
        {levelInfo.label}
      </span>
      {status && status !== 'APPROVED' && (
        <span
          className={cn(
            'inline-flex items-center font-medium rounded-full ml-1',
            size === 'sm' ? 'px-1.5 py-0.5 text-xs gap-0.5' : 'px-2 py-0.5 text-xs gap-1',
            statusConfig[status].color
          )}
        >
          {statusConfig[status].icon}
          {statusConfig[status].label}
        </span>
      )}
    </div>
  );
};

KycStatusBadge.displayName = 'KycStatusBadge';
