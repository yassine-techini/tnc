/**
 * EmptyState Component
 * Display when there's no data to show
 */

import React from 'react';
import { cn } from '../utils/cn';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  variant?: 'default' | 'gold' | 'minimal';
  className?: string;
}

// Default icons for common empty states
export const EmptyStateIcons = {
  transactions: (
    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
      />
    </svg>
  ),
  notifications: (
    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
      />
    </svg>
  ),
  search: (
    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  ),
  gold: (
    <svg className="w-12 h-12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M5 20h14l2-8H3l2 8zm1.5-2h11l-1-4h-9l-1 4zM3 10h18v2H3v-2zm3-6h12l2 4H4l2-4z" />
    </svg>
  ),
  error: (
    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  ),
  folder: (
    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
      />
    </svg>
  ),
};

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  variant = 'default',
  className,
}) => {
  const variantStyles = {
    default: {
      container: 'bg-gray-50',
      icon: 'text-gray-400',
      title: 'text-gray-900',
      description: 'text-gray-500',
    },
    gold: {
      container: 'bg-amber-50',
      icon: 'text-amber-400',
      title: 'text-amber-900',
      description: 'text-amber-700',
    },
    minimal: {
      container: 'bg-transparent',
      icon: 'text-gray-300',
      title: 'text-gray-700',
      description: 'text-gray-500',
    },
  };

  const styles = variantStyles[variant];

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-12 px-4 rounded-xl text-center',
        styles.container,
        className
      )}
    >
      {icon && (
        <div className={cn('mb-4', styles.icon)}>
          {icon}
        </div>
      )}
      <h3 className={cn('text-lg font-semibold mb-2', styles.title)}>
        {title}
      </h3>
      {description && (
        <p className={cn('text-sm max-w-sm mb-4', styles.description)}>
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
};

EmptyState.displayName = 'EmptyState';
