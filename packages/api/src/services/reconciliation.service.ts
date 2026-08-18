import { NotificationService } from './notification.service';
import type {
  DailyReconciliationData,
  ReconciliationReportData,
  ReconciliationTransaction,
  WalletDiscrepancy,
} from '@tnc-trading/shared/contracts';
import { ConfigService } from './config.service';

// La forme d'une transaction vue par la reconciliation vient du contrat partage :
// l'ecran d'administration lit exactement ce que ce service produit.
type Transaction = ReconciliationTransaction;

interface ReconciliationResult {
  transactionId: string;
  previousStatus: string;
  newStatus: string;
  reconciled: boolean;
  message: string;
}

type ReconciliationReport = ReconciliationReportData;

export class ReconciliationService {
  private configService: ConfigService | null;

  constructor(
    private db: D1Database,
    private notificationService?: NotificationService,
    configService?: ConfigService
  ) {
    this.configService = configService || null;
  }

  /**
   * Get transactions that are stuck (pending for too long)
   */
  async getStuckTransactions(thresholdMinutes?: number): Promise<Transaction[]> {
    if (!thresholdMinutes && this.configService) {
      thresholdMinutes = await this.configService.getNumber('reconciliation_stuck_transaction_minutes', 60);
    }
    // SECURITY: Clamp threshold to safe range [1, 10080] (1 minute to 7 days)
    // This prevents SQL injection and unreasonable values
    const safeThreshold = Math.max(1, Math.min(Math.floor(thresholdMinutes || 60), 10080));

    // Calculate the cutoff datetime in JavaScript and pass as parameter
    // This avoids string interpolation in SQL
    const cutoffDate = new Date(Date.now() - safeThreshold * 60 * 1000).toISOString();

    const result = await this.db
      .prepare(`
        SELECT t.*, u.email as user_email
        FROM transactions t
        LEFT JOIN users u ON t.user_id = u.id
        WHERE t.status IN ('PENDING', 'PROCESSING')
          AND t.created_at < ?
        ORDER BY t.created_at ASC
      `)
      .bind(cutoffDate)
      .all<Transaction & { user_email: string }>();

    return result.results || [];
  }

  /**
   * Get transactions pending reconciliation (external reference not matched)
   */
  async getPendingReconciliation(): Promise<Transaction[]> {
    const result = await this.db
      .prepare(`
        SELECT t.*, u.email as user_email
        FROM transactions t
        LEFT JOIN users u ON t.user_id = u.id
        WHERE t.status = 'PROCESSING'
          AND t.payment_reference IS NOT NULL
          AND t.external_reference IS NULL
        ORDER BY t.created_at ASC
      `)
      .all<Transaction & { user_email: string }>();

    return result.results || [];
  }

  /**
   * Manually reconcile a transaction
   */
  async reconcileTransaction(
    transactionId: string,
    action: 'complete' | 'fail' | 'cancel',
    externalReference?: string,
    reason?: string,
    adminId?: string
  ): Promise<ReconciliationResult> {
    const transaction = await this.db
      .prepare('SELECT * FROM transactions WHERE id = ?')
      .bind(transactionId)
      .first<Transaction>();

    if (!transaction) {
      return {
        transactionId,
        previousStatus: 'UNKNOWN',
        newStatus: 'UNKNOWN',
        reconciled: false,
        message: 'Transaction non trouvée',
      };
    }

    const previousStatus = transaction.status;
    let newStatus: string;
    let walletUpdate = false;

    switch (action) {
      case 'complete':
        newStatus = 'COMPLETED';
        walletUpdate = true;
        break;
      case 'fail':
        newStatus = 'FAILED';
        // Refund if it was a deposit that failed
        if (transaction.type === 'DEPOSIT' && transaction.status === 'PROCESSING') {
          // No refund needed for failed deposits
        }
        break;
      case 'cancel':
        newStatus = 'CANCELLED';
        // Refund the amount for buy transactions that are cancelled
        if (['BUY', 'WITHDRAWAL'].includes(transaction.type)) {
          await this.refundTransaction(transaction);
        }
        break;
      default:
        return {
          transactionId,
          previousStatus,
          newStatus: previousStatus,
          reconciled: false,
          message: 'Action invalide',
        };
    }

    // Correction, crédit éventuel et trace dans le MÊME lot (ADR 016).
    //
    // C'est ici que l'écart comptait le plus : cette écriture est la SEULE du
    // dépôt à renseigner `old_value`, donc la plus informative — et elle était
    // faite en instruction séparée, donc la moins sûre. Corriger à la main
    // l'état d'une transaction sans laisser de trace est précisément ce qu'une
    // piste d'audit existe pour empêcher.
    const ecritures = [
      this.db
        .prepare(`
          UPDATE transactions
          SET status = ?,
              external_reference = COALESCE(?, external_reference),
              failure_reason = ?,
              completed_at = CASE WHEN ? = 'COMPLETED' THEN datetime('now') ELSE completed_at END,
              updated_at = datetime('now')
          WHERE id = ?
        `)
        .bind(newStatus, externalReference || null, reason || null, newStatus, transactionId),
    ];

    if (walletUpdate && transaction.type === 'DEPOSIT' && action === 'complete') {
      ecritures.push(
        this.db
          .prepare(`
            UPDATE wallets
            SET cash_balance = cash_balance + ?, updated_at = datetime('now')
            WHERE id = ?
          `)
          .bind(transaction.cash_amount - transaction.fees, transaction.wallet_id)
      );
    }

    if (adminId) {
      ecritures.push(
        this.db
          .prepare(`
            INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, old_value, new_value, created_at)
            SELECT ?, ?, 'RECONCILE_TRANSACTION', 'transaction', id, ?, ?, datetime('now')
            FROM transactions WHERE id = ?
          `)
          .bind(
            crypto.randomUUID(),
            adminId,
            JSON.stringify({ status: previousStatus }),
            JSON.stringify({ status: newStatus, reason, externalReference }),
            transactionId
          )
      );
    }

    await this.db.batch(ecritures);

    // Notify user
    if (this.notificationService) {
      const user = await this.db
        .prepare('SELECT email, phone FROM users WHERE id = ?')
        .bind(transaction.user_id)
        .first<{ email: string; phone: string }>();

      if (user) {
        await this.createUserNotification(transaction, newStatus, reason);
      }
    }

    return {
      transactionId,
      previousStatus,
      newStatus,
      reconciled: true,
      message: `Transaction ${action === 'complete' ? 'complétée' : action === 'fail' ? 'échouée' : 'annulée'}`,
    };
  }

