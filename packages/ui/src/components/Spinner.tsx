/**
 * Spinner Component
 * Loading indicator
 */

import React from 'react';
import { cn } from '../utils/cn';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  color?: 'primary' | 'white' | 'gray';
  className?: string;
}

const sizeStyles = {
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-8 h-8 border-3',
};

const colorStyles = {
  primary: 'border-amber-600 border-t-transparent',
  white: 'border-white border-t-transparent',
  gray: 'border-gray-400 border-t-transparent',
};

export const Spinner: React.FC<SpinnerProps> = ({
  size = 'md',
  color = 'primary',
  className,
}) => {
  return (
    <div
      role="status"
      aria-label="Chargement..."
      className={cn(
        'rounded-full animate-spin',
        sizeStyles[size],
        colorStyles[color],
        className
      )}
    />
  );
};

Spinner.displayName = 'Spinner';
