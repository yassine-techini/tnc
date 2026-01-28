import { useState, useCallback } from 'react';
import { useToast } from '../components/ui/Toast';

export interface ApiErrorState {
  error: string | null;
  code: string | null;
}

export interface UseApiErrorReturn {
  error: string | null;
  code: string | null;
  setError: (error: string, code?: string) => void;
  clearError: () => void;
  handleError: (err: unknown) => void;
}

/**
 * Error messages mapping for common API error codes
 */
const ERROR_MESSAGES: Record<string, string> = {
  // Auth errors
  AUTH_INVALID_CREDENTIALS: 'Email ou mot de passe incorrect',
  AUTH_ACCOUNT_LOCKED: 'Compte temporairement bloque. Reessayez dans 15 minutes.',
  AUTH_2FA_REQUIRED: 'Code 2FA requis',
  AUTH_2FA_INVALID: 'Code 2FA invalide',
  AUTH_TOKEN_EXPIRED: 'Session expiree. Veuillez vous reconnecter.',
  AUTH_UNAUTHORIZED: 'Non autorise',

  // KYC errors
  KYC_LEVEL_INSUFFICIENT: 'Niveau KYC insuffisant pour cette opération',
  KYC_DOCUMENT_INVALID: 'Document non reconnu ou illisible',
  KYC_VERIFICATION_PENDING: 'Vérification en cours',

  // Trading errors
  TRADING_INSUFFICIENT_STOCK: 'Stock insuffisant',
  TRADING_INSUFFICIENT_BALANCE: 'Solde insuffisant',
  TRADING_LIMIT_EXCEEDED: 'Limite journalière/mensuelle dépassée',
  TRADING_PRICE_EXPIRED: 'Prix expiré, veuillez réessayer',

  // Payment errors
  PAYMENT_FAILED: 'Paiement échoué',
  PAYMENT_PROVIDER_ERROR: 'Erreur du fournisseur de paiement',

  // Withdrawal errors
  WITHDRAWAL_LIMIT_EXCEEDED: 'Limite de retrait dépassée',
  WITHDRAWAL_PENDING: 'Un retrait est déjà en cours',

  // Generic errors
  NETWORK_ERROR: 'Erreur de connexion. Vérifiez votre connexion internet.',
  SERVER_ERROR: 'Erreur serveur. Veuillez réessayer plus tard.',
  VALIDATION_ERROR: 'Données invalides',
  NOT_FOUND: 'Ressource non trouvée',
  RATE_LIMITED: 'Trop de requêtes. Veuillez patienter.',
  UNKNOWN: 'Une erreur est survenue',
};

/**
 * Hook for handling API errors consistently
 */
export function useApiError(): UseApiErrorReturn {
  const [state, setState] = useState<ApiErrorState>({
    error: null,
    code: null,
  });
  const { addToast } = useToast();

  const setError = useCallback((error: string, code?: string) => {
    setState({ error, code: code || null });
  }, []);

  const clearError = useCallback(() => {
    setState({ error: null, code: null });
  }, []);

  const handleError = useCallback(
    (err: unknown) => {
      let errorMessage = ERROR_MESSAGES.UNKNOWN;
      let errorCode = 'UNKNOWN';

      if (err instanceof Error) {
        // Check if it's an API error with a code
        const apiError = err as Error & { code?: string };
        if (apiError.code && ERROR_MESSAGES[apiError.code]) {
          errorMessage = ERROR_MESSAGES[apiError.code];
          errorCode = apiError.code;
        } else {
          errorMessage = err.message || ERROR_MESSAGES.UNKNOWN;
        }
      } else if (typeof err === 'string') {
        errorMessage = err;
      }

      // Handle network errors
      if (errorMessage.includes('fetch') || errorMessage.includes('network')) {
        errorMessage = ERROR_MESSAGES.NETWORK_ERROR;
        errorCode = 'NETWORK_ERROR';
      }

      setState({ error: errorMessage, code: errorCode });

      // Show toast notification
      addToast('error', errorMessage);
    },
    [addToast]
  );

  return {
    error: state.error,
    code: state.code,
    setError,
    clearError,
    handleError,
  };
}

/**
 * Get error message for a specific error code
 */
export function getErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] || ERROR_MESSAGES.UNKNOWN;
}

export default useApiError;
