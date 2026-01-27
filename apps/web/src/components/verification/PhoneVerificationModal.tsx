import { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { FormField, Input } from '../ui/FormField';
import { OTPInputWithTimer } from '../ui/OTPInput';
import { Spinner } from '../ui/Spinner';
import { usePhoneVerification, maskPhoneForDisplay } from '../../hooks/usePhoneVerification';

export interface PhoneVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onVerified?: () => void;
  initialPhone?: string;
  currentPhone?: string;
}

type Step = 'phone' | 'verify' | 'success';

/**
 * Phone Verification Modal
 * Handles phone number entry and OTP verification
 */
export function PhoneVerificationModal({
  isOpen,
  onClose,
  onVerified,
  initialPhone = '',
  currentPhone,
}: PhoneVerificationModalProps) {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState(initialPhone || currentPhone || '');
  const [otp, setOtp] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const {
    state,
    sendCode,
    verifyCode,
    resendCode,
    reset,
  } = usePhoneVerification({
    onVerified: () => {
      setStep('success');
      onVerified?.();
    },
    codeExpirationSeconds: 300, // 5 minutes
    resendCooldownSeconds: 60, // 1 minute
  });

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep(currentPhone ? 'verify' : 'phone');
      setPhone(initialPhone || currentPhone || '');
      setOtp('');
      setPhoneError(null);
      reset();
    }
  }, [isOpen, initialPhone, currentPhone, reset]);

  // Validate phone number format
  const validatePhone = (value: string): string | null => {
    const digits = value.replace(/\D/g, '');

    if (!digits) {
      return 'Numéro de téléphone requis';
    }

    // Burkina Faso format: 8 digits or with country code
    if (digits.length === 8 || (digits.startsWith('226') && digits.length === 11)) {
      return null;
    }

    return 'Format invalide. Utilisez 8 chiffres (ex: 70123456)';
  };

  // Handle phone submission
  const handlePhoneSubmit = async () => {
    const error = validatePhone(phone);
    if (error) {
      setPhoneError(error);
      return;
    }

    // Format phone with country code
    const digits = phone.replace(/\D/g, '');
    const formattedPhone = digits.startsWith('226') ? `+${digits}` : `+226${digits}`;

    const success = await sendCode(formattedPhone);
    if (success) {
      setStep('verify');
    }
  };

  // Handle OTP verification
  const handleVerifyCode = async (code: string) => {
    await verifyCode(code);
  };

  // Handle modal close
  const handleClose = () => {
    if (step !== 'success' && state.step !== 'verifying') {
      onClose();
    }
  };

  // Handle going back to phone entry
  const handleBack = () => {
    setStep('phone');
    setOtp('');
    reset();
  };

  // Render phone entry step
  const renderPhoneStep = () => (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto w-16 h-16 bg-amber-500/20 rounded-full flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-white mb-2">
          Vérifier votre numéro
        </h3>
        <p className="text-slate-400 text-sm">
          Entrez votre numéro de téléphone pour recevoir un code de vérification par SMS.
        </p>
      </div>

      <FormField
        label="Numéro de téléphone"
        error={phoneError || undefined}
        helperText="Format: 70 12 34 56"
        required
      >
        <div className="flex">
          <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-slate-600 bg-slate-700 text-slate-300 text-sm">
            +226
          </span>
          <Input
            type="tel"
            placeholder="70 12 34 56"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setPhoneError(null);
            }}
            className="rounded-l-none"
            disabled={state.step === 'sending'}
          />
        </div>
      </FormField>

      <Button
        variant="primary"
        fullWidth
        onClick={handlePhoneSubmit}
        isLoading={state.step === 'sending'}
        loadingText="Envoi en cours..."
      >
        Envoyer le code
      </Button>
    </div>
  );

  // Render verification step
  const renderVerifyStep = () => (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-white mb-2">
          Entrez le code
        </h3>
        <p className="text-slate-400 text-sm">
          Un code à 6 chiffres a été envoyé au{' '}
          <span className="text-white font-medium">{maskPhoneForDisplay(state.phone)}</span>
        </p>
      </div>

      {state.error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          <p className="text-red-400 text-sm text-center">{state.error}</p>
        </div>
      )}

      <OTPInputWithTimer
        length={6}
        value={otp}
        onChange={setOtp}
        onComplete={handleVerifyCode}
        disabled={state.step === 'verifying'}
        error={!!state.error}
        expiresIn={state.expiresIn}
        onResend={resendCode}
        canResend={state.canResend}
        isResending={state.step === 'sending'}
      />

      {state.step === 'verifying' && (
        <div className="flex justify-center">
          <Spinner size="md" />
        </div>
      )}

      <div className="flex justify-between">
        <Button
          variant="ghost"
          onClick={handleBack}
          disabled={state.step === 'verifying'}
        >
          Changer le numéro
        </Button>

        <Button
          variant="primary"
          onClick={() => handleVerifyCode(otp)}
          disabled={otp.length !== 6 || state.step === 'verifying'}
          isLoading={state.step === 'verifying'}
          loadingText="Vérification..."
        >
          Vérifier
        </Button>
      </div>
    </div>
  );

  // Render success step
  const renderSuccessStep = () => (
    <div className="space-y-6 text-center">
      <div className="mx-auto w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center">
        <svg className="w-10 h-10 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <div>
        <h3 className="text-xl font-semibold text-white mb-2">
          Numéro vérifié !
        </h3>
        <p className="text-slate-400">
          Votre numéro de téléphone a été vérifié avec succès.
        </p>
      </div>

      <Button
        variant="primary"
        fullWidth
        onClick={onClose}
      >
        Fermer
      </Button>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={step === 'success' ? undefined : 'Vérification du téléphone'}
      size="sm"
      closeOnOverlayClick={step !== 'verifying'}
      closeOnEscape={step !== 'verifying'}
      showCloseButton={step !== 'success'}
    >
      {step === 'phone' && renderPhoneStep()}
      {step === 'verify' && renderVerifyStep()}
      {step === 'success' && renderSuccessStep()}
    </Modal>
  );
}

export default PhoneVerificationModal;
