/**
 * TNC Trading - Zod Validators
 */

import { z } from 'zod';

// ============================================
// COMMON VALIDATORS
// ============================================

export const uuidSchema = z.string().uuid();

export const emailSchema = z.string().email('Format email invalide');

export const phoneSchema = z
  .string()
  .regex(/^\+226[0-9]{8}$/, 'Numéro de téléphone invalide (format: +226XXXXXXXX)');

export const passwordSchema = z
  .string()
  .min(12, 'Le mot de passe doit contenir au moins 12 caractères')
  .regex(/[A-Z]/, 'Le mot de passe doit contenir au moins une majuscule')
  .regex(/[a-z]/, 'Le mot de passe doit contenir au moins une minuscule')
  .regex(/[0-9]/, 'Le mot de passe doit contenir au moins un chiffre')
  .regex(/[^A-Za-z0-9]/, 'Le mot de passe doit contenir au moins un caractère spécial');

export const totpCodeSchema = z
  .string()
  .length(6, 'Le code doit contenir 6 chiffres')
  .regex(/^[0-9]+$/, 'Le code ne doit contenir que des chiffres');

// ============================================
// AUTH VALIDATORS
// ============================================

export const registerSchema = z.object({
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  country: z.string().length(2, 'Code pays invalide').default('BF'),
});

export const loginSchema = z.object({
  identifier: z.string().min(1, 'Email ou téléphone requis'),
  password: z.string().min(1, 'Mot de passe requis'),
  totpCode: totpCodeSchema.optional(),
});

export const verifyCodeSchema = z.object({
  code: z.string().length(6, 'Code invalide'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token requis'),
  newPassword: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Mot de passe actuel requis'),
  newPassword: passwordSchema,
});

// ============================================
// KYC VALIDATORS
// ============================================

export const documentTypeSchema = z.enum(['CNIB', 'PASSPORT', 'PERMIT', 'CEDEAO']);

export const kycSubmitSchema = z.object({
  documentType: documentTypeSchema,
  firstName: z.string().min(2, 'Prénom requis'),
  lastName: z.string().min(2, 'Nom requis'),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format date invalide (AAAA-MM-JJ)'),
  nationality: z.string().length(2, 'Code pays invalide'),
  address: z.string().min(5, 'Adresse requise').optional(),
  city: z.string().min(2, 'Ville requise').optional(),
  documentNumber: z.string().min(5, 'Numéro de document requis'),
});

export const kycReviewSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  rejectionReason: z.string().min(10, 'Motif de rejet requis').optional(),
}).refine(
  (data) => data.action === 'APPROVE' || data.rejectionReason,
  { message: 'Motif de rejet requis', path: ['rejectionReason'] }
);

// ============================================
// MARKET VALIDATORS
// ============================================

export const quoteRequestSchema = z.object({
  type: z.enum(['BUY', 'SELL']),
  amount: z.number().positive('Montant doit être positif'),
  amountType: z.enum(['GRAMS', 'XOF']),
});

export const buyRequestSchema = z.object({
  quoteId: uuidSchema,
  paymentMethod: z.enum(['orange_money', 'moov_money', 'card', 'bank']),
});

export const sellRequestSchema = z.object({
  quoteId: uuidSchema,
  totpCode: totpCodeSchema,
  payoutMethod: z.enum(['orange_money', 'moov_money', 'bank']),
  payoutDetails: z.object({
    phoneNumber: phoneSchema.optional(),
    bankAccount: z.string().optional(),
    bankName: z.string().optional(),
  }),
}).refine(
  (data) => {
    if (data.payoutMethod === 'bank') {
      return data.payoutDetails.bankAccount && data.payoutDetails.bankName;
    }
    return data.payoutDetails.phoneNumber;
  },
  { message: 'Détails de paiement incomplets', path: ['payoutDetails'] }
);

// ============================================
// WALLET VALIDATORS
// ============================================

export const depositRequestSchema = z.object({
  amount: z.number().min(1000, 'Montant minimum: 1000 XOF'),
  method: z.enum(['orange_money', 'moov_money', 'card']),
});

export const withdrawRequestSchema = z.object({
  amount: z.number().min(1000, 'Montant minimum: 1000 XOF'),
  method: z.enum(['orange_money', 'moov_money', 'bank']),
  totpCode: totpCodeSchema,
  details: z.object({
    phoneNumber: phoneSchema.optional(),
    bankAccount: z.string().optional(),
    bankName: z.string().optional(),
  }),
}).refine(
  (data) => {
    if (data.method === 'bank') {
      return data.details.bankAccount && data.details.bankName;
    }
    return data.details.phoneNumber;
  },
  { message: 'Détails de paiement incomplets', path: ['details'] }
);

// ============================================
// ADMIN VALIDATORS
// ============================================

export const stockAdjustSchema = z.object({
  action: z.enum(['ADD', 'REMOVE']),
  amount: z.number().positive('Montant doit être positif'),
  reason: z.string().min(10, 'Motif requis'),
  auditReference: z.string().optional(),
});

export const withdrawalReviewSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  rejectionReason: z.string().min(10, 'Motif de rejet requis').optional(),
}).refine(
  (data) => data.action === 'APPROVE' || data.rejectionReason,
  { message: 'Motif de rejet requis', path: ['rejectionReason'] }
);

export const configUpdateSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

// ============================================
// PAGINATION VALIDATORS
// ============================================

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const transactionFiltersSchema = paginationSchema.extend({
  type: z.enum(['BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL', 'FEE']).optional(),
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// ============================================
// TYPE EXPORTS
// ============================================

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type KycSubmitInput = z.infer<typeof kycSubmitSchema>;
export type QuoteRequestInput = z.infer<typeof quoteRequestSchema>;
export type BuyRequestInput = z.infer<typeof buyRequestSchema>;
export type SellRequestInput = z.infer<typeof sellRequestSchema>;
export type DepositRequestInput = z.infer<typeof depositRequestSchema>;
export type WithdrawRequestInput = z.infer<typeof withdrawRequestSchema>;
