/**
 * Gold lease positions.
 *
 * A holder places grams into a lease instead of holding them idle. The yield is
 * funded by lending the gold out, so opening a position increases
 * `gold_stock.gold_on_loan` — which the reserve attestation discloses and
 * /reserve warns about.
 *
 * THREE RULES, each guarding a way this could go wrong:
 *
 *  1. Leased grams LEAVE the wallet. Left in `token_balance` they could be sold
 *     while already lent out — the double claim this codebase refuses
 *     everywhere else.
 *
 *  2. Yield is XOF, never tokens. A token is a claim on gold; paying yield in
 *     tokens would issue claims with no metal behind them.
 *
 *  3. Accrual is idempotent per day. `lease_accruals` is UNIQUE on
 *     (position, date), so re-running the job cannot pay a day twice.
 */
import { GOLD_STOCK_ID } from './market.service';
import { settlementDate, toIsoDate } from '../lib/business-days';

const g = (n: number) => Math.round(n * 1000) / 1000;
const xof = (n: number) => Math.round(n);

export interface LeaseExitOrderRow {
  id: string;
  position_id: string;
  user_id: string;
  principal_g: number;
  requested_at: string;
  settles_on: string;
  status: 'PENDING' | 'SETTLED' | 'FAILED';
  settled_at: string | null;
  price_per_gram: number | null;
  proceeds_xof: number | null;
  yield_xof: number | null;
  failure_reason: string | null;
}

export interface LeasePositionRow {
  id: string;
  user_id: string;
  wallet_id: string;
  principal_g: number;
  annual_rate: number;
  accrued_xof: number;
  last_accrued_on: string | null;
  status: 'ACTIVE' | 'EXITING' | 'CLOSED';
  opened_at: string;
  closed_at: string | null;
}

export type LeaseError =
  | 'NO_WALLET'
  | 'INSUFFICIENT_BALANCE'
  | 'BELOW_MINIMUM'
  | 'NOT_FOUND'
  | 'NOT_ACTIVE'
  | 'ALREADY_EXITING'
  | 'NO_STOCK_ROW'
  | 'CONFLICT';

export type LeaseResult =
  | { ok: true; position: LeasePositionRow; error: null }
  | { ok: false; position: null; error: LeaseError };

const fail = (error: LeaseError): LeaseResult => ({ ok: false, position: null, error });

export class LeaseService {
  constructor(private db: D1Database) {}

  async getById(id: string): Promise<LeasePositionRow | null> {
    const row = await this.db
      .prepare('SELECT * FROM lease_positions WHERE id = ?')
      .bind(id)
      .first<LeasePositionRow>();
    return row || null;
  }

  async listForUser(userId: string): Promise<LeasePositionRow[]> {
    const rows = await this.db
      .prepare('SELECT * FROM lease_positions WHERE user_id = ? ORDER BY opened_at DESC')
      .bind(userId)
      .all<LeasePositionRow>();
    return rows.results || [];
  }

