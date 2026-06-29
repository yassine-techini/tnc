/**
 * Payment Service Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PaymentService, type PaymentConfig, type WebhookPayload } from '../../src/services/payment.service';
import { createMockD1Database, createMockKVNamespace, mockFetch, testData } from '../setup';

describe('PaymentService', () => {
  let paymentService: PaymentService;
  let mockDb: D1Database;
  let mockKv: KVNamespace;
  let restoreFetch: () => void;

  const config: PaymentConfig = {
    orangeMoneyApiKey: 'test-om-key',
    orangeMoneyMerchantId: 'test-om-merchant',
    orangeMoneyClientId: 'test-om-client',
    orangeMoneyClientSecret: 'test-om-secret',
    moovApiKey: 'test-moov-key',
    moovMerchantId: 'test-moov-merchant',
    cinetpayApiKey: 'test-cinetpay-key',
    cinetpaySiteId: 'test-cinetpay-site',
    webhookSecret: 'test-webhook-secret',
    stripeSecretKey: 'sk_test_1234567890',
    stripeWebhookSecret: 'whsec_test_1234567890',
  };

  beforeEach(() => {
    mockDb = createMockD1Database();
    mockKv = createMockKVNamespace();
    paymentService = new PaymentService(mockDb, mockKv, config);
  });

  afterEach(() => {
    if (restoreFetch) restoreFetch();
  });

  // ─── Orange Money ────────────────────────────────────────
  describe('initOrangeMoneyPayment', () => {
    it('returns error when not configured', async () => {
      paymentService = new PaymentService(mockDb, mockKv, {});

      const result = await paymentService.initOrangeMoneyPayment({
        amount: 50000,
        currency: 'XOF',
        reference: 'ref-123',
        description: 'Test payment',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Orange Money not configured');
    });

    it('initiates payment successfully', async () => {
      restoreFetch = mockFetch({
        'orange-money-webpay': {
          pay_token: 'token-123',
          payment_url: 'https://pay.orange.com/123',
        },
      });

      const result = await paymentService.initOrangeMoneyPayment({
        amount: 50000,
        currency: 'XOF',
        reference: 'ref-123',
        description: 'Test payment',
      });

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('token-123');
      expect(result.paymentUrl).toBe('https://pay.orange.com/123');
    });

    it('stores payment intent in KV', async () => {
      restoreFetch = mockFetch({
        'orange-money-webpay': {
          pay_token: 'token-123',
          payment_url: 'https://pay.orange.com/123',
        },
      });

      await paymentService.initOrangeMoneyPayment({
        amount: 50000,
        currency: 'XOF',
        reference: 'ref-123',
        description: 'Test payment',
      });

      expect(mockKv.put).toHaveBeenCalledWith(
        'payment:om:ref-123',
        expect.any(String),
        expect.any(Object)
      );
    });

    it('handles API errors', async () => {
      restoreFetch = mockFetch({});

      const result = await paymentService.initOrangeMoneyPayment({
        amount: 50000,
        currency: 'XOF',
        reference: 'ref-123',
        description: 'Test payment',
      });

      expect(result.success).toBe(false);
    });
  });

  // ─── Moov Money ──────────────────────────────────────────
  describe('initMoovMoneyPayment', () => {
    it('returns error when not configured', async () => {
      paymentService = new PaymentService(mockDb, mockKv, {});

      const result = await paymentService.initMoovMoneyPayment({
        amount: 50000,
        currency: 'XOF',
        reference: 'ref-123',
        description: 'Test payment',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Moov Money not configured');
    });

    it('initiates payment successfully', async () => {
      restoreFetch = mockFetch({
        'moov-africa': {
          transaction_id: 'moov-tx-123',
          payment_url: 'https://pay.moov.com/123',
        },
      });

      const result = await paymentService.initMoovMoneyPayment({
        amount: 50000,
        currency: 'XOF',
        reference: 'ref-123',
        description: 'Test payment',
        customerPhone: '+22670000000',
      });

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('moov-tx-123');
    });
  });

  // ─── CinetPay ────────────────────────────────────────────
  describe('initCinetPayPayment', () => {
    it('returns error when not configured', async () => {
      paymentService = new PaymentService(mockDb, mockKv, {});

      const result = await paymentService.initCinetPayPayment({
        amount: 50000,
        currency: 'XOF',
        reference: 'ref-123',
        description: 'Test payment',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('CinetPay not configured');
    });

    it('initiates payment successfully', async () => {
      restoreFetch = mockFetch({
        'cinetpay': {
          code: '201',
          message: 'Success',
          data: {
            payment_token: 'cinetpay-token-123',
            payment_url: 'https://pay.cinetpay.com/123',
          },
        },
      });

      const result = await paymentService.initCinetPayPayment({
        amount: 50000,
        currency: 'XOF',
        reference: 'ref-123',
        description: 'Test payment',
        customerEmail: 'test@example.com',
      });

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('cinetpay-token-123');
    });

    it('handles CinetPay error response', async () => {
      restoreFetch = mockFetch({
        'cinetpay': {
          code: '400',
          message: 'Invalid request',
        },
      });

      const result = await paymentService.initCinetPayPayment({
        amount: 50000,
        currency: 'XOF',
        reference: 'ref-123',
        description: 'Test payment',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid request');
    });
  });

  // ─── Stripe ──────────────────────────────────────────────
  describe('initStripePayment', () => {
    it('returns error when not configured', async () => {
      paymentService = new PaymentService(mockDb, mockKv, {});

      const result = await paymentService.initStripePayment({
        amount: 50000,
        currency: 'XOF',
        reference: 'ref-123',
        description: 'Test payment',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Stripe not configured');
    });

    it('initiates Stripe checkout session', async () => {
      restoreFetch = mockFetch({
        'api.stripe.com': {
          id: 'cs_test_123',
          url: 'https://checkout.stripe.com/pay/cs_test_123',
        },
      });

      const result = await paymentService.initStripePayment({
        amount: 50000,
        currency: 'XOF',
        reference: 'ref-123',
        description: 'Test deposit',
        customerEmail: 'test@example.com',
      });

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('cs_test_123');
      expect(result.paymentUrl).toContain('checkout.stripe.com');
    });
  });

  // ─── Initiate Payment (Router) ───────────────────────────
  describe('initiatePayment', () => {
    beforeEach(() => {
      restoreFetch = mockFetch({
        'orange-money-webpay': { pay_token: 'om-token', payment_url: 'https://pay.om/123' },
        'moov-africa': { transaction_id: 'moov-token', payment_url: 'https://pay.moov/123' },
        'cinetpay': { code: '201', data: { payment_token: 'cp-token', payment_url: 'https://pay.cp/123' } },
      });
    });

    it('routes to Orange Money', async () => {
      const result = await paymentService.initiatePayment('orange_money', {
        amount: 50000,
        currency: 'XOF',
        reference: 'ref-123',
        description: 'Test',
      });

      expect(result.provider).toBe('orange_money');
    });

    it('routes to Moov Money', async () => {
      const result = await paymentService.initiatePayment('moov_money', {
        amount: 50000,
        currency: 'XOF',
        reference: 'ref-123',
        description: 'Test',
      });

      expect(result.provider).toBe('moov_money');
    });

    it('routes to CinetPay for cards', async () => {
      const result = await paymentService.initiatePayment('card', {
        amount: 50000,
        currency: 'XOF',
        reference: 'ref-123',
        description: 'Test',
      });

      expect(result.provider).toBe('cinetpay');
    });

    it('handles bank transfers', async () => {
      const result = await paymentService.initiatePayment('bank', {
        amount: 50000,
        currency: 'XOF',
        reference: 'ref-123',
        description: 'Test',
      });

      expect(result.success).toBe(true);
      expect(result.provider).toBe('bank');
      expect(result.status).toBe('PENDING');
    });
  });

  // ─── Webhook Signature Verification ──────────────────────
  describe('verifyWebhookSignature', () => {
    it('rejects when webhook secret not configured', async () => {
      paymentService = new PaymentService(mockDb, mockKv, { ...config, webhookSecret: undefined });

      const result = await paymentService.verifyWebhookSignature(
        'orange_money',
        '{"test": "payload"}',
        'invalid-signature'
      );

      expect(result).toBe(false);
    });

    it('verifies HMAC signature for Orange Money', async () => {
      // Generate valid HMAC signature
      const payload = '{"test": "payload"}';
      const secret = 'test-webhook-secret';
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
      const signature = Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const result = await paymentService.verifyWebhookSignature(
        'orange_money',
        payload,
        signature
      );

      expect(result).toBe(true);
    });

    it('rejects invalid signature', async () => {
      const result = await paymentService.verifyWebhookSignature(
        'orange_money',
        '{"test": "payload"}',
        'invalid-signature'
      );

      expect(result).toBe(false);
    });
  });

  // ─── Process Webhook ─────────────────────────────────────
  describe('processWebhook', () => {
    const webhook: WebhookPayload = {
      provider: 'orange_money',
      transactionId: 'om-tx-123',
      status: 'SUCCESS',
      amount: 50000,
      currency: 'XOF',
      reference: 'tx-123',
      timestamp: new Date().toISOString(),
    };

    it('returns error when transaction not found', async () => {
      const result = await paymentService.processWebhook(webhook);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Transaction not found');
    });

    it('processes successful payment', async () => {
      const transaction = testData.transaction('user-123', 'wallet-123', {
        id: 'tx-123',
        type: 'DEPOSIT',
        status: 'PENDING',
        cash_amount: 50000,
      });

      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(transaction),
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      mockKv = createMockKVNamespace({
        'payment:orange_money:tx-123': { amount: 50000 },
      });
      paymentService = new PaymentService(mockDb, mockKv, config);

      const result = await paymentService.processWebhook(webhook);

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('tx-123');
    });

    it('updates wallet balance on successful deposit', async () => {
      const transaction = testData.transaction('user-123', 'wallet-123', {
        id: 'tx-123',
        type: 'DEPOSIT',
        status: 'PENDING',
        cash_amount: 50000,
      });

      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(transaction),
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      mockKv = createMockKVNamespace({
        'payment:orange_money:tx-123': { amount: 50000 },
      });
      paymentService = new PaymentService(mockDb, mockKv, config);

      await paymentService.processWebhook(webhook);

      // Should update wallet cash_balance
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE wallets')
      );
    });

    it('handles idempotent webhook (already processed)', async () => {
      const transaction = testData.transaction('user-123', 'wallet-123', {
        id: 'tx-123',
        status: 'COMPLETED', // Already completed
      });

      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(transaction),
        run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      paymentService = new PaymentService(mockDb, mockKv, config);

      const result = await paymentService.processWebhook(webhook);

      expect(result.success).toBe(true);
      expect(result.alreadyProcessed).toBe(true);
    });

    it('handles failed payment', async () => {
      const transaction = testData.transaction('user-123', 'wallet-123', {
        id: 'tx-123',
        status: 'PENDING',
      });

      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(transaction),
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      paymentService = new PaymentService(mockDb, mockKv, config);

      const failedWebhook = { ...webhook, status: 'FAILED' as const };
      const result = await paymentService.processWebhook(failedWebhook);

      expect(result.success).toBe(true);
    });

    it('validates amount matches', async () => {
      const transaction = testData.transaction('user-123', 'wallet-123', {
        id: 'tx-123',
        status: 'PENDING',
        cash_amount: 50000,
      });

      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(transaction),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      mockKv = createMockKVNamespace({
        'payment:orange_money:tx-123': { amount: 100000 }, // Different amount
      });
      paymentService = new PaymentService(mockDb, mockKv, config);

      const result = await paymentService.processWebhook(webhook);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Amount mismatch');
    });
  });

  // ─── Check Payment Status ────────────────────────────────
  describe('checkPaymentStatus', () => {
    it('checks Orange Money status', async () => {
      restoreFetch = mockFetch({
        'transactionstatus': { status: 'SUCCESS' },
      });

      const result = await paymentService.checkPaymentStatus('orange_money', 'tx-123');

      expect(result.status).toBe('SUCCESS');
    });

    it('checks Moov Money status', async () => {
      restoreFetch = mockFetch({
        'status': { status: 'COMPLETED' },
      });

      const result = await paymentService.checkPaymentStatus('moov_money', 'tx-123');

      expect(result.status).toBe('COMPLETED');
    });

    it('checks CinetPay status', async () => {
      restoreFetch = mockFetch({
        'cinetpay.com': { data: { status: 'ACCEPTED' } },
      });

      const result = await paymentService.checkPaymentStatus('cinetpay', 'tx-123');

      expect(result.status).toBe('ACCEPTED');
    });

    it('checks Stripe session status', async () => {
      restoreFetch = mockFetch({
        'api.stripe.com': { payment_status: 'paid', status: 'complete' },
      });

      const result = await paymentService.checkPaymentStatus('stripe', 'cs_test_123');

      expect(result.status).toBe('SUCCESS');
    });

    it('returns UNKNOWN for unsupported provider', async () => {
      const result = await paymentService.checkPaymentStatus('unknown', 'tx-123');

      expect(result.status).toBe('UNKNOWN');
    });

    it('returns ERROR when not configured', async () => {
      paymentService = new PaymentService(mockDb, mockKv, {});

      const result = await paymentService.checkPaymentStatus('orange_money', 'tx-123');

      expect(result.status).toBe('ERROR');
    });
  });

  // ─── Withdrawal Payout ───────────────────────────────────
  describe('initiateWithdrawalPayout', () => {
    it('initiates Orange Money payout', async () => {
      restoreFetch = mockFetch({
        'cashin': { transaction_id: 'payout-123' },
      });

      const result = await paymentService.initiateWithdrawalPayout(
        'orange_money',
        50000,
        '+22670000000',
        'withdrawal-123'
      );

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('payout-123');
    });

    it('initiates Moov Money payout', async () => {
      restoreFetch = mockFetch({
        'payout': { transaction_id: 'moov-payout-123' },
      });

      const result = await paymentService.initiateWithdrawalPayout(
        'moov_money',
        50000,
        '+22660000000',
        'withdrawal-123'
      );

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('moov-payout-123');
    });

    it('handles bank transfers as manual', async () => {
      const result = await paymentService.initiateWithdrawalPayout(
        'bank',
        50000,
        'BANK123456',
        'withdrawal-123'
      );

      expect(result.success).toBe(true);
      expect(result.provider).toBe('bank');
      expect(result.status).toBe('PENDING');
    });

    it('returns error when not configured', async () => {
      paymentService = new PaymentService(mockDb, mockKv, {});

      const result = await paymentService.initiateWithdrawalPayout(
        'orange_money',
        50000,
        '+22670000000',
        'withdrawal-123'
      );

      expect(result.success).toBe(false);
    });
  });
});
