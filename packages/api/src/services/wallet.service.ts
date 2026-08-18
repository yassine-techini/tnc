/**
 * Wallet Service - D1 Database operations for wallets and transactions
 */

import { GOLD_STOCK_ID } from './market.service';

export type TradeFailureReason = 'INSUFFICIENT_BALANCE' | 'INSUFFICIENT_STOCK' | 'CONFLICT';
// `reason` is always present (null on success) rather than a discriminated
// union, because this package compiles with strictNullChecks:false, under which
// `{ ok: true } | { ok: false; reason }` does not narrow on `!result.ok`.
export type TradeResult = { ok: boolean; reason: TradeFailureReason | null };

/**
 * Pourquoi un lot a echoue — determine par l'ETAT, pas par le texte de l'erreur
 * (ADR 023).
 *
 * La version precedente cherchait un nom de colonne dans le message :
 *
 *     if (msg.includes('tokens_issued') || msg.includes('total_allocated'))
 *
 * Cela marche tant que SQLite recopie l'expression de la contrainte. Nommer la
 * contrainte — chose banale dans une migration — donne « CHECK constraint
 * failed: stock_couvert », et `INSUFFICIENT_STOCK` devient silencieusement
 * `CONFLICT` : le titulaire s'entend dire « reessayez » alors qu'il n'y a pas
 * assez d'or.
 *
 * Le lot ayant ete annule, l'etat relu est celui d'avant la tentative — donc
 * exactement celui qui explique l'echec. Une requete de plus, sur un chemin qui
 * a deja echoue.
 */
