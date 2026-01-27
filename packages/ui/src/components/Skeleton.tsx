/**
 * Skeleton Component
 * Placeholder loading states
 */

import React from 'react';
import { cn } from '../utils/cn';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
  animation?: 'pulse' | 'wave' | 'none';
}

export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  (
    {
      variant = 'text',
      width,
      height,
      animation = 'pulse',
      className,
      style,
      ...props
    },
    ref
  ) => {
    const variantStyles = {
      text: 'rounded h-4',
      circular: 'rounded-full',
      rectangular: 'rounded-lg',
    };

    const animationStyles = {
      pulse: 'animate-pulse',
      wave: 'bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 bg-[length:200%_100%] animate-[shimmer_1.5s_infinite]',
      none: '',
    };

    return (
      <div
        ref={ref}
        className={cn(
          'bg-gray-200',
          variantStyles[variant],
          animationStyles[animation],
          className
        )}
        style={{
          width: width,
          height: height || (variant === 'text' ? undefined : width),
          ...style,
        }}
        {...props}
      />
    );
  }
);

Skeleton.displayName = 'Skeleton';

// Preset Skeletons for common patterns
export const SkeletonText: React.FC<{ lines?: number; className?: string }> = ({
  lines = 3,
  className,
}) => (
  <div className={cn('space-y-2', className)}>
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton
        key={i}
        variant="text"
        width={i === lines - 1 ? '75%' : '100%'}
      />
    ))}
  </div>
);

export const SkeletonCard: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn('p-4 space-y-3', className)}>
    <Skeleton variant="rectangular" height={120} />
    <Skeleton variant="text" width="60%" />
    <Skeleton variant="text" />
    <Skeleton variant="text" width="80%" />
  </div>
);

export const SkeletonAvatar: React.FC<{ size?: number; className?: string }> = ({
  size = 40,
  className,
}) => (
  <Skeleton
    variant="circular"
    width={size}
    height={size}
    className={className}
  />
);