  /**
   * Refund a cancelled transaction
   */
  private async refundTransaction(transaction: Transaction): Promise<void> {
    if (transaction.type === 'BUY') {
      // Refund cash for cancelled buy (cash_amount + fees = total paid by user)
      const totalPaid = transaction.cash_amount + (transaction.fees || 0);
      await this.db
        .prepare(`
          UPDATE wallets
          SET cash_balance = cash_balance + ?, updated_at = datetime('now')
          WHERE id = ?
        `)
        .bind(totalPaid, transaction.wallet_id)
        .run();
    } else if (transaction.type === 'WITHDRAWAL') {
      // Refund cash for cancelled withdrawal (full cash_amount was debited)
      await this.db
        .prepare(`
          UPDATE wallets
          SET cash_balance = cash_balance + ?, updated_at = datetime('now')
          WHERE id = ?
        `)
        .bind(transaction.cash_amount, transaction.wallet_id)
        .run();
    }
  }

  /**
   * Create in-app notification for reconciliation
   */
  private async createUserNotification(
    transaction: Transaction,
    newStatus: string,
    reason?: string
  ): Promise<void> {
    let title: string;
    let body: string;

    const amount = transaction.cash_amount.toLocaleString('fr-FR');
    const typeLabel = {
      BUY: 'Achat',
      SELL: 'Vente',
      DEPOSIT: 'Dépôt',
      WITHDRAWAL: 'Retrait',
      FEE: 'Frais',
    }[transaction.type] || transaction.type;

    switch (newStatus) {
      case 'COMPLETED':
        title = `${typeLabel} complété`;
        body = `Votre ${typeLabel.toLowerCase()} de ${amount} XOF a été traité avec succès.`;
        break;
      case 'FAILED':
        title = `${typeLabel} échoué`;
        body = `Votre ${typeLabel.toLowerCase()} de ${amount} XOF a échoué.${reason ? ` Raison: ${reason}` : ''}`;
        break;
      case 'CANCELLED':
        title = `${typeLabel} annulé`;
        body = `Votre ${typeLabel.toLowerCase()} de ${amount} XOF a été annulé.${reason ? ` Raison: ${reason}` : ''} Les fonds ont été recrédités.`;
        break;
      default:
        return;
    }

    await this.db
      .prepare(`
        INSERT INTO notifications (id, user_id, type, title, body, data, created_at)
        VALUES (?, ?, 'TRANSACTION', ?, ?, ?, datetime('now'))
      `)
      .bind(
        crypto.randomUUID(),
        transaction.user_id,
        title,
        body,
        JSON.stringify({ transactionId: transaction.id, status: newStatus })
      )
      .run();
  }

