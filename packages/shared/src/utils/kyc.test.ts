/**
 * KYC Utilities Tests
 */

import { describe, it, expect } from 'vitest';
import {
  canTrade,
  canBuy,
  canSell,
  canWithdraw,
  getKycLimits,
  checkDailyBuyLimit,
  checkMonthlyBuyLimit,
  checkDailyWithdrawLimit,
  getKycLevelName,
  getKycStatusName,
  getKycStatusColor,
  getDocumentTypeName,
  getDocumentTypeShortName,
  requiresBackImage,
  getRequiredKycLevel,
  needsKycUpgrade,
  getKycCompletionProgress,
} from './kyc.js';
import { KYC_LIMITS } from '../constants/index.js';

describe('KYC Utilities', () => {
  // ─── Trade Permissions ───────────────────────────────────
  describe('canTrade', () => {
    it('returns false for BASIC level', () => {
      expect(canTrade('BASIC')).toBe(false);
    });

    it('returns true for STANDARD level', () => {
      expect(canTrade('STANDARD')).toBe(true);
    });

    it('returns true for VERIFIED level', () => {
      expect(canTrade('VERIFIED')).toBe(true);
    });
  });

  describe('canBuy', () => {
    it('returns false for BASIC level', () => {
      expect(canBuy('BASIC')).toBe(false);
    });

    it('returns true for STANDARD level', () => {
      expect(canBuy('STANDARD')).toBe(true);
    });

    it('returns true for VERIFIED level', () => {
      expect(canBuy('VERIFIED')).toBe(true);
    });
  });

  describe('canSell', () => {
    it('returns false for BASIC level', () => {
      expect(canSell('BASIC')).toBe(false);
    });

    it('returns true for STANDARD and VERIFIED', () => {
      expect(canSell('STANDARD')).toBe(true);
      expect(canSell('VERIFIED')).toBe(true);
    });
  });

  describe('canWithdraw', () => {
    it('returns false for BASIC level', () => {
      expect(canWithdraw('BASIC')).toBe(false);
    });

    it('returns true for STANDARD and VERIFIED', () => {
      expect(canWithdraw('STANDARD')).toBe(true);
      expect(canWithdraw('VERIFIED')).toBe(true);
    });
  });

  // ─── Get KYC Limits ──────────────────────────────────────
  describe('getKycLimits', () => {
    it('returns BASIC limits', () => {
      const limits = getKycLimits('BASIC');

      expect(limits).toEqual(KYC_LIMITS.BASIC);
      expect(limits.dailyBuyGrams).toBe(0);
    });

    it('returns STANDARD limits', () => {
      const limits = getKycLimits('STANDARD');

      expect(limits.dailyBuyGrams).toBe(100);
      expect(limits.monthlyBuyGrams).toBe(500);
      expect(limits.canSell).toBe(true);
      expect(limits.dailyWithdrawXof).toBe(500_000);
    });

    it('returns VERIFIED limits', () => {
      const limits = getKycLimits('VERIFIED');

      expect(limits.dailyBuyGrams).toBe(1_000);
      expect(limits.monthlyBuyGrams).toBe(5_000);
      expect(limits.dailyWithdrawXof).toBe(5_000_000);
    });
  });

  // ─── Limit Checks ────────────────────────────────────────
  describe('checkDailyBuyLimit', () => {
    it('allows purchase within limit', () => {
      const result = checkDailyBuyLimit('STANDARD', 50, 30);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(50);
      expect(result.limit).toBe(100);
    });

    it('rejects purchase exceeding limit', () => {
      const result = checkDailyBuyLimit('STANDARD', 80, 30);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(20);
    });

    it('returns zero limit for BASIC', () => {
      const result = checkDailyBuyLimit('BASIC', 0, 1);

      expect(result.allowed).toBe(false);
      expect(result.limit).toBe(0);
    });
  });

  describe('checkMonthlyBuyLimit', () => {
    it('allows purchase within monthly limit', () => {
      const result = checkMonthlyBuyLimit('STANDARD', 400, 50);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(100);
    });

    it('rejects purchase exceeding monthly limit', () => {
      const result = checkMonthlyBuyLimit('STANDARD', 480, 30);

      expect(result.allowed).toBe(false);
    });
  });

  describe('checkDailyWithdrawLimit', () => {
    it('allows withdrawal within limit', () => {
      const result = checkDailyWithdrawLimit('STANDARD', 200_000, 100_000);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(300_000);
    });

    it('rejects withdrawal exceeding limit', () => {
      const result = checkDailyWithdrawLimit('STANDARD', 400_000, 200_000);

      expect(result.allowed).toBe(false);
    });
  });

  // ─── Display Names ───────────────────────────────────────
  describe('getKycLevelName', () => {
    it('returns French names', () => {
      expect(getKycLevelName('BASIC')).toBe('Basique');
      expect(getKycLevelName('STANDARD')).toBe('Standard');
      expect(getKycLevelName('VERIFIED')).toBe('Verifie');
    });
  });

  describe('getKycStatusName', () => {
    it('returns French status names', () => {
      expect(getKycStatusName('PENDING')).toBe('En attente');
      expect(getKycStatusName('SUBMITTED')).toBe('Soumis');
      expect(getKycStatusName('APPROVED')).toBe('Approuve');
      expect(getKycStatusName('REJECTED')).toBe('Rejete');
      expect(getKycStatusName('EXPIRED')).toBe('Expire');
    });
  });

  describe('getKycStatusColor', () => {
    it('returns appropriate color classes', () => {
      expect(getKycStatusColor('APPROVED')).toContain('green');
      expect(getKycStatusColor('REJECTED')).toContain('red');
      expect(getKycStatusColor('PENDING')).toContain('gray');
      expect(getKycStatusColor('SUBMITTED')).toContain('blue');
      expect(getKycStatusColor('EXPIRED')).toContain('orange');
    });
  });

  // ─── Document Types ──────────────────────────────────────
  describe('getDocumentTypeName', () => {
    it('returns full document names', () => {
      expect(getDocumentTypeName('CNIB')).toContain('Nationale');
      expect(getDocumentTypeName('PASSPORT')).toBe('Passeport');
      expect(getDocumentTypeName('PERMIT')).toContain('Permis');
      expect(getDocumentTypeName('CEDEAO')).toContain('CEDEAO');
    });
  });

  describe('getDocumentTypeShortName', () => {
    it('returns short document names', () => {
      expect(getDocumentTypeShortName('CNIB')).toBe('CNIB');
      expect(getDocumentTypeShortName('PASSPORT')).toBe('Passeport');
      expect(getDocumentTypeShortName('PERMIT')).toBe('Permis');
      expect(getDocumentTypeShortName('CEDEAO')).toBe('CEDEAO');
    });
  });

  describe('requiresBackImage', () => {
    it('returns true for CNIB', () => {
      expect(requiresBackImage('CNIB')).toBe(true);
    });

    it('returns true for PERMIT', () => {
      expect(requiresBackImage('PERMIT')).toBe(true);
    });

    it('returns false for PASSPORT', () => {
      expect(requiresBackImage('PASSPORT')).toBe(false);
    });
  });

  // ─── Required KYC Level ──────────────────────────────────
  describe('getRequiredKycLevel', () => {
    it('returns STANDARD for BUY', () => {
      expect(getRequiredKycLevel('BUY')).toBe('STANDARD');
    });

    it('returns STANDARD for SELL', () => {
      expect(getRequiredKycLevel('SELL')).toBe('STANDARD');
    });

    it('returns STANDARD for WITHDRAW', () => {
      expect(getRequiredKycLevel('WITHDRAW')).toBe('STANDARD');
    });
  });

  describe('needsKycUpgrade', () => {
    it('returns false when level is sufficient', () => {
      const result = needsKycUpgrade('STANDARD', 'BUY');

      expect(result.needsUpgrade).toBe(false);
    });

    it('returns false when level exceeds requirement', () => {
      const result = needsKycUpgrade('VERIFIED', 'SELL');

      expect(result.needsUpgrade).toBe(false);
    });

    it('returns true when BASIC tries to trade', () => {
      const result = needsKycUpgrade('BASIC', 'BUY');

      expect(result.needsUpgrade).toBe(true);
      expect(result.requiredLevel).toBe('STANDARD');
      expect(result.message).toContain('Standard');
    });
  });

  // ─── KYC Completion Progress ─────────────────────────────
  describe('getKycCompletionProgress', () => {
    it('returns 0% for unverified user', () => {
      const result = getKycCompletionProgress(false, false, 'PENDING');

      expect(result.percentage).toBe(0);
      expect(result.steps.filter(s => s.completed)).toHaveLength(0);
    });

    it('returns 25% for email only verified', () => {
      const result = getKycCompletionProgress(true, false, 'PENDING');

      expect(result.percentage).toBe(25);
    });

    it('returns 50% for email and phone verified', () => {
      const result = getKycCompletionProgress(true, true, 'PENDING');

      expect(result.percentage).toBe(50);
    });

    it('returns 75% for submitted documents', () => {
      const result = getKycCompletionProgress(true, true, 'SUBMITTED');

      expect(result.percentage).toBe(75);
    });

    it('returns 100% for fully approved', () => {
      const result = getKycCompletionProgress(true, true, 'APPROVED');

      expect(result.percentage).toBe(100);
      expect(result.steps.filter(s => s.completed)).toHaveLength(4);
    });
  });
});
