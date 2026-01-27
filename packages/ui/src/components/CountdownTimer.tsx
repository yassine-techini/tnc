/**
 * CountdownTimer Component
 * Countdown display for quote expiration
 */

import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '../utils/cn';

export interface CountdownTimerProps {
  expiresAt: Date | string | number;
  onExpire?: () => void;
  warningThreshold?: number; // seconds
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
  className?: string;
}

interface TimeRemaining {
  minutes: number;
  seconds: number;
  total: number;
}

const sizeStyles = {
  sm: {
    container: 'text-sm',
    icon: 'w-4 h-4',
    digits: 'text-base font-semibold',
  },
  md: {
    container: 'text-base',
    icon: 'w-5 h-5',
    digits: 'text-xl font-bold',
  },
  lg: {
    container: 'text-lg',
    icon: 'w-6 h-6',
    digits: 'text-2xl font-bold',
  },
};

export const CountdownTimer: React.FC<CountdownTimerProps> = ({
  expiresAt,
  onExpire,
  warningThreshold = 30,
  size = 'md',
  showIcon = true,
  className,
}) => {
  const calculateTimeRemaining = useCallback((): TimeRemaining => {
    const expiryTime = typeof expiresAt === 'string' || typeof expiresAt === 'number'
      ? new Date(expiresAt).getTime()
      : expiresAt.getTime();

    const now = Date.now();
    const total = Math.max(0, Math.floor((expiryTime - now) / 1000));

    return {
      minutes: Math.floor(total / 60),
      seconds: total % 60,
      total,
    };
  }, [expiresAt]);

  const [timeRemaining, setTimeRemaining] = useState<TimeRemaining>(calculateTimeRemaining);
  const [hasExpired, setHasExpired] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      const remaining = calculateTimeRemaining();
      setTimeRemaining(remaining);

      if (remaining.total <= 0 && !hasExpired) {
        setHasExpired(true);
        onExpire?.();
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [calculateTimeRemaining, hasExpired, onExpire]);

  const styles = sizeStyles[size];
  const isWarning = timeRemaining.total <= warningThreshold && timeRemaining.total > 0;
  const isExpired = timeRemaining.total <= 0;

  const padZero = (num: number): string => num.toString().padStart(2, '0');

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg',
        styles.container,
        isExpired
          ? 'bg-red-100 text-red-700'
          : isWarning
          ? 'bg-yellow-100 text-yellow-700 animate-pulse'
          : 'bg-gray-100 text-gray-700',
        className
      )}
    >
      {showIcon && (
        <svg
          className={cn(styles.icon, isWarning && 'animate-bounce')}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      )}

      {isExpired ? (
        <span className={styles.digits}>Expiré</span>
      ) : (
        <span className={styles.digits}>
          {padZero(timeRemaining.minutes)}:{padZero(timeRemaining.seconds)}
        </span>
      )}
    </div>
  );
};

CountdownTimer.displayName = 'CountdownTimer';

// Additional variant for inline use
export interface InlineCountdownProps {
  expiresAt: Date | string | number;
  onExpire?: () => void;
  prefix?: string;
  className?: string;
}

export const InlineCountdown: React.FC<InlineCountdownProps> = ({
  expiresAt,
  onExpire,
  prefix = 'Expire dans',
  className,
}) => {
  const calculateTimeRemaining = useCallback((): number => {
    const expiryTime = typeof expiresAt === 'string' || typeof expiresAt === 'number'
      ? new Date(expiresAt).getTime()
      : expiresAt.getTime();

    return Math.max(0, Math.floor((expiryTime - Date.now()) / 1000));
  }, [expiresAt]);

  const [seconds, setSeconds] = useState<number>(calculateTimeRemaining);
  const [hasExpired, setHasExpired] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      const remaining = calculateTimeRemaining();
      setSeconds(remaining);

      if (remaining <= 0 && !hasExpired) {
        setHasExpired(true);
        onExpire?.();
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [calculateTimeRemaining, hasExpired, onExpire]);

  const formatTime = (totalSeconds: number): string => {
    if (totalSeconds <= 0) return 'expiré';
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

  const isWarning = seconds <= 30 && seconds > 0;

  return (
    <span className={cn(isWarning && 'text-yellow-600 font-medium', className)}>
      {prefix} {formatTime(seconds)}
    </span>
  );
};

InlineCountdown.displayName = 'InlineCountdown';
