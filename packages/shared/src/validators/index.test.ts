/**
 * Tests for Zod Validators
 */

import { describe, it, expect } from 'vitest';
import {
  emailSchema,
  phoneSchema,
  passwordSchema,
  totpCodeSchema,
  registerSchema,
  loginSchema,
  kycSubmitSchema,
  kycReviewSchema,
  quoteRequestSchema,
  buyRequestSchema,
  depositRequestSchema,
  withdrawRequestSchema,
  paginationSchema,
} from './index';

describe('Common Validators', () => {
  describe('emailSchema', () => {
    it('accepts valid emails', () => {
      expect(emailSchema.safeParse('user@example.com').success).toBe(true);
      expect(emailSchema.safeParse('test.user@domain.org').success).toBe(true);
    });

    it('rejects invalid emails', () => {
      expect(emailSchema.safeParse('invalid').success).toBe(false);
      expect(emailSchema.safeParse('no@domain').success).toBe(false);
      expect(emailSchema.safeParse('@example.com').success).toBe(false);
    });
  });

  describe('phoneSchema', () => {
    /**
     * La regle etait celle d'un seul pays, et ces tests l'epinglaient — y compris
     * « rejette +33 : mauvais pays ». L'inscription, elle, acceptait tout numero
     * international : un raffineur ougandais s'inscrivait puis ne pouvait plus
     * corriger son numero (ADR 021).
     */
    it('accepte un numero de chaque pays servi', () => {
      for (const numero of [
        '+22670123456', // Burkina Faso
        '+2250701234567', // Cote d'Ivoire
        '+256701234567', // Ouganda
        '+233201234567', // Ghana
      ]) {
        expect(phoneSchema.safeParse(numero).success, numero).toBe(true);
      }
    });

    it("n'impose pas l'indicatif d'un pays particulier", () => {
      // Le telephone sert au code a usage unique, qui fonctionne partout. Le
      // paiement mobile exige bien un numero local, mais c'est au retrait de le
      // dire — refuser ici bloquerait un titulaire de la diaspora sur toutes ses
      // operations.
      expect(phoneSchema.safeParse('+33612345678').success).toBe(true);
    });

    it("refuse ce qui n'est pas un numero", () => {
      expect(phoneSchema.safeParse('70123456').success).toBe(false); // trop court
      expect(phoneSchema.safeParse('+22670123').success).toBe(false); // trop court
      expect(phoneSchema.safeParse('+226 70 12 34 56').success).toBe(false); // espaces
      expect(phoneSchema.safeParse('abcdefghij').success).toBe(false);
    });
  });

  describe('passwordSchema', () => {
    it('accepts valid passwords', () => {
      expect(passwordSchema.safeParse('SecurePass123!').success).toBe(true);
      expect(passwordSchema.safeParse('MyP@ssw0rd2024').success).toBe(true);
    });

    it('rejects passwords without uppercase', () => {
      const result = passwordSchema.safeParse('securepass123!');
      expect(result.success).toBe(false);
    });

    it('rejects passwords without lowercase', () => {
      const result = passwordSchema.safeParse('SECUREPASS123!');
      expect(result.success).toBe(false);
    });

    it('rejects passwords without numbers', () => {
      const result = passwordSchema.safeParse('SecurePassword!');
      expect(result.success).toBe(false);
    });

    it('rejects passwords without special characters', () => {
      const result = passwordSchema.safeParse('SecurePass1234');
      expect(result.success).toBe(false);
    });

    it('rejects passwords too short', () => {
      const result = passwordSchema.safeParse('Short1!');
      expect(result.success).toBe(false);
    });
  });

  describe('totpCodeSchema', () => {
    it('accepts valid 6-digit codes', () => {
      expect(totpCodeSchema.safeParse('123456').success).toBe(true);
      expect(totpCodeSchema.safeParse('000000').success).toBe(true);
    });

    it('rejects invalid codes', () => {
      expect(totpCodeSchema.safeParse('12345').success).toBe(false); // Too short
      expect(totpCodeSchema.safeParse('1234567').success).toBe(false); // Too long
      expect(totpCodeSchema.safeParse('abcdef').success).toBe(false); // Letters
      expect(totpCodeSchema.safeParse('12345a').success).toBe(false); // Mixed
    });
  });
});

