/**
 * Error Handling Utilities Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getErrorMessage,
  isApiError,
  extractErrorMessage,
  createError,
  isNetworkError,
  isAuthError,
  isValidationError,
  requiresReauth,
  isRateLimitError,
  getErrorTitle,
  logError,
  formatValidationErrors,
  createRetryHandler,
} from './errors.js';

describe('Error Utilities', () => {
  // ─── Get Error Message ──────────────────────────────────
  describe('getErrorMessage', () => {
    it('returns message for known error codes', () => {
      expect(getErrorMessage('AUTH_INVALID_CREDENTIALS')).toContain('incorrect');
    });

    it('returns default message for unknown codes', () => {
      expect(getErrorMessage('UNKNOWN_CODE')).toBe('Une erreur est survenue');
    });
  });

  // ─── Is API Error ───────────────────────────────────────
  describe('isApiError', () => {
    it('returns true for valid API error', () => {
      const error = {
        success: false,
        error: {
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Invalid credentials',
        },
        requestId: 'test-123',
      };

      expect(isApiError(error)).toBe(true);
    });

    it('returns false for non-API errors', () => {
      expect(isApiError(null)).toBe(false);
      expect(isApiError(undefined)).toBe(false);
      expect(isApiError('string error')).toBe(false);
      expect(isApiError({ success: true })).toBe(false);
      expect(isApiError({ success: false })).toBe(false);
      expect(isApiError(new Error('test'))).toBe(false);
    });
  });

  // ─── Extract Error Message ──────────────────────────────
  describe('extractErrorMessage', () => {
    it('extracts message from API error', () => {
      const error = {
        success: false,
        error: {
          code: 'TEST_ERROR',
          message: 'Test error message',
        },
        requestId: 'test-123',
      };

      expect(extractErrorMessage(error)).toBe('Test error message');
    });

    it('extracts message from Error instance', () => {
      const error = new Error('Standard error message');
      expect(extractErrorMessage(error)).toBe('Standard error message');
    });

    it('returns string errors as-is', () => {
      expect(extractErrorMessage('Simple string error')).toBe('Simple string error');
    });

    it('returns default message for unknown types', () => {
      expect(extractErrorMessage(null)).toBe('Une erreur inattendue est survenue');
      expect(extractErrorMessage(123)).toBe('Une erreur inattendue est survenue');
      expect(extractErrorMessage({})).toBe('Une erreur inattendue est survenue');
    });
  });

  // ─── Create Error ───────────────────────────────────────
  describe('createError', () => {
    it('creates standardized error object', () => {
      const error = createError('TEST_ERROR', 'Test message');

      expect(error.success).toBe(false);
      expect(error.error.code).toBe('TEST_ERROR');
      expect(error.error.message).toBe('Test message');
      expect(error.requestId).toBeDefined();
    });

    it('uses default message if not provided', () => {
      const error = createError('AUTH_INVALID_CREDENTIALS');

      expect(error.error.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(error.error.message).toBeDefined();
    });

    it('includes details if provided', () => {
      const error = createError('VALIDATION_ERROR', 'Invalid input', {
        field: 'email',
        reason: 'invalid format',
      });

      expect(error.error.details).toEqual({
        field: 'email',
        reason: 'invalid format',
      });
    });
  });

  // ─── Error Type Checks ──────────────────────────────────
  describe('isNetworkError', () => {
    it('returns true for fetch errors', () => {
      expect(isNetworkError(new Error('fetch failed'))).toBe(true);
      expect(isNetworkError(new Error('network error'))).toBe(true);
      expect(isNetworkError(new Error('ECONNREFUSED'))).toBe(true);
    });

    it('returns true for TypeError', () => {
      const error = new TypeError('Failed to fetch');
      expect(isNetworkError(error)).toBe(true);
    });

    it('returns false for other errors', () => {
      expect(isNetworkError(new Error('Regular error'))).toBe(false);
      expect(isNetworkError('string')).toBe(false);
      expect(isNetworkError(null)).toBe(false);
    });
  });

  describe('isAuthError', () => {
    it('returns true for auth-prefixed error codes', () => {
      const error = {
        success: false,
        error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid' },
        requestId: 'test',
      };
      expect(isAuthError(error)).toBe(true);
    });

    it('returns false for non-auth errors', () => {
      const error = {
        success: false,
        error: { code: 'TRADING_ERROR', message: 'Error' },
        requestId: 'test',
      };
      expect(isAuthError(error)).toBe(false);
    });

    it('returns false for non-API errors', () => {
      expect(isAuthError(new Error('AUTH_ERROR'))).toBe(false);
    });
  });

  describe('isValidationError', () => {
    it('returns true for validation error code', () => {
      const error = {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid' },
        requestId: 'test',
      };
      expect(isValidationError(error)).toBe(true);
    });

    it('returns false for other error codes', () => {
      const error = {
        success: false,
        error: { code: 'AUTH_ERROR', message: 'Error' },
        requestId: 'test',
      };
      expect(isValidationError(error)).toBe(false);
    });
  });

  describe('requiresReauth', () => {
    it('returns true for auth errors requiring re-login', () => {
      const errors = [
        'AUTH_TOKEN_EXPIRED',
        'AUTH_TOKEN_INVALID',
        'AUTH_ACCOUNT_LOCKED',
        'AUTH_ACCOUNT_DISABLED',
      ];

      for (const code of errors) {
        const error = {
          success: false,
          error: { code, message: 'Error' },
          requestId: 'test',
        };
        expect(requiresReauth(error)).toBe(true);
      }
    });

    it('returns false for other auth errors', () => {
      const error = {
        success: false,
        error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Error' },
        requestId: 'test',
      };
      expect(requiresReauth(error)).toBe(false);
    });
  });

  describe('isRateLimitError', () => {
    it('returns true for rate limit error code', () => {
      const error = {
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
        requestId: 'test',
      };
      expect(isRateLimitError(error)).toBe(true);
    });

    it('returns false for other errors', () => {
      const error = {
        success: false,
        error: { code: 'AUTH_ERROR', message: 'Error' },
        requestId: 'test',
      };
      expect(isRateLimitError(error)).toBe(false);
    });
  });

  // ─── Get Error Title ────────────────────────────────────
  describe('getErrorTitle', () => {
    it('returns appropriate titles for error categories', () => {
      expect(getErrorTitle('AUTH_INVALID_CREDENTIALS')).toContain('authentification');
      expect(getErrorTitle('KYC_DOCUMENT_INVALID')).toContain('verification');
      expect(getErrorTitle('TRADING_INSUFFICIENT_STOCK')).toContain('transaction');
      expect(getErrorTitle('PAYMENT_FAILED')).toContain('paiement');
      expect(getErrorTitle('WITHDRAWAL_LIMIT_EXCEEDED')).toContain('retrait');
      expect(getErrorTitle('VALIDATION_ERROR')).toContain('invalides');
      expect(getErrorTitle('NOT_FOUND')).toContain('trouve');
      expect(getErrorTitle('FORBIDDEN')).toContain('refuse');
      expect(getErrorTitle('RATE_LIMITED')).toContain('atteinte');
    });

    it('returns generic title for unknown codes', () => {
      expect(getErrorTitle('UNKNOWN_ERROR')).toBe('Erreur');
    });
  });

  // ─── Log Error ──────────────────────────────────────────
  describe('logError', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('logs error with context', () => {
      const error = new Error('Test error');
      logError(error, { action: 'test_action', userId: 'user-123' });

      expect(console.error).toHaveBeenCalledWith('[Error]', expect.objectContaining({
        code: 'UNKNOWN',
        message: 'Test error',
        context: { action: 'test_action', userId: 'user-123' },
      }));
    });

    it('extracts code from API errors', () => {
      const error = {
        success: false,
        error: { code: 'TEST_CODE', message: 'Test' },
        requestId: 'test',
      };
      logError(error);

      expect(console.error).toHaveBeenCalledWith('[Error]', expect.objectContaining({
        code: 'TEST_CODE',
      }));
    });
  });

  // ─── Format Validation Errors ───────────────────────────
  describe('formatValidationErrors', () => {
    it('returns array as-is', () => {
      const errors = ['Error 1', 'Error 2'];
      expect(formatValidationErrors(errors)).toEqual(errors);
    });

    it('formats object errors', () => {
      const errors = {
        email: ['Invalid format', 'Required'],
        password: ['Too short'],
      };

      const result = formatValidationErrors(errors);

      expect(result).toContain('email: Invalid format');
      expect(result).toContain('email: Required');
      expect(result).toContain('password: Too short');
    });
  });

  // ─── Retry Handler ──────────────────────────────────────
  describe('createRetryHandler', () => {
    it('retries on network errors', async () => {
      const retryHandler = createRetryHandler(3, 10);
      let attempts = 0;

      const fn = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          throw new TypeError('Failed to fetch');
        }
        return 'success';
      });

      const result = await retryHandler(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('does not retry on non-network errors', async () => {
      const retryHandler = createRetryHandler(3, 10);

      const fn = vi.fn().mockRejectedValue(new Error('Regular error'));

      await expect(retryHandler(fn)).rejects.toThrow('Regular error');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('throws after max retries', async () => {
      const retryHandler = createRetryHandler(3, 10);

      const fn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(retryHandler(fn)).rejects.toThrow('Failed to fetch');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('uses custom shouldRetry function', async () => {
      const retryHandler = createRetryHandler(3, 10);
      let attempts = 0;

      const fn = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Custom retriable error');
        }
        return 'success';
      });

      const shouldRetry = (error: unknown) =>
        error instanceof Error && error.message.includes('retriable');

      const result = await retryHandler(fn, shouldRetry);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('succeeds on first try', async () => {
      const retryHandler = createRetryHandler(3, 10);

      const fn = vi.fn().mockResolvedValue('immediate success');

      const result = await retryHandler(fn);

      expect(result).toBe('immediate success');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
