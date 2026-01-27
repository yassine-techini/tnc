/**
 * Input Component
 * Form input with label, error state, and icons
 */

import React from 'react';
import { cn } from '../utils/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  rightElement?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      hint,
      leftIcon,
      rightIcon,
      rightElement,
      className,
      id,
      ...props
    },
    ref
  ) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-gray-700 mb-1.5"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'block w-full rounded-lg border transition-colors duration-200',
              'focus:outline-none focus:ring-2 focus:ring-offset-0',
              'placeholder:text-gray-400',
              'disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed',
              leftIcon ? 'pl-10' : 'pl-4',
              rightIcon || rightElement ? 'pr-10' : 'pr-4',
              'py-2.5',
              error
                ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                : 'border-gray-300 focus:border-amber-500 focus:ring-amber-500',
              className
            )}
            {...props}
          />
          {(rightIcon || rightElement) && (
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
              {rightElement || (
                <span className="text-gray-400">{rightIcon}</span>
              )}
            </div>
          )}
        </div>
        {error && (
          <p className="mt-1.5 text-sm text-red-600">{error}</p>
        )}
        {hint && !error && (
          <p className="mt-1.5 text-sm text-gray-500">{hint}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