describe('Auth Validators', () => {
  describe('registerSchema', () => {
    it('accepts valid registration data', () => {
      const result = registerSchema.safeParse({
        email: 'user@example.com',
        phone: '+22670123456',
        password: 'SecurePass123!',
        country: 'BF',
      });
      expect(result.success).toBe(true);
    });

    it('uses default country if not provided', () => {
      const result = registerSchema.safeParse({
        email: 'user@example.com',
        phone: '+22670123456',
        password: 'SecurePass123!',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.country).toBe('BF');
      }
    });

    it('rejects invalid registration data', () => {
      const result = registerSchema.safeParse({
        email: 'invalid',
        phone: '123',
        password: 'weak',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('loginSchema', () => {
    it('accepts valid login with email', () => {
      const result = loginSchema.safeParse({
        identifier: 'user@example.com',
        password: 'anypassword',
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid login with phone', () => {
      const result = loginSchema.safeParse({
        identifier: '+22670123456',
        password: 'anypassword',
      });
      expect(result.success).toBe(true);
    });

    it('accepts login with TOTP code', () => {
      const result = loginSchema.safeParse({
        identifier: 'user@example.com',
        password: 'anypassword',
        totpCode: '123456',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty identifier', () => {
      const result = loginSchema.safeParse({
        identifier: '',
        password: 'anypassword',
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('KYC Validators', () => {
  describe('kycSubmitSchema', () => {
    const validKyc = {
      documentType: 'CNIB' as const,
      firstName: 'Jean',
      lastName: 'Dupont',
      dateOfBirth: '1990-01-15',
      nationality: 'BF',
      documentNumber: 'B12345678',
    };

    it('accepts valid KYC submission', () => {
      const result = kycSubmitSchema.safeParse(validKyc);
      expect(result.success).toBe(true);
    });

    it('accepts all document types', () => {
      const types = ['CNIB', 'PASSPORT', 'PERMIT', 'CEDEAO'] as const;
      for (const type of types) {
        const result = kycSubmitSchema.safeParse({ ...validKyc, documentType: type });
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid date format', () => {
      const result = kycSubmitSchema.safeParse({
        ...validKyc,
        dateOfBirth: '15/01/1990',
      });
      expect(result.success).toBe(false);
    });

    it('rejects short names', () => {
      const result = kycSubmitSchema.safeParse({
        ...validKyc,
        firstName: 'J',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('kycReviewSchema', () => {
    it('accepts approval without reason', () => {
      const result = kycReviewSchema.safeParse({ action: 'APPROVE' });
      expect(result.success).toBe(true);
    });

    it('accepts rejection with reason', () => {
      const result = kycReviewSchema.safeParse({
        action: 'REJECT',
        rejectionReason: 'Document illisible, veuillez soumettre une photo plus claire',
      });
      expect(result.success).toBe(true);
    });

    it('rejects rejection without reason', () => {
      const result = kycReviewSchema.safeParse({ action: 'REJECT' });
      expect(result.success).toBe(false);
    });

    it('rejects rejection with short reason', () => {
      const result = kycReviewSchema.safeParse({
        action: 'REJECT',
        rejectionReason: 'Bad',
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('Market Validators', () => {
  describe('quoteRequestSchema', () => {
    it('accepts valid buy quote request', () => {
      const result = quoteRequestSchema.safeParse({
        type: 'BUY',
        amount: 10,
        amountType: 'GRAMS',
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid sell quote request in XOF', () => {
      const result = quoteRequestSchema.safeParse({
        type: 'SELL',
        amount: 50000,
        amountType: 'XOF',
      });
      expect(result.success).toBe(true);
    });

    it('rejects zero amount', () => {
      const result = quoteRequestSchema.safeParse({
        type: 'BUY',
        amount: 0,
        amountType: 'GRAMS',
      });
      expect(result.success).toBe(false);
    });

    it('rejects negative amount', () => {
      const result = quoteRequestSchema.safeParse({
        type: 'BUY',
        amount: -10,
        amountType: 'GRAMS',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('buyRequestSchema', () => {
    it('accepts valid buy request', () => {
      const result = buyRequestSchema.safeParse({
        quoteId: '550e8400-e29b-41d4-a716-446655440000',
        paymentMethod: 'orange_money',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid UUID', () => {
      const result = buyRequestSchema.safeParse({
        quoteId: 'invalid-uuid',
        paymentMethod: 'orange_money',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid payment method', () => {
      const result = buyRequestSchema.safeParse({
        quoteId: '550e8400-e29b-41d4-a716-446655440000',
        paymentMethod: 'bitcoin',
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('Wallet Validators', () => {
  describe('depositRequestSchema', () => {
    it('accepts valid deposit', () => {
      const result = depositRequestSchema.safeParse({
        amount: 10000,
        method: 'orange_money',
      });
      expect(result.success).toBe(true);
    });

    it('rejects amount below minimum', () => {
      const result = depositRequestSchema.safeParse({
        amount: 500,
        method: 'orange_money',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('withdrawRequestSchema', () => {
    it('accepts valid mobile money withdrawal', () => {
      const result = withdrawRequestSchema.safeParse({
        amount: 50000,
        method: 'orange_money',
        totpCode: '123456',
        details: {
          phoneNumber: '+22670123456',
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid bank withdrawal', () => {
      const result = withdrawRequestSchema.safeParse({
        amount: 100000,
        method: 'bank',
        totpCode: '123456',
        details: {
          bankAccount: 'BF123456789',
          bankName: 'Coris Bank',
        },
      });
      expect(result.success).toBe(true);
    });

    it('rejects bank withdrawal without bank details', () => {
      const result = withdrawRequestSchema.safeParse({
        amount: 100000,
        method: 'bank',
        totpCode: '123456',
        details: {
          phoneNumber: '+22670123456',
        },
      });
      expect(result.success).toBe(false);
    });

    it('rejects mobile money withdrawal without phone', () => {
      const result = withdrawRequestSchema.safeParse({
        amount: 50000,
        method: 'orange_money',
        totpCode: '123456',
        details: {},
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('Pagination Validators', () => {
  describe('paginationSchema', () => {
    it('accepts valid pagination', () => {
      const result = paginationSchema.safeParse({ page: 1, limit: 20 });
      expect(result.success).toBe(true);
    });

    it('uses defaults when empty', () => {
      const result = paginationSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.limit).toBe(20);
      }
    });

    it('coerces string numbers', () => {
      const result = paginationSchema.safeParse({ page: '2', limit: '50' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(2);
        expect(result.data.limit).toBe(50);
      }
    });

    it('rejects limit over 100', () => {
      const result = paginationSchema.safeParse({ page: 1, limit: 200 });
      expect(result.success).toBe(false);
    });

    it('rejects non-positive page', () => {
      const result = paginationSchema.safeParse({ page: 0, limit: 20 });
      expect(result.success).toBe(false);
    });
  });
});
