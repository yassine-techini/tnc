/**
 * Wallet Service - D1 Database operations for wallets and transactions
 */

export interface WalletRow {
  id: string;
  user_id: string;
  token_balance: number;
  cash_balance: number;
  created_at: string;
  updated_at: string;
}

export interface TransactionRow {
  id: string;
  user_id: string;
  wallet_id: string;
  type: 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL' | 'FEE';
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  token_amount: number | null;
  cash_amount: number;
  price_per_gram: number | null;
  fees: number;
  payment_method: string | null;
  payment_reference: string | null;
  failure_reason: string | null;
  created_at: string;
  completed_at: string | null;
}

export class WalletService {
  constructor(private db: D1Database) {}

  async findByUserId(userId: string): Promise<WalletRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM wallets WHERE user_id = ?')
      .bind(userId)
      .first<WalletRow>();
    return result || null;
  }

  async findById(id: string): Promise<WalletRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM wallets WHERE id = ?')
      .bind(id)
      .first<WalletRow>();
    return result || null;
  }

  async create(userId: string, walletId: string): Promise<WalletRow> {
    await this.db
      .prepare(
        `INSERT INTO wallets (id, user_id, token_balance, cash_balance)
         VALUES (?, ?, 0, 0)`
      )
      .bind(walletId, userId)
      .run();

    const wallet = await this.findById(walletId);
    if (!wallet) throw new Error('Failed to create wallet');
    return wallet;
  }

  async updateTokenBalance(walletId: string, amount: number): Promise<void> {
    await this.db
      .prepare(
        `UPDATE wallets SET token_balance = token_balance + ?, updated_at = datetime('now') WHERE id = ?`
      )
      .bind(amount, walletId)
      .run();
  }

  async updateCashBalance(walletId: string, amount: number): Promise<void> {
    await this.db
      .prepare(
        `UPDATE wallets SET cash_balance = cash_balance + ?, updated_at = datetime('now') WHERE id = ?`
      )
      .bind(amount, walletId)
      .run();
  }

  async getBalance(userId: string): Promise<{ tokenBalance: number; cashBalance: number } | null> {
    const wallet = await this.findByUserId(userId);
    if (!wallet) return null;
    return {
      tokenBalance: wallet.token_balance,
      cashBalance: wallet.cash_balance,
    };
  }

  // Transaction methods
  async createTransaction(data: {
    id: string;
    userId: string;
    walletId: string;
    type: 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL' | 'FEE';
    tokenAmount?: number;
    cashAmount: number;
    pricePerGram?: number;
    fees: number;
    paymentMethod?: string;
    paymentReference?: string;
  }): Promise<TransactionRow> {
    await this.db
      .prepare(
        `INSERT INTO transactions (id, user_id, wallet_id, type, status, token_amount, cash_amount, price_per_gram, fees, payment_method, payment_reference)
         VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        data.id,
        data.userId,
        data.walletId,
        data.type,
        data.tokenAmount || null,
        data.cashAmount,
        data.pricePerGram || null,
        data.fees,
        data.paymentMethod || null,
        data.paymentReference || null
      )
      .run();

    const transaction = await this.findTransactionById(data.id);
    if (!transaction) throw new Error('Failed to create transaction');
    return transaction;
  }

  async findTransactionById(id: string): Promise<TransactionRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM transactions WHERE id = ?')
      .bind(id)
      .first<TransactionRow>();
    return result || null;
  }

  async findTransactionsByUserId(
    userId: string,
    limit = 50,
    offset = 0
  ): Promise<{ transactions: TransactionRow[]; total: number }> {
    const countResult = await this.db
      .prepare('SELECT COUNT(*) as count FROM transactions WHERE user_id = ?')
      .bind(userId)
      .first<{ count: number }>();

    const transactions = await this.db
      .prepare(
        `SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .bind(userId, limit, offset)
      .all<TransactionRow>();

    return {
      transactions: transactions.results || [],
      total: countResult?.count || 0,
    };
  }

  async updateTransactionStatus(
    transactionId: string,
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED',
    failureReason?: string
  ): Promise<void> {
    if (status === 'COMPLETED') {
      await this.db
        .prepare(
          `UPDATE transactions SET status = ?, completed_at = datetime('now') WHERE id = ?`
        )
        .bind(status, transactionId)
        .run();
    } else if (status === 'FAILED' && failureReason) {
      await this.db
        .prepare(
          `UPDATE transactions SET status = ?, failure_reason = ? WHERE id = ?`
        )
        .bind(status, failureReason, transactionId)
        .run();
    } else {
      await this.db
        .prepare(`UPDATE transactions SET status = ? WHERE id = ?`)
        .bind(status, transactionId)
        .run();
    }
  }

  /**
   * Atomically process a buy transaction.
   * Returns true if the wallet had sufficient cash balance, false otherwise.
   * Uses conditional UPDATE to prevent race conditions on concurrent purchases.
   */
  async processBuyTransaction(
    transactionId: string,
    walletId: string,
    tokenAmount: number,
    cashAmount: number
  ): Promise<boolean> {
    // Atomic: deduct cash only if sufficient balance
    const walletUpdate = await this.db
      .prepare(
        `UPDATE wallets
         SET cash_balance = cash_balance - ?,
             token_balance = token_balance + ?,
             total_bought = total_bought + ?,
             total_spent = total_spent + ?,
             updated_at = datetime('now')
         WHERE id = ? AND cash_balance >= ?`
      )
      .bind(cashAmount, tokenAmount, tokenAmount, cashAmount, walletId, cashAmount)
      .run();

    if (walletUpdate.meta.changes === 0) {
      await this.updateTransactionStatus(transactionId, 'FAILED', 'Solde insuffisant');
      return false;
    }

    await this.db
      .prepare(
        `UPDATE transactions SET status = 'COMPLETED', completed_at = datetime('now') WHERE id = ?`
      )
      .bind(transactionId)
      .run();

    return true;
  }

  /**
   * Atomically process a sell transaction.
   * Returns true if the wallet had sufficient token balance, false otherwise.
   */
  async processSellTransaction(
    transactionId: string,
    walletId: string,
    tokenAmount: number,
    cashAmount: number
  ): Promise<boolean> {
    // Atomic: deduct tokens only if sufficient balance
    const walletUpdate = await this.db
      .prepare(
        `UPDATE wallets
         SET token_balance = token_balance - ?,
             cash_balance = cash_balance + ?,
             updated_at = datetime('now')
         WHERE id = ? AND token_balance >= ?`
      )
      .bind(tokenAmount, cashAmount, walletId, tokenAmount)
      .run();

    if (walletUpdate.meta.changes === 0) {
      await this.updateTransactionStatus(transactionId, 'FAILED', 'Solde de tokens insuffisant');
      return false;
    }

    await this.db
      .prepare(
        `UPDATE transactions SET status = 'COMPLETED', completed_at = datetime('now') WHERE id = ?`
      )
      .bind(transactionId)
      .run();

    return true;
  }

  async getDailyTransactionVolume(
    userId: string,
    type: 'BUY' | 'SELL'
  ): Promise<number> {
    const result = await this.db
      .prepare(
        `SELECT COALESCE(SUM(token_amount), 0) as total
         FROM transactions
         WHERE user_id = ?
         AND type = ?
         AND status = 'COMPLETED'
         AND created_at >= date('now')`
      )
      .bind(userId, type)
      .first<{ total: number }>();
    return result?.total || 0;
  }

  /**
   * Get average buy price via SQL aggregate (avoids N+1 fetching all transactions).
   */
  async getAverageBuyPrice(userId: string): Promise<{ totalTokensBought: number; totalCashSpent: number }> {
    const result = await this.db
      .prepare(
        `SELECT COALESCE(SUM(token_amount), 0) as total_tokens,
                COALESCE(SUM(cash_amount), 0) as total_cash
         FROM transactions
         WHERE user_id = ? AND type = 'BUY' AND status = 'COMPLETED'`
      )
      .bind(userId)
      .first<{ total_tokens: number; total_cash: number }>();
    return {
      totalTokensBought: result?.total_tokens || 0,
      totalCashSpent: result?.total_cash || 0,
    };
  }

  /**
   * Find transactions with optional SQL-level type/status filtering.
   */
  async findTransactionsFiltered(
    userId: string,
    limit = 50,
    offset = 0,
    type?: string,
    status?: string
  ): Promise<{ transactions: TransactionRow[]; total: number }> {
    let whereClause = 'WHERE user_id = ?';
    const bindings: (string | number)[] = [userId];

    if (type) {
      whereClause += ' AND type = ?';
      bindings.push(type);
    }
    if (status) {
      whereClause += ' AND status = ?';
      bindings.push(status);
    }

    const countResult = await this.db
      .prepare(`SELECT COUNT(*) as count FROM transactions ${whereClause}`)
      .bind(...bindings)
      .first<{ count: number }>();

    const transactions = await this.db
      .prepare(
        `SELECT * FROM transactions ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .bind(...bindings, limit, offset)
      .all<TransactionRow>();

    return {
      transactions: transactions.results || [],
      total: countResult?.count || 0,
    };
  }

  async getMonthlyTransactionVolume(
    userId: string,
    type: 'BUY' | 'SELL'
  ): Promise<number> {
    const result = await this.db
      .prepare(
        `SELECT COALESCE(SUM(token_amount), 0) as total
         FROM transactions
         WHERE user_id = ?
         AND type = ?
         AND status = 'COMPLETED'
         AND created_at >= date('now', 'start of month')`
      )
      .bind(userId, type)
      .first<{ total: number }>();
    return result?.total || 0;
  }
}