  /**
   * Open a position: debit the wallet, register the gold as lent, create the
   * position. All guarded on the balance still being sufficient, so a
   * concurrent sale cannot lend gold that has just left.
   */
  async open(userId: string, grams: number, annualRate: number, minimumG: number): Promise<LeaseResult> {
    const amount = g(grams);
    if (!(amount > 0) || amount < minimumG) return fail('BELOW_MINIMUM');

    const wallet = await this.db
      .prepare('SELECT id, token_balance FROM wallets WHERE user_id = ?')
      .bind(userId)
      .first<{ id: string; token_balance: number }>();
    if (!wallet) return fail('NO_WALLET');
    if (wallet.token_balance < amount) return fail('INSUFFICIENT_BALANCE');

    const positionId = crypto.randomUUID();

    try {
      const results = await this.db.batch([
        // Gold leaves the vault. Disclosed by the attestation from here on.
        this.db
          .prepare(
            `UPDATE gold_stock SET gold_on_loan = ROUND(gold_on_loan + ?, 3), updated_at = datetime('now')
             WHERE id = ? AND EXISTS (SELECT 1 FROM wallets WHERE id = ? AND token_balance >= ?)`
          )
          .bind(amount, GOLD_STOCK_ID, wallet.id, amount),
        this.db
          .prepare(
            `INSERT INTO lease_positions (id, user_id, wallet_id, principal_g, annual_rate)
             SELECT ?, ?, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM wallets WHERE id = ? AND token_balance >= ?)`
          )
          .bind(positionId, userId, wallet.id, amount, annualRate, wallet.id, amount),
        this.db
          .prepare(
            `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at)
             SELECT ?, NULL, 'LEASE_OPENED', 'lease_position', ?, ?, datetime('now')
             WHERE EXISTS (SELECT 1 FROM wallets WHERE id = ? AND token_balance >= ?)`
          )
          .bind(
            crypto.randomUUID(), positionId,
            JSON.stringify({ userId, grams: amount, annualRate }),
            wallet.id, amount
          ),
        // Debit LAST and guarded: the balance check above must still hold when
        // this runs, and its `changes` is what the caller decides on.
        this.db
          .prepare(
            `UPDATE wallets SET token_balance = ROUND(token_balance - ?, 3), updated_at = datetime('now')
             WHERE id = ? AND token_balance >= ?`
          )
          .bind(amount, wallet.id, amount),
      ]);

      const debit = results[results.length - 1] as { meta: { changes: number } };
      if (debit.meta.changes === 0) return fail('CONFLICT');
    } catch {
      return fail('CONFLICT');
    }

    const position = await this.getById(positionId);
    return position ? { ok: true, position, error: null } : fail('CONFLICT');
  }

