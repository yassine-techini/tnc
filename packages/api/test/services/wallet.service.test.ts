/**
 * Wallet Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WalletService } from '../../src/services/wallet.service';
import { createMockD1Database, testData } from '../setup';

describe('WalletService', () => {
  let walletService: WalletService;
  let mockDb: D1Database;

  beforeEach(() => {
    mockDb = createMockD1Database();
    walletService = new WalletService(mockDb);
  });

  // ─── Find Wallet ─────────────────────────────────────────
  describe('findByUserId', () => {
    it('returns wallet when found', async () => {
      const wallet = testData.wallet('user-123');
      mockDb = createMockD1Database({ first: wallet });
      walletService = new WalletService(mockDb);

      const result = await walletService.findByUserId('user-123');

      expect(result).toEqual(wallet);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        'SELECT * FROM wallets WHERE user_id = ?'
      );
    });

    it('returns null when not found', async () => {
      const result = await walletService.findByUserId('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('returns wallet by ID', async () => {
      const wallet = testData.wallet('user-123');
      mockDb = createMockD1Database({ first: wallet });
      walletService = new WalletService(mockDb);

      const result = await walletService.findById(wallet.id);

      expect(result).toEqual(wallet);
    });
  });

  // ─── Create Wallet ───────────────────────────────────────
  describe('create', () => {
    it('creates wallet with zero balances', async () => {
      const userId = 'user-123';
      const walletId = 'wallet-123';
      const createdWallet = testData.wallet(userId, { id: walletId });

      // First call to run, then call to findById
      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
        first: vi.fn().mockResolvedValue(createdWallet),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      walletService = new WalletService(mockDb);

      const result = await walletService.create(userId, walletId);

      expect(result).toEqual(createdWallet);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO wallets')
      );
    });

    it('throws error if wallet creation fails', async () => {
      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
        first: vi.fn().mockResolvedValue(null),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      walletService = new WalletService(mockDb);

      await expect(walletService.create('user-123', 'wallet-123')).rejects.toThrow(
        'Failed to create wallet'
      );
    });
  });

  // ─── Update Balances ─────────────────────────────────────
  describe('updateTokenBalance', () => {
    it('updates token balance with positive amount', async () => {
      await walletService.updateTokenBalance('wallet-123', 10);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('token_balance = token_balance + ?')
      );
    });

    it('updates token balance with negative amount', async () => {
      await walletService.updateTokenBalance('wallet-123', -5);

      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  describe('updateCashBalance', () => {
    it('updates cash balance', async () => {
      await walletService.updateCashBalance('wallet-123', 100000);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('cash_balance = cash_balance + ?')
      );
    });
  });

  describe('getBalance', () => {
    it('returns formatted balance', async () => {
      const wallet = testData.wallet('user-123', {
        token_balance: 5.5,
        cash_balance: 150000,
      });
      mockDb = createMockD1Database({ first: wallet });
      walletService = new WalletService(mockDb);

      const result = await walletService.getBalance('user-123');

      expect(result).toEqual({
        tokenBalance: 5.5,
        cashBalance: 150000,
      });
    });

    it('returns null if wallet not found', async () => {
      const result = await walletService.getBalance('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ─── Transactions ────────────────────────────────────────
  describe('createTransaction', () => {
    it('creates transaction with PENDING status', async () => {
      const tx = testData.transaction('user-123', 'wallet-123');
      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
        first: vi.fn().mockResolvedValue(tx),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      walletService = new WalletService(mockDb);

      const result = await walletService.createTransaction({
        id: tx.id,
        userId: tx.user_id,
        walletId: tx.wallet_id,
        type: 'BUY',
        tokenAmount: 1,
        cashAmount: 53000,
        pricePerGram: 53000,
        fees: 265,
        paymentMethod: 'orange_money',
      });

      expect(result.status).toBe('PENDING');
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO transactions")
      );
    });
  });

  describe('findTransactionById', () => {
    it('returns transaction when found', async () => {
      const tx = testData.transaction('user-123', 'wallet-123');
      mockDb = createMockD1Database({ first: tx });
      walletService = new WalletService(mockDb);

      const result = await walletService.findTransactionById(tx.id);

      expect(result).toEqual(tx);
    });
  });

  describe('findTransactionsByUserId', () => {
    it('returns paginated transactions', async () => {
      const transactions = [
        testData.transaction('user-123', 'wallet-123'),
        testData.transaction('user-123', 'wallet-123'),
      ];

      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ count: 2 }),
        all: vi.fn().mockResolvedValue({ results: transactions }),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      walletService = new WalletService(mockDb);

      const result = await walletService.findTransactionsByUserId('user-123', 50, 0);

      expect(result.transactions).toHaveLength(2);
      expect(result.total).toBe(2);
    });
  });

  describe('updateTransactionStatus', () => {
    it('updates status to COMPLETED with timestamp', async () => {
      await walletService.updateTransactionStatus('tx-123', 'COMPLETED');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("SET status = ?, completed_at = datetime('now')")
      );
    });

    it('updates status to FAILED with reason', async () => {
      await walletService.updateTransactionStatus('tx-123', 'FAILED', 'Insufficient funds');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('failure_reason')
      );
    });
  });

  // ─── Atomic Buy/Sell ─────────────────────────────────────
  describe('processBuyTransaction', () => {
    it('returns true when sufficient balance', async () => {
      mockDb = createMockD1Database({ changes: 1 });
      walletService = new WalletService(mockDb);

      const result = await walletService.processBuyTransaction(
        'tx-123',
        'wallet-123',
        1,
        53000
      );

      expect(result).toBe(true);
    });

    it('returns false when insufficient balance', async () => {
      mockDb = createMockD1Database({ changes: 0 });
      walletService = new WalletService(mockDb);

      const result = await walletService.processBuyTransaction(
        'tx-123',
        'wallet-123',
        1,
        53000
      );

      expect(result).toBe(false);
    });
  });

  describe('processSellTransaction', () => {
    it('returns true when sufficient token balance', async () => {
      mockDb = createMockD1Database({ changes: 1 });
      walletService = new WalletService(mockDb);

      const result = await walletService.processSellTransaction(
        'tx-123',
        'wallet-123',
        1,
        51000
      );

      expect(result).toBe(true);
    });

    it('returns false when insufficient token balance', async () => {
      mockDb = createMockD1Database({ changes: 0 });
      walletService = new WalletService(mockDb);

      const result = await walletService.processSellTransaction(
        'tx-123',
        'wallet-123',
        10,
        510000
      );

      expect(result).toBe(false);
    });
  });

  // ─── Volume Tracking ─────────────────────────────────────
  describe('getDailyTransactionVolume', () => {
    it('returns daily volume for type', async () => {
      mockDb = createMockD1Database({ first: { total: 5.5 } });
      walletService = new WalletService(mockDb);

      const result = await walletService.getDailyTransactionVolume('user-123', 'BUY');

      expect(result).toBe(5.5);
    });

    it('returns 0 when no transactions', async () => {
      mockDb = createMockD1Database({ first: { total: 0 } });
      walletService = new WalletService(mockDb);

      const result = await walletService.getDailyTransactionVolume('user-123', 'BUY');

      expect(result).toBe(0);
    });
  });

  describe('getMonthlyTransactionVolume', () => {
    it('returns monthly volume', async () => {
      mockDb = createMockD1Database({ first: { total: 50 } });
      walletService = new WalletService(mockDb);

      const result = await walletService.getMonthlyTransactionVolume('user-123', 'BUY');

      expect(result).toBe(50);
    });
  });

  describe('getAverageBuyPrice', () => {
    it('returns total tokens and cash', async () => {
      mockDb = createMockD1Database({
        first: { total_tokens: 10, total_cash: 530000 },
      });
      walletService = new WalletService(mockDb);

      const result = await walletService.getAverageBuyPrice('user-123');

      expect(result.totalTokensBought).toBe(10);
      expect(result.totalCashSpent).toBe(530000);
    });

    it('returns zeros when no purchases', async () => {
      mockDb = createMockD1Database({ first: null });
      walletService = new WalletService(mockDb);

      const result = await walletService.getAverageBuyPrice('user-123');

      expect(result.totalTokensBought).toBe(0);
      expect(result.totalCashSpent).toBe(0);
    });
  });

  // ─── Filtered Transactions ───────────────────────────────
  describe('findTransactionsFiltered', () => {
    it('filters by type', async () => {
      const transactions = [testData.transaction('user-123', 'wallet-123', { type: 'BUY' })];
      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ count: 1 }),
        all: vi.fn().mockResolvedValue({ results: transactions }),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      walletService = new WalletService(mockDb);

      const result = await walletService.findTransactionsFiltered('user-123', 50, 0, 'BUY');

      expect(result.transactions).toHaveLength(1);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('AND type = ?')
      );
    });

    it('filters by status', async () => {
      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ count: 0 }),
        all: vi.fn().mockResolvedValue({ results: [] }),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      walletService = new WalletService(mockDb);

      await walletService.findTransactionsFiltered('user-123', 50, 0, undefined, 'COMPLETED');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('AND status = ?')
      );
    });

    it('filters by both type and status', async () => {
      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ count: 0 }),
        all: vi.fn().mockResolvedValue({ results: [] }),
      };
      mockDb = {
        prepare: vi.fn().mockReturnValue(mockStatement),
      } as unknown as D1Database;
      walletService = new WalletService(mockDb);

      await walletService.findTransactionsFiltered('user-123', 50, 0, 'SELL', 'COMPLETED');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('AND type = ?')
      );
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('AND status = ?')
      );
    });
  });
});