  /**
   * Generate reconciliation report for a period
   */
  async generateReport(periodStart: string, periodEnd: string): Promise<ReconciliationReport> {
    // Get summary counts
    const summary = await this.db
      .prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'PROCESSING' THEN 1 ELSE 0 END) as processing,
          SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled
        FROM transactions
        WHERE created_at BETWEEN ? AND ?
      `)
      .bind(periodStart, periodEnd)
      .first<any>();

    // Get volume by type
    const volumeByType = await this.db
      .prepare(`
        SELECT
          type,
          COUNT(*) as count,
          COALESCE(SUM(cash_amount), 0) as total_amount,
          COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN cash_amount ELSE 0 END), 0) as completed_amount
        FROM transactions
        WHERE created_at BETWEEN ? AND ?
        GROUP BY type
      `)
      .bind(periodStart, periodEnd)
      .all<any>();

    // Get stuck transactions
    const stuckTransactions = await this.getStuckTransactions();

    // Check for wallet balance discrepancies
    const discrepancies = await this.checkWalletDiscrepancies();

    return {
      reportDate: new Date().toISOString(),
      periodStart,
      periodEnd,
      summary: {
        totalTransactions: summary?.total || 0,
        completedTransactions: summary?.completed || 0,
        failedTransactions: summary?.failed || 0,
        pendingTransactions: summary?.pending || 0,
        processingTransactions: summary?.processing || 0,
        cancelledTransactions: summary?.cancelled || 0,
      },
      volumeByType: volumeByType.results || [],
      stuckTransactions,
      discrepancies,
    };
  }

  /**
   * Check for wallet balance discrepancies
   */
  async checkWalletDiscrepancies(): Promise<WalletDiscrepancy[]> {
    // Calculate expected balances from completed transactions
    const walletExpected = await this.db
      .prepare(`
        SELECT
          wallet_id,
          SUM(CASE
            WHEN type = 'DEPOSIT' AND status = 'COMPLETED' THEN cash_amount - fees
            WHEN type = 'WITHDRAWAL' AND status = 'COMPLETED' THEN -(cash_amount)
            WHEN type = 'BUY' AND status = 'COMPLETED' THEN -(cash_amount)
            WHEN type = 'SELL' AND status = 'COMPLETED' THEN cash_amount - fees
            ELSE 0
          END) as expected_cash
        FROM transactions
        GROUP BY wallet_id
      `)
      .all<{ wallet_id: string; expected_cash: number }>();

    // Get actual balances
    const walletActual = await this.db
      .prepare('SELECT id, cash_balance FROM wallets')
      .all<{ id: string; cash_balance: number }>();

    const discrepancies: { walletId: string; expectedBalance: number; actualBalance: number; difference: number }[] = [];

    const actualMap = new Map(walletActual.results?.map(w => [w.id, w.cash_balance]) || []);
    const expectedMap = new Map(walletExpected.results?.map(w => [w.wallet_id, w.expected_cash]) || []);

    // Check each wallet
    for (const [walletId, actualBalance] of actualMap) {
      const expectedBalance = expectedMap.get(walletId) || 0;
      const difference = Math.round((actualBalance - expectedBalance) * 1000) / 1000; // Round to 3 decimals

      // Report significant discrepancies (more than configured tolerance)
      const tolerance = this.configService
        ? await this.configService.getNumber('reconciliation_balance_tolerance', 0.01)
        : 0.01;
      if (Math.abs(difference) > tolerance) {
        discrepancies.push({
          walletId,
          expectedBalance,
          actualBalance,
          difference,
        });
      }
    }

    return discrepancies;
  }

  /**
   * Auto-reconcile transactions based on external payment confirmations
   */
  async autoReconcile(paymentReference: string, externalReference: string, status: 'success' | 'failed'): Promise<ReconciliationResult | null> {
    const transaction = await this.db
      .prepare(`
        SELECT * FROM transactions
        WHERE payment_reference = ? AND status = 'PROCESSING'
      `)
      .bind(paymentReference)
      .first<Transaction>();

    if (!transaction) {
      return null;
    }

    return this.reconcileTransaction(
      transaction.id,
      status === 'success' ? 'complete' : 'fail',
      externalReference,
      status === 'failed' ? 'Paiement échoué' : undefined
    );
  }

  /**
   * Get daily transaction summary for monitoring
   */
  async getDailySummary(): Promise<DailyReconciliationData> {
    const today = new Date().toISOString().split('T')[0];

    const summary = await this.db
      .prepare(`
        SELECT
          type,
          status,
          COUNT(*) as count,
          COALESCE(SUM(cash_amount), 0) as total_amount,
          COALESCE(SUM(token_amount), 0) as total_tokens
        FROM transactions
        WHERE date(created_at) = ?
        GROUP BY type, status
        ORDER BY type, status
      `)
      .bind(today)
      .all<any>();

    const hourlyDistribution = await this.db
      .prepare(`
        SELECT
          strftime('%H', created_at) as hour,
          COUNT(*) as count
        FROM transactions
        WHERE date(created_at) = ?
        GROUP BY hour
        ORDER BY hour
      `)
      .bind(today)
      .all<any>();

    return {
      date: today,
      summary: summary.results || [],
      hourlyDistribution: hourlyDistribution.results || [],
    };
  }
}