  /**
   * Accrue one day of yield on a position.
   *
   * Actual/365 on the spot value of the principal. The UNIQUE constraint on
   * (position, date) is what makes this safe to re-run: a second attempt for the
   * same day fails the insert rather than paying twice.
   */
  async accrueDay(
    position: LeasePositionRow,
    date: string,
    pricePerGram: number
  ): Promise<{ ok: boolean; amountXof: number }> {
    if (position.status !== 'ACTIVE' || !(pricePerGram > 0)) return { ok: false, amountXof: 0 };

    const amountXof = xof((position.principal_g * pricePerGram * position.annual_rate) / 365);
    if (amountXof <= 0) return { ok: false, amountXof: 0 };

    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO lease_accruals (id, position_id, accrual_date, principal_g, price_per_gram, annual_rate, amount_xof)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            crypto.randomUUID(), position.id, date,
            position.principal_g, pricePerGram, position.annual_rate, amountXof
          ),
        this.db
          .prepare(
            `UPDATE lease_positions
             SET accrued_xof = accrued_xof + ?, last_accrued_on = ?, updated_at = datetime('now')
             WHERE id = ? AND status = 'ACTIVE'`
          )
          .bind(amountXof, date, position.id),
      ]);
      const update = results[results.length - 1] as { meta: { changes: number } };
      if (update.meta.changes === 0) return { ok: false, amountXof: 0 };
    } catch {
      // Duplicate day, or the position closed underneath us.
      return { ok: false, amountXof: 0 };
    }

    return { ok: true, amountXof };
  }

  /** Positions still owed accrual for `date`. */
  async positionsToAccrue(date: string): Promise<LeasePositionRow[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM lease_positions
         WHERE status = 'ACTIVE' AND (last_accrued_on IS NULL OR last_accrued_on < ?)
         ORDER BY opened_at ASC`
      )
      .bind(date)
      .all<LeasePositionRow>();
    return rows.results || [];
  }

  /**
   * Request an exit. The position stops accruing immediately and settles after
   * the recall period — the delay exists because unwinding a loan takes time.
   */
  async requestExit(
    positionId: string,
    userId: string,
    businessDays: number,
    now: Date = new Date(),
    /**
     * Jours feries du pays concerne (ADR 017). Le parametre existait depuis
     * l'origine dans `settlementDate` sans qu'aucun appelant ne le remplisse :
     * un T+3 pouvait echoir un jour ou la contrepartie qui doit rendre l'or est
     * fermee. Vide par defaut — une liste fausse serait pire qu'aucune.
     */
    holidays: string[] = []
  ): Promise<{ ok: boolean; settlesOn: string | null; error: LeaseError | null }> {
    const position = await this.getById(positionId);
    if (!position || position.user_id !== userId) return { ok: false, settlesOn: null, error: 'NOT_FOUND' };
    if (position.status === 'EXITING') return { ok: false, settlesOn: null, error: 'ALREADY_EXITING' };
    if (position.status !== 'ACTIVE') return { ok: false, settlesOn: null, error: 'NOT_ACTIVE' };

    const settlesOn = settlementDate(now, businessDays, holidays);

    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO lease_exit_orders (id, position_id, user_id, principal_g, settles_on)
             SELECT ?, ?, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM lease_positions WHERE id = ? AND status = 'ACTIVE')`
          )
          .bind(crypto.randomUUID(), positionId, userId, position.principal_g, settlesOn, positionId),
        this.db
          .prepare(
            `UPDATE lease_positions SET status = 'EXITING', updated_at = datetime('now')
             WHERE id = ? AND status = 'ACTIVE'`
          )
          .bind(positionId),
      ]);
      const flip = results[results.length - 1] as { meta: { changes: number } };
      if (flip.meta.changes === 0) return { ok: false, settlesOn: null, error: 'CONFLICT' };
    } catch {
      return { ok: false, settlesOn: null, error: 'CONFLICT' };
    }

    return { ok: true, settlesOn, error: null };
  }

  /** Exit orders due for settlement as of `today` and not yet settled. */
  async dueExitOrders(today: Date = new Date()): Promise<LeaseExitOrderRow[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM lease_exit_orders
         WHERE status = 'PENDING' AND settles_on <= ?
         ORDER BY settles_on ASC, requested_at ASC`
      )
      .bind(toIsoDate(today))
      .all<LeaseExitOrderRow>();
    return rows.results || [];
  }

  /**
   * Settle a due exit order: the gold comes back.
   *
   * The exact symmetry of `open()` — principal returns to the wallet,
   * `gold_on_loan` drops by the same amount, `tokens_issued` and
   * `total_allocated` are untouched. The claim existed throughout the lease; the
   * holder never stopped owning the gold, it was simply illiquid. So nothing is
   * created or destroyed here and the reserve invariant holds by construction.
   *
   * The exit RETURNS the metal, it does not sell it — see ADR 004. Selling is an
   * explicit user action going through the KYC limits, the stock check and the
   * quote expiry, none of which a background job should decide on its own.
   *
   * The accrued yield is paid in XOF with its own LEASE_YIELD transaction, so a
   * holder seeing their cash balance rise can find out why.
   *
   * Every statement carries the same `status = 'PENDING'` guard and the order
   * flip goes last: a job run twice settles once.
   */
  async settleExit(
    order: LeaseExitOrderRow,
    pricePerGram: number,
    now: Date = new Date()
  ): Promise<{ ok: boolean; principalG: number; yieldXof: number; error: LeaseError | null }> {
    const nothing = (error: LeaseError) => ({ ok: false, principalG: 0, yieldXof: 0, error });

    const position = await this.getById(order.position_id);
    if (!position) return nothing('NOT_FOUND');
    if (position.status !== 'EXITING') return nothing('NOT_ACTIVE');

    const principalG = g(order.principal_g);
    const yieldXof = xof(position.accrued_xof);
    // Informational only: what the returned principal was worth at settlement,
    // for the position statement. No sale takes place (ADR 004).
    const proceedsXof = xof(principalG * (pricePerGram > 0 ? pricePerGram : 0));
    const settledAt = now.toISOString();
    // Same guard on every statement, bound not interpolated: the order must
    // still be PENDING when each one runs.
    const guard = `EXISTS (SELECT 1 FROM lease_exit_orders WHERE id = ? AND status = 'PENDING')`;

    const statements = [
      // The metal comes back into the vault.
      this.db
        .prepare(
          `UPDATE gold_stock SET gold_on_loan = MAX(0, gold_on_loan - ?), updated_at = datetime('now')
           WHERE id = ? AND ${guard}`
        )
        .bind(principalG, GOLD_STOCK_ID, order.id),
      // ...and the grams become spendable again.
      this.db
        .prepare(
          `UPDATE wallets SET token_balance = ROUND(token_balance + ?, 3), updated_at = datetime('now')
           WHERE id = ? AND ${guard}`
        )
        .bind(principalG, position.wallet_id, order.id),
      this.db
        .prepare(
          `UPDATE lease_positions
           SET status = 'CLOSED', closed_at = ?, updated_at = datetime('now')
           WHERE id = ? AND status = 'EXITING' AND ${guard}`
        )
        .bind(settledAt, position.id, order.id),
      this.db
        .prepare(
          `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at)
           SELECT ?, NULL, 'LEASE_SETTLED', 'lease_position', ?, ?, datetime('now')
           WHERE ${guard}`
        )
        .bind(
          crypto.randomUUID(),
          position.id,
          JSON.stringify({ orderId: order.id, principalG, yieldXof, pricePerGram }),
          order.id
        ),
    ];

    if (yieldXof > 0) {
      statements.push(
        this.db
          .prepare(
            `UPDATE wallets SET cash_balance = cash_balance + ?, updated_at = datetime('now')
             WHERE id = ? AND ${guard}`
          )
          .bind(yieldXof, position.wallet_id, order.id),
        this.db
          .prepare(
            `INSERT INTO transactions (id, user_id, wallet_id, type, status, token_amount, cash_amount, price_per_gram, metadata, created_at, completed_at, currency)
             SELECT ?, ?, ?, 'LEASE_YIELD', 'COMPLETED', NULL, ?, ?, ?, datetime('now'), datetime('now'),
                    (SELECT currency FROM wallets WHERE id = ?)
             WHERE ${guard}`
          )
          .bind(
            crypto.randomUUID(),
            position.user_id,
            position.wallet_id,
            yieldXof,
            pricePerGram > 0 ? pricePerGram : null,
            JSON.stringify({ positionId: position.id, principalG, annualRate: position.annual_rate }),
            position.wallet_id,
            order.id
          )
      );
    }

    // Flip LAST: its `changes` is what decides whether this run settled.
    statements.push(
      this.db
        .prepare(
          `UPDATE lease_exit_orders
           SET status = 'SETTLED', settled_at = ?, price_per_gram = ?, proceeds_xof = ?, yield_xof = ?
           WHERE id = ? AND status = 'PENDING'`
        )
        .bind(settledAt, pricePerGram > 0 ? pricePerGram : null, proceedsXof, yieldXof, order.id)
    );

    try {
      const results = await this.db.batch(statements);
      const flip = results[results.length - 1] as { meta: { changes: number } };
      if (flip.meta.changes === 0) return nothing('CONFLICT');
    } catch {
      return nothing('CONFLICT');
    }

    return { ok: true, principalG, yieldXof, error: null };
  }

  /** Record a settlement failure so a broken order stops being retried blindly. */
  async failExit(orderId: string, reason: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE lease_exit_orders SET status = 'FAILED', failure_reason = ?
         WHERE id = ? AND status = 'PENDING'`
      )
      .bind(reason.slice(0, 500), orderId)
      .run();
  }
}