export async function raisonDeLEchec(
  db: D1Database,
  p: { walletId: string; besoinTokensG?: number; besoinEspeces?: number; stockDemandeG?: number }
): Promise<TradeFailureReason> {
  const wallet = await db
    .prepare('SELECT token_balance, cash_balance FROM wallets WHERE id = ?')
    .bind(p.walletId)
    .first<{ token_balance: number; cash_balance: number }>();

  if (p.stockDemandeG !== undefined) {
    const stock = await db
      .prepare('SELECT total_allocated, tokens_issued FROM gold_stock WHERE id = ?')
      .bind(GOLD_STOCK_ID)
      .first<{ total_allocated: number; tokens_issued: number }>();
    if (!stock || stock.total_allocated - stock.tokens_issued < p.stockDemandeG) {
      return 'INSUFFICIENT_STOCK';
    }
  }

  if (!wallet) return 'CONFLICT';
  if (p.besoinTokensG !== undefined && wallet.token_balance < p.besoinTokensG) return 'INSUFFICIENT_BALANCE';
  if (p.besoinEspeces !== undefined && wallet.cash_balance < p.besoinEspeces) return 'INSUFFICIENT_BALANCE';

  // L'etat autorise l'operation : l'echec vient d'ailleurs — une ecriture
  // concurrente, le plus souvent. C'est bien un conflit.
  return 'CONFLICT';
}

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

  /**
   * Cree un portefeuille dans la devise DU PAYS de son titulaire (ADR 019).
   *
   * La devise est figee ici : la deriver du pays a la lecture serait faux, un
   * titulaire pouvant changer de pays alors que ses ecritures passees gardent
   * l'unite dans laquelle elles ont ete faites.
   *
   * `SELECT … FROM country_config` dans la meme instruction : le portefeuille ne
   * peut pas naitre sans devise, et retombe sur celle du pays par defaut plutot
   * que sur une valeur vide.
   */
  async create(userId: string, walletId: string): Promise<WalletRow> {
    await this.db
      .prepare(
        `INSERT INTO wallets (id, user_id, token_balance, cash_balance, currency)
         VALUES (?, ?, 0, 0, COALESCE(
           (SELECT c.currency FROM country_config c
             JOIN users u ON u.country = c.code WHERE u.id = ?),
           'XOF'
         ))`
      )
      .bind(walletId, userId, userId)
      .run();

    const wallet = await this.findById(walletId);
    if (!wallet) throw new Error('Failed to create wallet');
    return wallet;
  }

  async updateTokenBalance(walletId: string, amount: number): Promise<void> {
    await this.db
      .prepare(
        `UPDATE wallets SET token_balance = ROUND(token_balance + ?, 3), updated_at = datetime('now') WHERE id = ?`
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
        `INSERT INTO transactions
           (id, user_id, wallet_id, type, status, token_amount, cash_amount, price_per_gram, fees, payment_method, payment_reference, currency)
         VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, (SELECT currency FROM wallets WHERE id = ?))`
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
        data.paymentReference || null,
        data.walletId
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
             token_balance = ROUND(token_balance + ?, 3),
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
         SET token_balance = ROUND(token_balance - ?, 3),
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

  /**
   * Execute a BUY atomically: reserve stock + debit cash/credit tokens + record
   * the COMPLETED transaction, all in a single D1 batch (one implicit DB
   * transaction). If any statement violates a CHECK constraint
   * (cash_balance >= 0, tokens_issued <= total_allocated) the ENTIRE batch is
   * rolled back â€” there is no partial state. This replaces the previous
   * multi-step flow that could leave stock reserved without tokens credited on
   * a mid-request crash.
   *
   * `total` (fees included) is what leaves the cash balance and is recorded in
   * total_spent; `cashAmount` (fees excluded) + `fees` are stored on the
   * transaction row so the two are reconcilable.
   */
  async executeBuyAtomic(p: {
    transactionId: string;
    userId: string;
    walletId: string;
    tokenAmount: number;
    cashAmount: number;
    total: number;
    pricePerGram: number;
    fees: number;
    paymentMethod?: string;
  }): Promise<TradeResult> {
    // Deterministic reason for the common case. The db.batch below (guarded by
    // the cash_balance >= 0 and tokens_issued <= total_allocated CHECK
    // constraints) remains the atomic source of truth; message-based
    // classification is only a last-resort fallback for a lost race.
    const wallet = await this.db
      .prepare('SELECT cash_balance FROM wallets WHERE id = ?')
      .bind(p.walletId)
      .first<{ cash_balance: number }>();
    if (!wallet || wallet.cash_balance < p.total) {
      return { ok: false, reason: 'INSUFFICIENT_BALANCE' };
    }
    const stockRow = await this.db
      .prepare('SELECT total_allocated, tokens_issued FROM gold_stock WHERE id = ?')
      .bind(GOLD_STOCK_ID)
      .first<{ total_allocated: number; tokens_issued: number }>();
    if (!stockRow || (stockRow.total_allocated - stockRow.tokens_issued) < p.tokenAmount) {
      return { ok: false, reason: 'INSUFFICIENT_STOCK' };
    }
    try {
      await this.db.batch([
        this.db
          .prepare(
            `UPDATE gold_stock
             SET tokens_issued = ROUND(tokens_issued + ?, 3), updated_at = datetime('now')
             WHERE id = ?`
          )
          .bind(p.tokenAmount, GOLD_STOCK_ID),
        this.db
          .prepare(
            `UPDATE wallets
             SET cash_balance = cash_balance - ?,
                 token_balance = ROUND(token_balance + ?, 3),
                 total_bought = total_bought + ?,
                 total_spent = total_spent + ?,
                 updated_at = datetime('now')
             WHERE id = ?`
          )
          .bind(p.total, p.tokenAmount, p.tokenAmount, p.total, p.walletId),
        this.db
          .prepare(
            `INSERT INTO transactions
               (id, user_id, wallet_id, type, status, token_amount, cash_amount, price_per_gram, fees, payment_method, completed_at, currency)
             VALUES (?, ?, ?, 'BUY', 'COMPLETED', ?, ?, ?, ?, ?, datetime('now'), (SELECT currency FROM wallets WHERE id = ?))`
          )
          .bind(p.transactionId, p.userId, p.walletId, p.tokenAmount, p.cashAmount, p.pricePerGram, p.fees, p.paymentMethod ?? null, p.walletId),
      ]);
      return { ok: true, reason: null };
    } catch {
      return {
        ok: false,
        // L'achat debite des especes et reserve du stock.
        reason: await raisonDeLEchec(this.db, {
          walletId: p.walletId,
          besoinEspeces: p.total,
          stockDemandeG: p.tokenAmount,
        }),
      };
    }
  }

  /**
   * Execute a SELL atomically: debit tokens + credit net cash + release stock +
   * record the COMPLETED transaction in a single D1 batch. All-or-nothing.
   * `total` is the net proceeds (cash_amount - fees) credited to the wallet.
   */
  async executeSellAtomic(p: {
    transactionId: string;
    userId: string;
    walletId: string;
    tokenAmount: number;
    cashAmount: number;
    total: number;
    pricePerGram: number;
    fees: number;
    paymentMethod?: string;
  }): Promise<TradeResult> {
    // Deterministic reason for the common case (see executeBuyAtomic). The batch
    // below, guarded by token_balance >= 0, is the atomic source of truth.
    const wallet = await this.db
      .prepare('SELECT token_balance FROM wallets WHERE id = ?')
      .bind(p.walletId)
      .first<{ token_balance: number }>();
    if (!wallet || wallet.token_balance < p.tokenAmount) {
      return { ok: false, reason: 'INSUFFICIENT_BALANCE' };
    }
    try {
      await this.db.batch([
        this.db
          .prepare(
            `UPDATE wallets
             SET token_balance = ROUND(token_balance - ?, 3),
                 cash_balance = cash_balance + ?,
                 updated_at = datetime('now')
             WHERE id = ?`
          )
          .bind(p.tokenAmount, p.total, p.walletId),
        // Unconditional so the batch stays all-or-nothing: a conditional WHERE
        // that silently no-ops would commit the token debit without releasing
        // stock. token_balance >= 0 (above) already guarantees the user held
        // the tokens, so tokens_issued cannot legitimately go negative here.
        this.db
          .prepare(
            `UPDATE gold_stock
             SET tokens_issued = ROUND(tokens_issued - ?, 3), updated_at = datetime('now')
             WHERE id = ?`
          )
          .bind(p.tokenAmount, GOLD_STOCK_ID),
        this.db
          .prepare(
            `INSERT INTO transactions
               (id, user_id, wallet_id, type, status, token_amount, cash_amount, price_per_gram, fees, payment_method, completed_at, currency)
             VALUES (?, ?, ?, 'SELL', 'COMPLETED', ?, ?, ?, ?, ?, datetime('now'), (SELECT currency FROM wallets WHERE id = ?))`
          )
          .bind(p.transactionId, p.userId, p.walletId, p.tokenAmount, p.cashAmount, p.pricePerGram, p.fees, p.paymentMethod ?? null, p.walletId),
      ]);
      return { ok: true, reason: null };
    } catch {
      return {
        ok: false,
        // La vente debite des grammes ; le stock, lui, diminue.
        reason: await raisonDeLEchec(this.db, {
          walletId: p.walletId,
          besoinTokensG: p.tokenAmount,
        }),
      };
    }
  }

  /**
   * Execute a withdrawal atomically: record the PENDING transaction + withdrawal
   * rows AND debit the cash balance in a single D1 batch. The cash_balance >= 0
   * CHECK constraint rolls the whole batch back on a concurrent double-withdraw,
   * so a lost race can never overdraw. Returns INSUFFICIENT_BALANCE deterministically
   * for the common case, CONFLICT for a lost race.
   */
  async executeWithdrawalAtomic(p: {
    transactionId: string;
    withdrawalId: string;
    userId: string;
    walletId: string;
    amount: number;
    fees: number;
    netAmount: number;
    method: string;
    phoneNumber?: string | null;
    bankAccount?: string | null;
    bankName?: string | null;
    paymentReference?: string | null;
  }): Promise<TradeResult> {
    const wallet = await this.db
      .prepare('SELECT cash_balance FROM wallets WHERE id = ?')
      .bind(p.walletId)
      .first<{ cash_balance: number }>();
    if (!wallet || wallet.cash_balance < p.amount) {
      return { ok: false, reason: 'INSUFFICIENT_BALANCE' };
    }
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO transactions
               (id, user_id, wallet_id, type, status, token_amount, cash_amount, price_per_gram, fees, payment_method, payment_reference, currency)
             VALUES (?, ?, ?, 'WITHDRAWAL', 'PENDING', NULL, ?, NULL, ?, ?, ?, (SELECT currency FROM wallets WHERE id = ?))`
          )
          .bind(p.transactionId, p.userId, p.walletId, p.amount, p.fees, p.method, p.paymentReference ?? null, p.walletId),
        this.db
          .prepare(
            `INSERT INTO withdrawals (id, transaction_id, method, amount, fees, net_amount, phone_number, bank_account, bank_name, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', datetime('now'))`
          )
          .bind(p.withdrawalId, p.transactionId, p.method, p.amount, p.fees, p.netAmount, p.phoneNumber ?? null, p.bankAccount ?? null, p.bankName ?? null),
        this.db
          .prepare(`UPDATE wallets SET cash_balance = cash_balance - ?, updated_at = datetime('now') WHERE id = ?`)
          .bind(p.amount, p.walletId),
      ]);
      return { ok: true, reason: null };
    } catch {
      return {
        ok: false,
        // Le retrait ne touche que les especes.
        reason: await raisonDeLEchec(this.db, {
          walletId: p.walletId,
          besoinEspeces: p.amount,
        }),
      };
    }
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
   * Cost basis INCLUDES fees (cash_amount + fees) so it matches what actually
   * left the cash balance (total_spent) and the avg_buy_price SQL view.
   */
  async getAverageBuyPrice(userId: string): Promise<{ totalTokensBought: number; totalCashSpent: number }> {
    const result = await this.db
      .prepare(
        `SELECT COALESCE(SUM(token_amount), 0) as total_tokens,
                COALESCE(SUM(cash_amount + fees), 0) as total_cash
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
