/**
 * TNC Trading - Zod Validators
 */

import { z } from 'zod';

/**
 * Les messages de validation, bilingues — ADR 027.
 *
 * Re-exportes ici pour que `@tnc-trading/shared/validators` reste le seul point
 * d'entree : un schema et la facon de dire pourquoi il refuse ne se trouvent pas
 * a deux endroits differents.
 */
export * from './messages';

// ============================================
// COMMON VALIDATORS
// ============================================

export const uuidSchema = z.string().uuid();

export const emailSchema = z.string().email();

/**
 * Un numero de telephone international — ADR 021.
 *
 * La regle etait `/^\+226[0-9]{8}$/` : celle d'un seul pays. L'inscription, elle,
 * acceptait n'importe quel numero international, si bien qu'un raffineur
 * ougandais s'inscrivait sans peine puis ne pouvait plus jamais corriger son
 * numero — deux regles pour un meme champ, dont la plus stricte au mauvais bout.
 *
 * Une seule regle, partagee : l'inscription et la mise a jour ne peuvent plus
 * diverger.
 *
 * Le prefixe du pays n'est PAS impose. Le telephone sert au code a usage unique,
 * qui fonctionne partout, et au paiement mobile, qui exige bien un numero local —
 * mais c'est le retrait qui doit le dire, au moment ou la methode est choisie.
 * Refuser ici bloquerait un titulaire de la diaspora sur toutes ses operations.
 */
export const phoneSchema = z
  .string()
  .min(10)
  .max(20)
  .regex(/^\+?[0-9]{10,15}$/, 'TELEPHONE_INTERNATIONAL');

export const passwordSchema = z
  .string()
  .min(12)
  .regex(/[A-Z]/, 'MDP_MAJUSCULE')
  .regex(/[a-z]/, 'MDP_MINUSCULE')
  .regex(/[0-9]/, 'MDP_CHIFFRE')
  .regex(/[^A-Za-z0-9]/, 'MDP_SPECIAL');

export const totpCodeSchema = z
  .string()
  .length(6)
  .regex(/^[0-9]+$/, 'CODE_CHIFFRES_SEULEMENT');

// ============================================
// AUTH VALIDATORS
// ============================================

export const registerSchema = z.object({
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  country: z.string().length(2).default('BF'),
});

export const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
  totpCode: totpCodeSchema.optional(),
});

export const verifyCodeSchema = z.object({
  code: z.string().length(6),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

// ============================================
// KYC VALIDATORS
// ============================================

export const documentTypeSchema = z.enum(['CNIB', 'PASSPORT', 'PERMIT', 'CEDEAO']);

export const kycSubmitSchema = z.object({
  documentType: documentTypeSchema,
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'DATE_ISO'),
  nationality: z.string().length(2),
  address: z.string().min(5).optional(),
  city: z.string().min(2).optional(),
  documentNumber: z.string().min(5),
});

export const kycReviewSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  rejectionReason: z.string().min(10).optional(),
}).refine(
  (data) => data.action === 'APPROVE' || data.rejectionReason,
  { message: 'MOTIF_REJET_REQUIS', path: ['rejectionReason'] }
);

// ============================================
// MARKET VALIDATORS
// ============================================

export const quoteRequestSchema = z.object({
  type: z.enum(['BUY', 'SELL']),
  amount: z.number().positive(),
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
  { message: 'PAIEMENT_DETAILS_INCOMPLETS', path: ['payoutDetails'] }
);

// ============================================
// WALLET VALIDATORS
// ============================================

export const depositRequestSchema = z.object({
  amount: z.number().min(1000),
  method: z.enum(['orange_money', 'moov_money', 'card']),
});

export const withdrawRequestSchema = z.object({
  amount: z.number().min(1000),
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
  { message: 'PAIEMENT_DETAILS_INCOMPLETS', path: ['details'] }
);

// ============================================
// ADMIN VALIDATORS
// ============================================

export const stockAdjustSchema = z.object({
  action: z.enum(['ADD', 'REMOVE']),
  amount: z.number().positive(),
  reason: z.string().min(10),
  auditReference: z.string().optional(),
});

export const withdrawalReviewSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  rejectionReason: z.string().min(10).optional(),
}).refine(
  (data) => data.action === 'APPROVE' || data.rejectionReason,
  { message: 'MOTIF_REJET_REQUIS', path: ['rejectionReason'] }
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
