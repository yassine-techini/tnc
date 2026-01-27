/**
 * Mobile client-side validation using shared Zod schemas
 * Validates user input before sending to API to save bandwidth and improve UX
 */

import { z } from 'zod';
import {
  loginSchema,
  registerSchema,
  passwordSchema,
  totpCodeSchema,
  phoneSchema,
} from '@tnc-trading/shared/validators';

// Re-export shared schemas for direct use
export { loginSchema, registerSchema, passwordSchema, totpCodeSchema, phoneSchema };

// ============================================
// MOBILE-SPECIFIC VALIDATORS
// ============================================

export const depositFormSchema = z.object({
  amount: z.number().min(1000, 'Montant minimum: 1 000 XOF').max(5_000_000, 'Montant maximum: 5 000 000 XOF'),
  paymentMethod: z.enum(['orange_money', 'moov_money'], {
    errorMap: () => ({ message: 'Méthode de paiement requise' }),
  }),
  phoneNumber: phoneSchema,
});

export const withdrawFormSchema = z.object({
  amount: z.number().min(1000, 'Montant minimum: 1 000 XOF').max(5_000_000, 'Montant maximum: 5 000 000 XOF'),
  paymentMethod: z.enum(['orange_money', 'moov_money'], {
    errorMap: () => ({ message: 'Méthode de paiement requise' }),
  }),
  phoneNumber: phoneSchema,
});

export const buyFormSchema = z.object({
  amount: z.number().positive('Montant doit être positif'),
  amountType: z.enum(['grams', 'xof']),
});

export const sellFormSchema = z.object({
  amount: z.number().positive('Montant doit être positif'),
  amountType: z.enum(['grams', 'xof']),
});

// ============================================
// VALIDATION HELPER
// ============================================

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors: Record<string, string>;
  firstError?: string;
}

/**
 * Validate form data against a Zod schema.
 * Returns structured errors keyed by field name for easy form integration.
 */
export function validateForm<T>(schema: z.ZodSchema<T>, data: unknown): ValidationResult<T> {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data, errors: {} };
  }

  const errors: Record<string, string> = {};
  let firstError: string | undefined;

  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_root';
    if (!errors[key]) {
      errors[key] = issue.message;
    }
    if (!firstError) {
      firstError = issue.message;
    }
  }

  return { success: false, errors, firstError };
}
