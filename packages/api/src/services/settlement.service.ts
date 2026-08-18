/**
 * Two-step settlement of a consigned lot: an advance when the metal is received
 * in Dubai, the balance at outturn.
 *
 * THE INVARIANT, and why the advance allocates.
 *
 * Gold is normally allocated to the reserve at audit validation. Paying an
 * advance IN TOKENS at arrival would mint claims against gold not yet counted,
 * breaking `tokens_issued <= total_allocated`. So a token advance allocates its
 * own weight in the same guarded batch: at ARRIVED_DUBAI the metal is physically
 * in the vault and its receipt verified, so counting it — conservatively, with a
 * haircut — is honest rather than optimistic. The remainder is allocated at
 * outturn, once assayed.
 *
 * An advance in XOF issues no token and raises none of this.
 *
 * Every write follows the concurrency contract documented on
 * ConsignmentService.transition(): all statements carry the same guard, the one
 * that closes the step goes last, and the caller decides on its `meta.changes`.
 */
import { GOLD_STOCK_ID } from './market.service';

export type AdvanceCurrency = 'TOKENS' | 'XOF';

export interface AdvanceTerms {
  /** Share of the lot paid up front, 0..1. */
  percent: number;
  currency: AdvanceCurrency;
  /** Discount on declared weight, since nothing is assayed yet. */
  haircut: number;
  /** XOF per gram, used for a cash advance and recorded for the statement. */
  pricePerGram: number;
}

export type SettlementError =
  | 'NOT_FOUND'
  | 'WRONG_STATUS'
  | 'ALREADY_PAID'
  | 'NO_STOCK_ROW'
  | 'CONFLICT'
  | 'INVALID_TERMS';

/** Flat shape: this package compiles with strictNullChecks off (see TradeResult). */
export type SettlementResult =
  | { ok: true; tokensG: number; cashXof: number; error: null }
  | { ok: false; tokensG: 0; cashXof: 0; error: SettlementError };

const fail = (error: SettlementError): SettlementResult => ({ ok: false, tokensG: 0, cashXof: 0, error });

/** Grams are carried at 0.001 precision, XOF at the unit. */
const g = (n: number) => Math.round(n * 1000) / 1000;
const xof = (n: number) => Math.round(n);

export class SettlementService {
  constructor(private db: D1Database) {}

  /**
   * Weight the advance is computed on: declared weight, adjusted for declared
   * purity, then discounted. Deliberately conservative — overpaying an advance
   * against an unassayed lot is money the platform may not recover.
   */
  advanceWeight(declaredG: number, purity: number, terms: AdvanceTerms): number {
    return g(declaredG * purity * terms.haircut * terms.percent);
  }

