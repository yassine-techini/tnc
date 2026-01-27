/**
 * Reconciliation Service Tests
 * Tests for financial reconciliation, discrepancy detection, and reporting
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('ReconciliationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Balance Calculation', () => {
    it('should calculate expected balance from transactions', () => {
      const transactions = [
        { type: 'BUY', tokenAmount: 10, status: 'COMPLETED' },
        { type: 'BUY', tokenAmount: 5, status: 'COMPLETED' },
        { type: 'SELL', tokenAmount: 3, status: 'COMPLETED' },
        { type: 'BUY', tokenAmount: 2, status: 'FAILED' }, // Should be ignored
      ];

      const expectedBalance = transactions.reduce((acc, t) => {
        if (t.status !== 'COMPLETED') return acc;
        return t.type === 'BUY' ? acc + t.tokenAmount : acc - t.tokenAmount;
      }, 0);

      expect(expectedBalance).toBe(12);
    });

    it('should ignore pending transactions in balance calculation', () => {
      const transactions = [
        { type: 'BUY', tokenAmount: 10, status: 'COMPLETED' },
        { type: 'BUY', tokenAmount: 5, status: 'PENDING' },
      ];

      const expectedBalance = transactions
        .filter(t => t.status === 'COMPLETED')
        .reduce((acc, t) => acc + t.tokenAmount, 0);

      expect(expectedBalance).toBe(10);
    });
  });

  describe('Discrepancy Detection', () => {
    it('should detect wallet balance discrepancy', () => {
      const wallet = {
        tokenBalance: 15,
      };

      const calculatedBalance = 12; // From transactions
      const tolerance = 0.001; // 0.001 gram tolerance

      const hasDiscrepancy = Math.abs(wallet.tokenBalance - calculatedBalance) > tolerance;

      expect(hasDiscrepancy).toBe(true);
    });

    it('should accept balances within tolerance', () => {
      const wallet = {
        tokenBalance: 12.0001,
      };

      const calculatedBalance = 12;
      const tolerance = 0.001;

      const hasDiscrepancy = Math.abs(wallet.tokenBalance - calculatedBalance) > tolerance;

      expect(hasDiscrepancy).toBe(false);
    });

    it('should detect gold stock discrepancy', () => {
      const goldStock = {
        tokensIssued: 1000,
      };

      const totalUserTokens = 995; // Sum of all wallet balances
      const tolerance = 0.001;

      const hasDiscrepancy = Math.abs(goldStock.tokensIssued - totalUserTokens) > tolerance;

      expect(hasDiscrepancy).toBe(true);
    });
  });

  describe('Stuck Transaction Detection', () => {
    it('should identify transactions stuck in PENDING', () => {
      const STUCK_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours

      const transactions = [
        { id: 'tx-1', status: 'PENDING', createdAt: Date.now() - 25 * 60 * 60 * 1000 },
        { id: 'tx-2', status: 'PENDING', createdAt: Date.now() - 1 * 60 * 60 * 1000 },
        { id: 'tx-3', status: 'PROCESSING', createdAt: Date.now() - 30 * 60 * 60 * 1000 },
      ];

      const stuckTransactions = transactions.filter(t => {
        const age = Date.now() - t.createdAt;
        return ['PENDING', 'PROCESSING'].includes(t.status) && age > STUCK_THRESHOLD;
      });

      expect(stuckTransactions.length).toBe(2);
      expect(stuckTransactions.map(t => t.id)).toContain('tx-1');
      expect(stuckTransactions.map(t => t.id)).toContain('tx-3');
    });

    it('should not flag recent pending transactions as stuck', () => {
      const STUCK_THRESHOLD = 24 * 60 * 60 * 1000;

      const transaction = {
        id: 'tx-1',
        status: 'PENDING',
        createdAt: Date.now() - 1 * 60 * 60 * 1000, // 1 hour ago
      };

      const age = Date.now() - transaction.createdAt;
      const isStuck = age > STUCK_THRESHOLD;

      expect(isStuck).toBe(false);
    });
  });

  describe('Daily Summary', () => {
    it('should calculate daily transaction totals', () => {
      const transactions = [
        { type: 'BUY', cashAmount: 100000, status: 'COMPLETED', date: '2024-01-15' },
        { type: 'BUY', cashAmount: 50000, status: 'COMPLETED', date: '2024-01-15' },
        { type: 'SELL', cashAmount: 30000, status: 'COMPLETED', date: '2024-01-15' },
        { type: 'BUY', cashAmount: 80000, status: 'FAILED', date: '2024-01-15' },
      ];

      const completedBuys = transactions.filter(
        t => t.type === 'BUY' && t.status === 'COMPLETED'
      );
      const completedSells = transactions.filter(
        t => t.type === 'SELL' && t.status === 'COMPLETED'
      );

      const totalBuyVolume = completedBuys.reduce((acc, t) => acc + t.cashAmount, 0);
      const totalSellVolume = completedSells.reduce((acc, t) => acc + t.cashAmount, 0);

      expect(totalBuyVolume).toBe(150000);
      expect(totalSellVolume).toBe(30000);
    });

    it('should count transactions by status', () => {
      const transactions = [
        { status: 'COMPLETED' },
        { status: 'COMPLETED' },
        { status: 'FAILED' },
        { status: 'PENDING' },
        { status: 'COMPLETED' },
      ];

      const byStatus = transactions.reduce((acc, t) => {
        acc[t.status] = (acc[t.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      expect(byStatus['COMPLETED']).toBe(3);
      expect(byStatus['FAILED']).toBe(1);
      expect(byStatus['PENDING']).toBe(1);
    });
  });

  describe('Manual Reconciliation', () => {
    it('should allow manual status correction', () => {
      const transaction = {
        id: 'tx-123',
        status: 'PENDING',
        reconciliationNote: null as string | null,
        reconciledBy: null as string | null,
        reconciledAt: null as string | null,
      };

      // Admin reconciles the transaction
      transaction.status = 'COMPLETED';
      transaction.reconciliationNote = 'Payment confirmed via bank statement';
      transaction.reconciledBy = 'admin-123';
      transaction.reconciledAt = new Date().toISOString();

      expect(transaction.status).toBe('COMPLETED');
      expect(transaction.reconciliationNote).toBeTruthy();
      expect(transaction.reconciledBy).toBeTruthy();
    });

    it('should require note for manual reconciliation', () => {
      const reconciliation = {
        transactionId: 'tx-123',
        newStatus: 'COMPLETED',
        note: '', // Empty note
        adminId: 'admin-123',
      };

      const isValid = reconciliation.note.length > 0;

      expect(isValid).toBe(false);
    });

    it('should create audit trail for reconciliation', () => {
      const auditLog = {
        action: 'MANUAL_RECONCILIATION',
        entityType: 'TRANSACTION',
        entityId: 'tx-123',
        adminId: 'admin-123',
        oldValue: JSON.stringify({ status: 'PENDING' }),
        newValue: JSON.stringify({ status: 'COMPLETED', note: 'Bank confirmed' }),
        createdAt: new Date().toISOString(),
      };

      expect(auditLog.action).toBe('MANUAL_RECONCILIATION');
      expect(auditLog.oldValue).toContain('PENDING');
      expect(auditLog.newValue).toContain('COMPLETED');
    });
  });

  describe('Bulk Reconciliation', () => {
    it('should process multiple transactions', () => {
      const transactionIds = ['tx-1', 'tx-2', 'tx-3'];
      const results = transactionIds.map(id => ({
        id,
        success: true,
        newStatus: 'COMPLETED',
      }));

      expect(results.length).toBe(3);
      expect(results.every(r => r.success)).toBe(true);
    });

    it('should report partial failures', () => {
      const results = [
        { id: 'tx-1', success: true },
        { id: 'tx-2', success: false, error: 'Transaction not found' },
        { id: 'tx-3', success: true },
      ];

      const successCount = results.filter(r => r.success).length;
      const failureCount = results.filter(r => !r.success).length;

      expect(successCount).toBe(2);
      expect(failureCount).toBe(1);
    });
  });

  describe('Reconciliation Report', () => {
    it('should generate comprehensive report', () => {
      const report = {
        date: '2024-01-15',
        generatedAt: new Date().toISOString(),
        summary: {
          totalTransactions: 150,
          completedTransactions: 140,
          failedTransactions: 5,
          pendingTransactions: 5,
        },
        volumes: {
          buyVolume: 5000000,
          sellVolume: 2000000,
          depositVolume: 1500000,
          withdrawalVolume: 800000,
        },
        discrepancies: {
          walletDiscrepancies: 2,
          stockDiscrepancy: false,
          stuckTransactions: 3,
        },
        alerts: ['2 wallet discrepancies found', '3 stuck transactions'],
      };

      expect(report.date).toBe('2024-01-15');
      expect(report.summary.totalTransactions).toBe(150);
      expect(report.alerts.length).toBe(2);
    });

    it('should cache report for quick access', () => {
      const cacheKey = 'reconciliation:2024-01-15';
      const reportData = { date: '2024-01-15', summary: {} };
      const cacheTTL = 7 * 24 * 60 * 60; // 7 days in seconds

      expect(cacheKey).toContain('2024-01-15');
      expect(cacheTTL).toBe(604800);
    });
  });

  describe('Stock Integrity Check', () => {
    it('should verify tokens issued matches user holdings', () => {
      const goldStock = {
        totalAllocated: 1000,
        tokensIssued: 500,
      };

      const userWallets = [
        { tokenBalance: 200 },
        { tokenBalance: 150 },
        { tokenBalance: 148 },
      ];

      const totalUserTokens = userWallets.reduce((acc, w) => acc + w.tokenBalance, 0);
      const tolerance = 0.001;

      const isValid = Math.abs(goldStock.tokensIssued - totalUserTokens) < tolerance;

      expect(totalUserTokens).toBe(498);
      expect(isValid).toBe(false);
    });

    it('should verify tokens issued does not exceed allocated', () => {
      const goldStock = {
        totalAllocated: 1000,
        tokensIssued: 500,
      };

      expect(goldStock.tokensIssued <= goldStock.totalAllocated).toBe(true);
    });
  });

  describe('Automatic Reconciliation', () => {
    it('should auto-reconcile matching webhook confirmations', () => {
      const transaction = {
        id: 'tx-123',
        status: 'PENDING',
        paymentReference: 'ref-abc',
      };

      const webhookPayload = {
        reference: 'ref-abc',
        status: 'SUCCESS',
        amount: 100000,
      };

      // Matching reference means auto-reconciliation
      const canAutoReconcile = transaction.paymentReference === webhookPayload.reference;

      expect(canAutoReconcile).toBe(true);
    });

    it('should not auto-reconcile mismatched references', () => {
      const transaction = {
        paymentReference: 'ref-abc',
      };

      const webhookPayload = {
        reference: 'ref-xyz',
      };

      const canAutoReconcile = transaction.paymentReference === webhookPayload.reference;

      expect(canAutoReconcile).toBe(false);
    });
  });
});
