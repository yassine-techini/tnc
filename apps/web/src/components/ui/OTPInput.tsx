import { useState, useRef, useCallback, KeyboardEvent, ClipboardEvent, useEffect } from 'react';

export interface OTPInputProps {
  length?: number;
  value?: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  error?: boolean;
  autoFocus?: boolean;
  type?: 'number' | 'text';
}

/**
 * OTP Input component for verification codes
 */
export function OTPInput({
  length = 6,
  value = '',
  onChange,
  onComplete,
  disabled = false,
  error = false,
  autoFocus = true,
  type = 'number',
}: OTPInputProps) {
  const [otp, setOtp] = useState<string[]>(
    value ? value.split('').slice(0, length) : Array(length).fill('')
  );
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Sync external value changes
  useEffect(() => {
    if (value !== otp.join('')) {
      setOtp(value ? value.split('').slice(0, length) : Array(length).fill(''));
    }
  }, [value, length]);

  // Auto focus first input
  useEffect(() => {
    if (autoFocus && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [autoFocus]);

  const handleChange = useCallback(
    (index: number, inputValue: string) => {
      // Only allow single character
      const char = inputValue.slice(-1);

      // Validate based on type
      if (type === 'number' && !/^\d*$/.test(char)) {
        return;
      }

      const newOtp = [...otp];
      newOtp[index] = char;
      setOtp(newOtp);

      const otpValue = newOtp.join('');
      onChange(otpValue);

      // Move to next input if value entered
      if (char && index < length - 1) {
        inputRefs.current[index + 1]?.focus();
      }

      // Check if complete
      if (otpValue.length === length && !otpValue.includes('')) {
        onComplete?.(otpValue);
      }
    },
    [otp, length, type, onChange, onComplete]
  );

  const handleKeyDown = useCallback(
    (index: number, e: KeyboardEvent<HTMLInputElement>) => {
      // Handle backspace
      if (e.key === 'Backspace') {
        e.preventDefault();
        const newOtp = [...otp];

        if (otp[index]) {
          // Clear current field
          newOtp[index] = '';
          setOtp(newOtp);
          onChange(newOtp.join(''));
        } else if (index > 0) {
          // Move to previous field and clear it
          newOtp[index - 1] = '';
          setOtp(newOtp);
          onChange(newOtp.join(''));
          inputRefs.current[index - 1]?.focus();
        }
      }

      // Handle arrow keys
      if (e.key === 'ArrowLeft' && index > 0) {
        e.preventDefault();
        inputRefs.current[index - 1]?.focus();
      }
      if (e.key === 'ArrowRight' && index < length - 1) {
        e.preventDefault();
        inputRefs.current[index + 1]?.focus();
      }
    },
    [otp, length, onChange]
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pastedData = e.clipboardData.getData('text').trim();

      // Validate based on type
      if (type === 'number' && !/^\d+$/.test(pastedData)) {
        return;
      }

      const pastedChars = pastedData.slice(0, length).split('');
      const newOtp = [...otp];

      pastedChars.forEach((char, i) => {
        newOtp[i] = char;
      });

      setOtp(newOtp);
      const otpValue = newOtp.join('');
      onChange(otpValue);

      // Focus last filled input or the next empty one
      const lastIndex = Math.min(pastedChars.length, length) - 1;
      if (lastIndex >= 0) {
        inputRefs.current[lastIndex]?.focus();
      }

      // Check if complete
      if (otpValue.length === length && !otpValue.includes('')) {
        onComplete?.(otpValue);
      }
    },
    [otp, length, type, onChange, onComplete]
  );

  const handleFocus = useCallback((index: number) => {
    inputRefs.current[index]?.select();
  }, []);

  return (
    <div className="flex justify-center gap-2 sm:gap-3">
      {Array.from({ length }).map((_, index) => (
        <input
          key={index}
          ref={(el) => (inputRefs.current[index] = el)}
          type={type === 'number' ? 'tel' : 'text'}
          inputMode={type === 'number' ? 'numeric' : 'text'}
          pattern={type === 'number' ? '[0-9]*' : undefined}
          maxLength={1}
          value={otp[index] || ''}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          onFocus={() => handleFocus(index)}
          disabled={disabled}
          autoComplete="one-time-code"
          aria-label={`Chiffre ${index + 1} sur ${length}`}
          className={`
            w-10 h-12 sm:w-12 sm:h-14 text-center text-xl sm:text-2xl font-bold
            bg-slate-800 border-2 rounded-lg
            transition-all duration-200
            focus:outline-none focus:ring-2 focus:ring-amber-500/50
            disabled:opacity-50 disabled:cursor-not-allowed
            ${error
              ? 'border-red-500 text-red-400'
              : otp[index]
                ? 'border-amber-500 text-white'
                : 'border-slate-600 text-white'
            }
          `}
        />
      ))}
    </div>
  );
}

export interface OTPInputWithTimerProps extends OTPInputProps {
  expiresIn: number; // seconds
  onResend: () => void;
  isResending?: boolean;
  canResend?: boolean;
}

/**
 * OTP Input with countdown timer and resend button
 */
export function OTPInputWithTimer({
  expiresIn,
  onResend,
  isResending = false,
  canResend = true,
  ...props
}: OTPInputWithTimerProps) {
  const [timeLeft, setTimeLeft] = useState(expiresIn);

  useEffect(() => {
    setTimeLeft(expiresIn);
  }, [expiresIn]);

  useEffect(() => {
    if (timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-4">
      <OTPInput {...props} />

      <div className="text-center">
        {timeLeft > 0 ? (
          <p className="text-slate-400 text-sm">
            Code expire dans <span className="text-amber-400 font-medium">{formatTime(timeLeft)}</span>
          </p>
        ) : (
          <p className="text-red-400 text-sm">Code expire</p>
        )}

        <button
          type="button"
          onClick={onResend}
          disabled={!canResend || isResending || timeLeft > 0}
          className={`
            mt-2 text-sm font-medium transition-colors
            ${canResend && !isResending && timeLeft === 0
              ? 'text-amber-400 hover:text-amber-300 cursor-pointer'
              : 'text-slate-500 cursor-not-allowed'
            }
          `}
        >
          {isResending ? 'Envoi en cours...' : 'Renvoyer le code'}
        </button>
      </div>
    </div>
  );
}

export default OTPInput;