  /**
   * Pay the advance for a lot that has arrived in Dubai.
   *
   * Guarded on status = 'ARRIVED_DUBAI' AND advance_paid_at IS NULL, so a retry
   * or a concurrent call cannot pay twice.
   */
  async payAdvance(
    consignmentId: string,
    terms: AdvanceTerms
  ): Promise<SettlementResult> {
    if (!(terms.percent > 0 && terms.percent <= 1) || !(terms.haircut > 0 && terms.haircut <= 1)) {
      return fail('INVALID_TERMS');
    }
    if (terms.currency === 'XOF' && !(terms.pricePerGram > 0)) {
      return fail('INVALID_TERMS');
    }

    const lot = await this.db
      .prepare(
        `SELECT id, producer_id, weight_declared_g, purity_declared, status, advance_paid_at
         FROM gold_consignments WHERE id = ?`
      )
      .bind(consignmentId)
      .first<{
        id: string;
        producer_id: string;
        weight_declared_g: number;
        purity_declared: number;
        status: string;
        advance_paid_at: string | null;
      }>();

    if (!lot) return fail('NOT_FOUND');
    if (lot.status !== 'ARRIVED_DUBAI') return fail('WRONG_STATUS');
    if (lot.advance_paid_at) return fail('ALREADY_PAID');

    const weight = this.advanceWeight(lot.weight_declared_g, lot.purity_declared, terms);
    if (weight <= 0) return fail('INVALID_TERMS');

    const tokensG = terms.currency === 'TOKENS' ? weight : 0;
    const cashXof = terms.currency === 'XOF' ? xof(weight * terms.pricePerGram) : 0;

    const walletId = await this.ensureWallet(lot.producer_id);
    if (!walletId) return fail('CONFLICT');

    const guard = `EXISTS (SELECT 1 FROM gold_consignments WHERE id = ? AND status = 'ARRIVED_DUBAI' AND advance_paid_at IS NULL)`;

    const statements = [];

    if (tokensG > 0) {
      // Allocate AND issue in a single statement so the invariant is never
      // transiently violated — same reasoning as the audit-validation payout.
      statements.push(
        this.db
          .prepare(
            `UPDATE gold_stock
             SET total_allocated = ROUND(total_allocated + ?, 3), tokens_issued = ROUND(tokens_issued + ?, 3),
                 updated_at = datetime('now')
             WHERE id = ? AND ${guard}`
          )
          .bind(tokensG, tokensG, GOLD_STOCK_ID, consignmentId)
      );
      statements.push(
        this.db
          .prepare(
            `UPDATE wallets SET token_balance = ROUND(token_balance + ?, 3), updated_at = datetime('now')
             WHERE id = ? AND ${guard}`
          )
          .bind(tokensG, walletId, consignmentId)
      );
    } else {
      statements.push(
        this.db
          .prepare(
            `UPDATE wallets SET cash_balance = cash_balance + ?, updated_at = datetime('now')
             WHERE id = ? AND ${guard}`
          )
          .bind(cashXof, walletId, consignmentId)
      );
    }

    statements.push(
      this.db
        .prepare(
          `INSERT INTO transactions
             (id, user_id, wallet_id, type, status, token_amount, cash_amount, price_per_gram, fees, payment_reference, completed_at)
           SELECT ?, ?, ?, 'CONSIGNMENT', 'COMPLETED', ?, ?, ?, 0, ?, datetime('now')
           WHERE ${guard}`
        )
        .bind(
          crypto.randomUUID(), lot.producer_id, walletId,
          tokensG > 0 ? tokensG : null, cashXof, terms.pricePerGram || null,
          `ADVANCE:${consignmentId}`, consignmentId
        )
    );

    statements.push(
      this.db
        .prepare(
          `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at)
           SELECT ?, NULL, 'CONSIGNMENT_ADVANCE_PAID', 'consignment', ?, ?, datetime('now')
           WHERE ${guard}`
        )
        .bind(
          crypto.randomUUID(), consignmentId,
          JSON.stringify({ tokensG, cashXof, terms }),
          consignmentId
        )
    );

    // Closes the step — last, and the one we read.
    statements.push(
      this.db
        .prepare(
          `UPDATE gold_consignments
           SET advance_tokens_g = ?, advance_cash_xof = ?, advance_price_per_gram = ?,
               advance_paid_at = datetime('now'), updated_at = datetime('now')
           WHERE id = ? AND status = 'ARRIVED_DUBAI' AND advance_paid_at IS NULL`
        )
        .bind(tokensG || null, cashXof || null, terms.pricePerGram || null, consignmentId)
    );

    try {
      const results = await this.db.batch(statements);
      const closing = results[results.length - 1] as { meta: { changes: number } };
      if (closing.meta.changes === 0) return fail('CONFLICT');
    } catch {
      return fail('CONFLICT');
    }

    return { ok: true, tokensG, cashXof, error: null };
  }

  /**
   * Grams still owed at outturn: the refined weight less whatever the advance
   * already delivered in tokens. Never negative — an advance that overshot the
   * assay is a commercial matter, not something to claw back automatically.
   */
  balanceTokens(refinedG: number, advanceTokensG: number | null, producerShare: number): number {
    const due = g(refinedG * producerShare);
    return Math.max(0, g(due - (advanceTokensG ?? 0)));
  }

  /** Create the producer's wallet if needed; returns its id. */
  private async ensureWallet(userId: string): Promise<string | null> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO wallets (id, user_id, token_balance, cash_balance) VALUES (?, ?, 0, 0)`
      )
      .bind(crypto.randomUUID(), userId)
      .run();
    const wallet = await this.db
      .prepare('SELECT id FROM wallets WHERE user_id = ?')
      .bind(userId)
      .first<{ id: string }>();
    return wallet?.id ?? null;
  }
}
