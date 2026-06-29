/**
 * KYC Service Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { KycService, DEFAULT_KYC_LIMITS, type KycConfig } from '../../src/services/kyc.service';
import { createMockD1Database, createMockR2Bucket, mockFetch, testData } from '../setup';

describe('KycService', () => {
  let kycService: KycService;
  let mockDb: D1Database;
  let mockStorage: R2Bucket;
  let restoreFetch: () => void;

  const config: KycConfig = {
    apiKey: 'test-api-key',
    partnerId: 'test-partner-id',
    environment: 'sandbox',
    callbackUrl: 'https://api.test.com/webhooks/kyc',
  };

  beforeEach(() => {
    mockDb = createMockD1Database();
    mockStorage = createMockR2Bucket();
    kycService = new KycService(mockDb, mockStorage, config);
  });

  afterEach(() => {
    if (restoreFetch) restoreFetch();
  });

  // ─── Default KYC Limits ──────────────────────────────────
  describe('DEFAULT_KYC_LIMITS', () => {
    it('defines BASIC level with zero limits', () => {
      expect(DEFAULT_KYC_LIMITS.BASIC).toEqual({
        dailyBuy: 0,
        monthlyBuy: 0,
        canSell: false,
        dailyWithdraw: 0,
      });
    });

    it('defines STANDARD level with moderate limits', () => {
      expect(DEFAULT_KYC_LIMITS.STANDARD).toEqual({
        dailyBuy: 100,
        monthlyBuy: 500,
        canSell: true,
        dailyWithdraw: 500_000,
      });
    });

    it('defines VERIFIED level with high limits', () => {
      expect(DEFAULT_KYC_LIMITS.VERIFIED).toEqual({
        dailyBuy: 1000,
        monthlyBuy: 5000,
        canSell: true,
        dailyWithdraw: 5_000_000,
      });
    });
  });

  // ─── Get KYC Limits ──────────────────────────────────────
  describe('getKycLimits', () => {
    it('returns default limits when no config service', async () => {
      const limits = await KycService.getKycLimits(null);

      expect(limits.BASIC).toEqual(DEFAULT_KYC_LIMITS.BASIC);
      expect(limits.STANDARD).toEqual(DEFAULT_KYC_LIMITS.STANDARD);
      expect(limits.VERIFIED).toEqual(DEFAULT_KYC_LIMITS.VERIFIED);
    });

    it('returns default limits from instance method', async () => {
      const limits = await kycService.getKycLimitsForUser();

      expect(limits.BASIC).toEqual(DEFAULT_KYC_LIMITS.BASIC);
    });
  });

  // ─── Webhook Signature Verification ──────────────────────
  describe('verifyWebhookSignature', () => {
    it('returns false for missing signature', async () => {
      const result = await kycService.verifyWebhookSignature('{}', '');
      expect(result).toBe(false);
    });

    it('verifies valid HMAC signature', async () => {
      const payload = '{"job_id": "test-123"}';
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(config.apiKey),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
      const signature = Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const result = await kycService.verifyWebhookSignature(payload, signature);

      expect(result).toBe(true);
    });

    it('rejects invalid signature', async () => {
      const result = await kycService.verifyWebhookSignature('{}', 'invalid-signature');
      expect(result).toBe(false);
    });
  });

  // ─── Submit Verification ─────────────────────────────────
  describe('submitVerification', () => {
    it('returns error when provider disabled', async () => {
      mockDb = createMockD1Database({ first: { enabled: 0 } });
      kycService = new KycService(mockDb, mockStorage, config);

      const result = await kycService.submitVerification({
        userId: 'user-123',
        kycDocumentId: 'doc-123',
        documentType: 'CNIB',
        country: 'BF',
        frontImageBase64: 'base64front',
        selfieImageBase64: 'base64selfie',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Smile Identity is currently disabled');
    });

    it('submits verification request successfully', async () => {
      // Mock provider enabled and API response
      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn()
          .mockResolvedValueOnce({ enabled: 1 }) // isProviderEnabled
          .mockResolvedValueOnce(null), // Other queries
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      kycService = new KycService(mockDb, mockStorage, config);

      restoreFetch = mockFetch({
        'testapi.smileidentity.com': {
          job_id: 'smile-job-123',
          result_code: '0810',
          result_text: 'Submitted',
        },
      });

      const result = await kycService.submitVerification({
        userId: 'user-123',
        kycDocumentId: 'doc-123',
        documentType: 'CNIB',
        documentNumber: 'B12345678',
        firstName: 'John',
        lastName: 'Doe',
        country: 'BF',
        frontImageBase64: 'base64front',
        backImageBase64: 'base64back',
        selfieImageBase64: 'base64selfie',
      });

      expect(result.success).toBe(true);
      expect(result.jobId).toBe('smile-job-123');
    });

    it('handles API errors', async () => {
      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValueOnce({ enabled: 1 }),
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      kycService = new KycService(mockDb, mockStorage, config);

      restoreFetch = mockFetch({}); // Will return 404

      const result = await kycService.submitVerification({
        userId: 'user-123',
        kycDocumentId: 'doc-123',
        documentType: 'CNIB',
        country: 'BF',
        frontImageBase64: 'base64front',
        selfieImageBase64: 'base64selfie',
      });

      expect(result.success).toBe(false);
    });
  });

  // ─── Process Callback ────────────────────────────────────
  describe('processCallback', () => {
    it('returns error when document not found', async () => {
      const result = await kycService.processCallback({
        job_id: 'nonexistent',
        job_success: true,
        result_code: '0810',
        result_text: 'Verified',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('KYC document not found');
    });

    it('processes successful verification', async () => {
      const kycDoc = testData.kycDocument('user-123');
      const user = testData.user({ id: 'user-123', kyc_level: 'BASIC' });

      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn()
          .mockResolvedValueOnce(kycDoc) // Find KYC doc
          .mockResolvedValueOnce(user), // Find user
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      kycService = new KycService(mockDb, mockStorage, config);

      const result = await kycService.processCallback({
        job_id: 'job-123',
        job_success: true,
        result_code: '0810',
        result_text: 'Verified',
        confidence: 95,
        actions: {
          Document_Check: 'Passed',
          Selfie_Check: 'Passed',
          Liveness_Check: 'Passed',
        },
      });

      expect(result.success).toBe(true);
      expect(result.userId).toBe('user-123');
      expect(result.newKycLevel).toBe('STANDARD');
    });

    it('handles failed verification', async () => {
      const kycDoc = testData.kycDocument('user-123');

      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValueOnce(kycDoc),
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      kycService = new KycService(mockDb, mockStorage, config);

      const result = await kycService.processCallback({
        job_id: 'job-123',
        job_success: false,
        result_code: '1000',
        result_text: 'Unable to match',
      });

      expect(result.success).toBe(true);
      expect(result.newKycLevel).toBeUndefined();
    });

    it('upgrades STANDARD to VERIFIED for CNIB/PASSPORT', async () => {
      const kycDoc = testData.kycDocument('user-123', { document_type: 'CNIB' });
      const user = testData.user({ id: 'user-123', kyc_level: 'STANDARD' });

      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn()
          .mockResolvedValueOnce(kycDoc)
          .mockResolvedValueOnce(user),
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      kycService = new KycService(mockDb, mockStorage, config);

      const result = await kycService.processCallback({
        job_id: 'job-123',
        job_success: true,
        result_code: '0810',
        result_text: 'Verified',
      });

      expect(result.newKycLevel).toBe('VERIFIED');
    });
  });

  // ─── Check Status ────────────────────────────────────────
  describe('checkStatus', () => {
    it('returns verification status from API', async () => {
      restoreFetch = mockFetch({
        'testapi.smileidentity.com': {
          job_success: true,
          job_id: 'job-123',
          result_code: '0810',
          result_text: 'Verified',
          confidence: 98,
          actions: {
            Document_Check: 'Passed',
            Selfie_Check: 'Passed',
            Liveness_Check: 'Passed',
            Human_Review_Required: 'No',
          },
        },
      });

      const result = await kycService.checkStatus('job-123');

      expect(result.success).toBe(true);
      expect(result.jobId).toBe('job-123');
      expect(result.confidence).toBe(98);
      expect(result.actions?.documentVerified).toBe(true);
      expect(result.actions?.selfieVerified).toBe(true);
      expect(result.actions?.livenessCheckPassed).toBe(true);
    });

    it('handles API errors', async () => {
      restoreFetch = mockFetch({});

      const result = await kycService.checkStatus('job-123');

      expect(result.success).toBe(false);
    });
  });

  // ─── Get User KYC Status ─────────────────────────────────
  describe('getUserKycStatus', () => {
    it('throws error when user not found', async () => {
      await expect(kycService.getUserKycStatus('nonexistent')).rejects.toThrow(
        'User not found'
      );
    });

    it('returns complete KYC status', async () => {
      const user = testData.user({ kyc_level: 'STANDARD', kyc_status: 'APPROVED' });
      const documents = [testData.kycDocument('user-123')];

      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(user),
        all: vi.fn().mockResolvedValue({ results: documents }),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      kycService = new KycService(mockDb, mockStorage, config);

      const result = await kycService.getUserKycStatus('user-123');

      expect(result.level).toBe('STANDARD');
      expect(result.status).toBe('APPROVED');
      expect(result.documents).toHaveLength(1);
      expect(result.limits).toEqual(DEFAULT_KYC_LIMITS.STANDARD);
    });
  });

  // ─── Is KYC Valid for Trading ────────────────────────────
  describe('isKycValidForTrading', () => {
    it('returns invalid for missing user', async () => {
      const result = await kycService.isKycValidForTrading('nonexistent');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('User not found');
    });

    it('returns invalid for BASIC KYC level', async () => {
      const user = testData.user({ kyc_level: 'BASIC', kyc_status: 'PENDING' });
      mockDb = createMockD1Database({ first: user });
      kycService = new KycService(mockDb, mockStorage, config);

      const result = await kycService.isKycValidForTrading('user-123');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('KYC_LEVEL_BASIC');
    });

    it('returns invalid for non-APPROVED status', async () => {
      const user = testData.user({ kyc_level: 'STANDARD', kyc_status: 'PENDING' });
      mockDb = createMockD1Database({ first: user });
      kycService = new KycService(mockDb, mockStorage, config);

      const result = await kycService.isKycValidForTrading('user-123');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('KYC_STATUS_PENDING');
    });

    it('returns invalid for expired document', async () => {
      const user = testData.user({ kyc_level: 'VERIFIED', kyc_status: 'APPROVED' });
      const expiredDoc = {
        id: 'doc-123',
        document_type: 'CNIB',
        document_expiry_date: '2020-01-01',
        verification_status: 'VERIFIED',
      };

      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn()
          .mockResolvedValueOnce(user)
          .mockResolvedValueOnce(expiredDoc),
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      kycService = new KycService(mockDb, mockStorage, config);

      const result = await kycService.isKycValidForTrading('user-123');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('KYC_DOCUMENT_EXPIRED');
    });

    it('returns valid with expiring soon warning', async () => {
      const user = testData.user({ kyc_level: 'VERIFIED', kyc_status: 'APPROVED' });
      const expiringDoc = {
        id: 'doc-123',
        document_type: 'CNIB',
        document_expiry_date: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(), // 15 days
        verification_status: 'VERIFIED',
      };

      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn()
          .mockResolvedValueOnce(user)
          .mockResolvedValueOnce(expiringDoc),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      kycService = new KycService(mockDb, mockStorage, config);

      const result = await kycService.isKycValidForTrading('user-123');

      expect(result.valid).toBe(true);
      expect(result.reason).toBe('KYC_EXPIRING_SOON');
    });

    it('returns valid for fully verified user', async () => {
      const user = testData.user({ kyc_level: 'VERIFIED', kyc_status: 'APPROVED' });
      const validDoc = {
        id: 'doc-123',
        document_type: 'CNIB',
        document_expiry_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
        verification_status: 'VERIFIED',
      };

      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn()
          .mockResolvedValueOnce(user)
          .mockResolvedValueOnce(validDoc),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      kycService = new KycService(mockDb, mockStorage, config);

      const result = await kycService.isKycValidForTrading('user-123');

      expect(result.valid).toBe(true);
      expect(result.kycLevel).toBe('VERIFIED');
    });
  });

  // ─── Get Image Base64 ────────────────────────────────────
  describe('getImageBase64', () => {
    it('returns null when image not found', async () => {
      const result = await kycService.getImageBase64('nonexistent/image.jpg');
      expect(result).toBeNull();
    });

    it('returns base64 encoded image', async () => {
      // Pre-populate R2 with test image
      const imageData = new TextEncoder().encode('test image data');
      await mockStorage.put('documents/test.jpg', imageData);

      const result = await kycService.getImageBase64('bucket/documents/test.jpg');

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });
});
