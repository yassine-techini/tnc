/**
 * Error Handling Utilities
 * Gestion des erreurs et messages d'erreur
 */

import { ERROR_CODES, ERROR_MESSAGES } from '../constants/index.js';
import type { ApiError } from '../types/index.js';

type ErrorCode = keyof typeof ERROR_CODES;

/**
 * Get error message in French for an error code
 */
export function getErrorMessage(code: string): string {
  const errorCode = code as ErrorCode;
  return ERROR_MESSAGES[errorCode] || 'Une erreur est survenue';
}

/**
 * Check if an error response is an API error
 */
export function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'success' in error &&
    error.success === false &&
    'error' in error
  );
}

/**
 * Extract error message from various error types
 */
export function extractErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    return error.error.message || getErrorMessage(error.error.code);
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Une erreur inattendue est survenue';
}

/**
 * Create a standardized error object
 */
export function createError(
  code: string,
  message?: string,
  details?: Record<string, unknown>
): ApiError {
  return {
    success: false,
    error: {
      code,
      message: message || getErrorMessage(code),
      details,
    },
    requestId: crypto.randomUUID(),
  };
}

/**
 * Check if error is a network error
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.message.includes('fetch') ||
      error.message.includes('network') ||
      error.message.includes('ECONNREFUSED') ||
      error.name === 'TypeError'
    );
  }
  return false;
}

/**
 * Check if error is an authentication error
 */
export function isAuthError(error: unknown): boolean {
  if (isApiError(error)) {
    return error.error.code.startsWith('AUTH_');
  }
  return false;
}

/**
 * Check if error is a validation error
 */
export function isValidationError(error: unknown): boolean {
  if (isApiError(error)) {
    return error.error.code === 'VALIDATION_ERROR';
  }
  return false;
}

/**
 * Check if error requires re-authentication
 */
export function requiresReauth(error: unknown): boolean {
  if (isApiError(error)) {
    return [
      'AUTH_TOKEN_EXPIRED',
      'AUTH_TOKEN_INVALID',
      'AUTH_ACCOUNT_LOCKED',
      'AUTH_ACCOUNT_DISABLED',
    ].includes(error.error.code);
  }
  return false;
}

/**
 * Check if error is a rate limit error
 */
export function isRateLimitError(error: unknown): boolean {
  if (isApiError(error)) {
    return error.error.code === 'RATE_LIMITED';
  }
  return false;
}

/**
 * Get user-friendly error title based on error code
 */
export function getErrorTitle(code: string): string {
  if (code.startsWith('AUTH_')) return 'Erreur d\'authentification';
  if (code.startsWith('KYC_')) return 'Erreur de verification';
  if (code.startsWith('TRADING_')) return 'Erreur de transaction';
  if (code.startsWith('PAYMENT_')) return 'Erreur de paiement';
  if (code.startsWith('WITHDRAWAL_')) return 'Erreur de retrait';
  if (code === 'VALIDATION_ERROR') return 'Donnees invalides';
  if (code === 'NOT_FOUND') return 'Non trouve';
  if (code === 'FORBIDDEN') return 'Acces refuse';
  if (code === 'RATE_LIMITED') return 'Limite atteinte';
  return 'Erreur';
}

/**
 * Log error with context (for debugging)
 */
export function logError(
  error: unknown,
  context?: {
    action?: string;
    userId?: string;
    data?: Record<string, unknown>;
  }
): void {
  const errorMessage = extractErrorMessage(error);
  const errorCode = isApiError(error) ? error.error.code : 'UNKNOWN';

  console.error('[Error]', {
    code: errorCode,
    message: errorMessage,
    context,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Format validation errors for display
 */
export function formatValidationErrors(
  errors: Record<string, string[]> | string[]
): string[] {
  if (Array.isArray(errors)) {
    return errors;
  }

  const messages: string[] = [];
  for (const [field, fieldErrors] of Object.entries(errors)) {
    for (const error of fieldErrors) {
      messages.push(`${field}: ${error}`);
    }
  }
  return messages;
}

/**
 * Create a retry handler for API calls
 */
export function createRetryHandler(
  maxRetries: number = 3,
  delayMs: number = 1000
) {
  return async function withRetry<T>(
    fn: () => Promise<T>,
    shouldRetry: (error: unknown) => boolean = isNetworkError
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (!shouldRetry(error) || attempt === maxRetries - 1) {
          throw error;
        }

        // Exponential backoff
        await new Promise(resolve =>
          setTimeout(resolve, delayMs * Math.pow(2, attempt))
        );
      }
    }

    throw lastError;
  };
}
