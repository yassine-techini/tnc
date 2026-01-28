import { useState, useCallback } from 'react';
import { useToast } from '../components/ui/Toast';

export type VerificationStep = 'idle' | 'sending' | 'sent' | 'verifying' | 'verified' | 'error';

export interface PhoneVerificationState {
  step: VerificationStep;
  phone: string;
  error: string | null;
  expiresIn: number;
  canResend: boolean;
  isVerified: boolean;
}

export interface UsePhoneVerificationOptions {
  onVerified?: () => void;
  onError?: (error: string) => void;
  codeExpirationSeconds?: number;
  resendCooldownSeconds?: number;
}

export interface UsePhoneVerificationReturn {
  state: PhoneVerificationState;
  sendCode: (phone: string) => Promise<boolean>;
  verifyCode: (code: string) => Promise<boolean>;
  resendCode: () => Promise<boolean>;
  reset: () => void;
  setPhone: (phone: string) => void;
}

const DEFAULT_EXPIRATION = 300; // 5 minutes
const DEFAULT_RESEND_COOLDOWN = 60; // 1 minute

/**
 * Hook for managing phone verification flow
 */
export function usePhoneVerification(
  options: UsePhoneVerificationOptions = {}
): UsePhoneVerificationReturn {
  const {
    onVerified,
    onError,
    codeExpirationSeconds = DEFAULT_EXPIRATION,
    resendCooldownSeconds = DEFAULT_RESEND_COOLDOWN,
  } = options;

  const { addToast } = useToast();

  const [state, setState] = useState<PhoneVerificationState>({
    step: 'idle',
    phone: '',
    error: null,
    expiresIn: codeExpirationSeconds,
    canResend: false,
    isVerified: false,
  });

  // Send verification code to phone
  const sendCode = useCallback(
    async (phone: string): Promise<boolean> => {
      try {
        setState((prev) => ({
          ...prev,
          step: 'sending',
          phone,
          error: null,
        }));

        // API call to send verification code
        const response = await fetch('/api/v1/auth/verify-phone/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
          },
          body: JSON.stringify({ phone }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error?.message || 'Erreur lors de l\'envoi du code');
        }

        setState((prev) => ({
          ...prev,
          step: 'sent',
          expiresIn: codeExpirationSeconds,
          canResend: false,
        }));

        addToast('success', 'Code de vérification envoyé');

        // Enable resend after cooldown
        setTimeout(() => {
          setState((prev) => ({
            ...prev,
            canResend: true,
          }));
        }, resendCooldownSeconds * 1000);

        return true;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue';

        setState((prev) => ({
          ...prev,
          step: 'error',
          error: errorMessage,
        }));

        onError?.(errorMessage);

        addToast('error', errorMessage);

        return false;
      }
    },
    [codeExpirationSeconds, resendCooldownSeconds, addToast, onError]
  );

  // Verify the code
  const verifyCode = useCallback(
    async (code: string): Promise<boolean> => {
      try {
        setState((prev) => ({
          ...prev,
          step: 'verifying',
          error: null,
        }));

        // API call to verify code
        const response = await fetch('/api/v1/auth/verify-phone/confirm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
          },
          body: JSON.stringify({
            phone: state.phone,
            code,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error?.message || 'Code invalide');
        }

        setState((prev) => ({
          ...prev,
          step: 'verified',
          isVerified: true,
        }));

        addToast('success', 'Numéro de téléphone vérifié');

        onVerified?.();

        return true;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Erreur de vérification';

        setState((prev) => ({
          ...prev,
          step: 'sent', // Go back to sent state to allow retry
          error: errorMessage,
        }));

        onError?.(errorMessage);

        addToast('error', errorMessage);

        return false;
      }
    },
    [state.phone, addToast, onVerified, onError]
  );

  // Resend verification code
  const resendCode = useCallback(async (): Promise<boolean> => {
    if (!state.canResend || !state.phone) {
      return false;
    }

    return sendCode(state.phone);
  }, [state.canResend, state.phone, sendCode]);

  // Reset state
  const reset = useCallback(() => {
    setState({
      step: 'idle',
      phone: '',
      error: null,
      expiresIn: codeExpirationSeconds,
      canResend: false,
      isVerified: false,
    });
  }, [codeExpirationSeconds]);

  // Set phone number
  const setPhone = useCallback((phone: string) => {
    setState((prev) => ({
      ...prev,
      phone,
    }));
  }, []);

  return {
    state,
    sendCode,
    verifyCode,
    resendCode,
    reset,
    setPhone,
  };
}

/**
 * Format phone number for display
 */
export function formatPhoneForDisplay(phone: string): string {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');

  // Handle Burkina Faso numbers
  if (digits.startsWith('226') || digits.length === 8) {
    const local = digits.startsWith('226') ? digits.slice(3) : digits;
    return `+226 ${local.slice(0, 2)} ${local.slice(2, 4)} ${local.slice(4, 6)} ${local.slice(6)}`;
  }

  return phone;
}

/**
 * Mask phone number for privacy
 */
export function maskPhoneForDisplay(phone: string): string {
  const formatted = formatPhoneForDisplay(phone);
  const parts = formatted.split(' ');

  if (parts.length >= 5) {
    return `${parts[0]} ${parts[1]} ** ** ${parts[4]}`;
  }

  return formatted.replace(/\d(?=\d{2})/g, '*');
}

export default usePhoneVerification;
