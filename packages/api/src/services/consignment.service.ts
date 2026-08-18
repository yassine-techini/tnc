/**
 * Consignment Service — the physical gold export workflow.
 *
 * A producer submits a gold lot (consignment). A transitaire (freight forwarder)
 * validates the operation; transport is tracked; and a separate audit validation
 * at Dubai atomically allocates the refined weight to gold_stock (the tokenizable
 * backing). Every status transition is recorded in consignment_events.
 */
import { GOLD_STOCK_ID } from './market.service';

export type ConsignmentStatus =
  | 'SUBMITTED'
  | 'FORWARDER_VALIDATED'
  | 'IN_TRANSIT'
  | 'ARRIVED_DUBAI'
  | 'AUDIT_VALIDATED'
  | 'REJECTED';

export type GoldType = 'nuggets' | 'powder' | 'bar';

export interface ConsignmentRow {
  id: string;
  reference: string;
  producer_id: string;
  weight_declared_g: number;
  purity_declared: number;
  gold_type: GoldType;
  origin_country: string | null;
  origin_gps_lat: number | null;
  origin_gps_lng: number | null;
  origin_zone: string | null;
  /** 1 when the position came from a device fix, 0 when declared. */
  origin_verified: number;
  photos: string | null;
  estimated_value_xof: number | null;
  status: ConsignmentStatus;
  forwarder_id: string | null;
  forwarder_validated_at: string | null;
  transit_started_at: string | null;
  arrived_dubai_at: string | null;
  refined_weight_g: number | null;
  /** Grams credited to the producer at audit validation (see migration 0020). */
  producer_tokens_credited: number | null;
  /** Advance already delivered in tokens at Dubai arrival (0027). */
  advance_tokens_g: number | null;
  advance_cash_xof: number | null;
  advance_paid_at: string | null;
  /** Rate the cash advance was computed at, kept for the settlement statement. */
  advance_price_per_gram: number | null;
  balance_tokens_g: number | null;
  balance_cash_xof: number | null;
  balance_paid_at: string | null;
  refinery_lot: string | null;
  lbma_certificate: string | null;
  audited_by: string | null;
  audited_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConsignmentEventRow {
  id: string;
  consignment_id: string;
  from_status: string | null;
  to_status: string;
  actor_id: string | null;
  actor_role: string | null;
  note: string | null;
  created_at: string;
}

// Allowed forward transitions of the state machine.
const ALLOWED: Record<ConsignmentStatus, ConsignmentStatus[]> = {
  SUBMITTED: ['FORWARDER_VALIDATED', 'REJECTED'],
  FORWARDER_VALIDATED: ['IN_TRANSIT', 'REJECTED'],
  IN_TRANSIT: ['ARRIVED_DUBAI', 'REJECTED'],
  ARRIVED_DUBAI: ['AUDIT_VALIDATED', 'REJECTED'],
  AUDIT_VALIDATED: [],
  REJECTED: [],
};

export type TransitionResult =
  | { ok: true; consignment: ConsignmentRow }
  | { ok: false; error: 'NOT_FOUND' | 'INVALID_TRANSITION' | 'CONFLICT'; from?: ConsignmentStatus };

export class ConsignmentService {
  constructor(private db: D1Database) {}

  private shortRef(): string {
    return 'CONS-' + crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  }

  async create(p: {
    producerId: string;
    weightDeclaredG: number;
    purityDeclared: number;
    goldType: GoldType;
    originCountry?: string;
    gps?: { lat: number; lng: number } | null;
    /** True only when the position came from a device fix, never from typing. */
    gpsVerified?: boolean;
    originZone?: string | null;
    photos?: string[];
    estimatedValueXof?: number | null;
  }): Promise<ConsignmentRow> {
    const id = crypto.randomUUID();
    const reference = this.shortRef();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO gold_consignments
             (id, reference, producer_id, weight_declared_g, purity_declared, gold_type,
              origin_country, origin_gps_lat, origin_gps_lng, origin_zone, origin_verified,
              photos, estimated_value_xof, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED')`
        )
        .bind(
          id, reference, p.producerId, p.weightDeclaredG, p.purityDeclared, p.goldType,
          p.originCountry ?? 'BF', p.gps?.lat ?? null, p.gps?.lng ?? null,
          p.originZone ?? null,
          // Verified only when a position was actually measured. A declared zone,
          // or coordinates typed by hand, are never recorded as evidence.
          p.gps && p.gpsVerified ? 1 : 0,
          p.photos ? JSON.stringify(p.photos) : null, p.estimatedValueXof ?? null
        ),
      this.eventStmt(id, null, 'SUBMITTED', p.producerId, 'producer', 'Lot soumis par le producteur'),
    ]);
    const row = await this.getById(id);
    if (!row) throw new Error('Failed to create consignment');
    return row;
  }

  private eventStmt(
    consignmentId: string,
    from: string | null,
    to: string,
    actorId: string | null,
    actorRole: string | null,
    note: string | null
  ) {
    return this.db
      .prepare(
        `INSERT INTO consignment_events (id, consignment_id, from_status, to_status, actor_id, actor_role, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(crypto.randomUUID(), consignmentId, from, to, actorId, actorRole, note);
  }

  /**
   * Same as eventStmt, but the row is only written if the consignment is STILL
   * in `expectedStatus`. See the concurrency contract on `transition()`.
   */
  private guardedEventStmt(
    consignmentId: string,
    from: string | null,
    to: string,
    actorId: string | null,
    actorRole: string | null,
    note: string | null,
    expectedStatus: ConsignmentStatus
  ) {
    return this.db
      .prepare(
        `INSERT INTO consignment_events (id, consignment_id, from_status, to_status, actor_id, actor_role, note)
         SELECT ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM gold_consignments WHERE id = ? AND status = ?)`
      )
      .bind(
        crypto.randomUUID(), consignmentId, from, to, actorId, actorRole, note,
        consignmentId, expectedStatus
      );
  }

  async getById(id: string): Promise<ConsignmentRow | null> {
    const row = await this.db.prepare('SELECT * FROM gold_consignments WHERE id = ?').bind(id).first<ConsignmentRow>();
    return row || null;
  }

  async listByProducer(producerId: string, limit = 50, offset = 0): Promise<{ items: ConsignmentRow[]; total: number }> {
    const count = await this.db
      .prepare('SELECT COUNT(*) as c FROM gold_consignments WHERE producer_id = ?')
      .bind(producerId)
      .first<{ c: number }>();
    const rows = await this.db
      .prepare('SELECT * FROM gold_consignments WHERE producer_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .bind(producerId, limit, offset)
      .all<ConsignmentRow>();
    return { items: rows.results || [], total: count?.c || 0 };
  }

  async listAll(opts: { status?: string; limit?: number; offset?: number } = {}): Promise<{ items: ConsignmentRow[]; total: number }> {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const where = opts.status ? 'WHERE status = ?' : '';
    const binds = opts.status ? [opts.status] : [];
    const count = await this.db.prepare(`SELECT COUNT(*) as c FROM gold_consignments ${where}`).bind(...binds).first<{ c: number }>();
    const rows = await this.db
      .prepare(`SELECT * FROM gold_consignments ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .bind(...binds, limit, offset)
      .all<ConsignmentRow>();
    return { items: rows.results || [], total: count?.c || 0 };
  }

  async listEvents(consignmentId: string): Promise<ConsignmentEventRow[]> {
    const rows = await this.db
      .prepare('SELECT * FROM consignment_events WHERE consignment_id = ? ORDER BY created_at ASC')
      .bind(consignmentId)
      .all<ConsignmentEventRow>();
    return rows.results || [];
  }

  /**
   * Generic guarded transition that sets extra columns and records an event.
   *
   * CONCURRENCY CONTRACT — read before adding a statement to any batch here.
   * A D1/SQLite UPDATE that matches zero rows is NOT an error: it does not abort
   * the surrounding batch. So a guard on ONE statement protects only that
   * statement; every other write in the batch would still commit if a concurrent
   * request won the race. The rule is therefore:
   *
   *   1. EVERY statement in the batch carries the same `status = <observed>` guard.
   *   2. The statement that flips `status` goes LAST, so the earlier ones still
   *      observe the pre-transition status.
   *   3. The caller decides on `meta.changes` of that last statement.
   *
   * A lost race then degrades to a batch of no-ops, and the caller gets CONFLICT.
   */
  private async transition(
    id: string,
    to: ConsignmentStatus,
    actor: { id: string; role: string },
    extraSql: string,
    extraBinds: unknown[],
    note: string
  ): Promise<TransitionResult> {
    const current = await this.getById(id);
    if (!current) return { ok: false, error: 'NOT_FOUND' };
    if (!ALLOWED[current.status].includes(to)) {
      return { ok: false, error: 'INVALID_TRANSITION', from: current.status };
    }
    const results = await this.db.batch([
      this.guardedEventStmt(id, current.status, to, actor.id, actor.role, note, current.status),
      // Status flip last — the guarded event above must still see the old status.
      this.db
        .prepare(
          `UPDATE gold_consignments SET status = ?${extraSql ? ', ' + extraSql : ''}, updated_at = datetime('now')
           WHERE id = ? AND status = ?`
        )
        .bind(to, ...extraBinds, id, current.status),
    ]);
    const flip = results[results.length - 1] as { meta: { changes: number } };
    if (flip.meta.changes === 0) return { ok: false, error: 'CONFLICT', from: current.status };
    const updated = await this.getById(id);
    return { ok: true, consignment: updated! };
  }

  forwarderValidate(id: string, admin: { id: string; role: string }, note?: string): Promise<TransitionResult> {
    return this.transition(id, 'FORWARDER_VALIDATED', admin, 'forwarder_id = ?, forwarder_validated_at = datetime(\'now\')', [admin.id], note ?? 'Opération validée par le transitaire');
  }

  startTransit(id: string, admin: { id: string; role: string }, note?: string): Promise<TransitionResult> {
    return this.transition(id, 'IN_TRANSIT', admin, 'transit_started_at = datetime(\'now\')', [], note ?? 'Transport démarré');
  }

  arriveDubai(id: string, admin: { id: string; role: string }, note?: string): Promise<TransitionResult> {
    return this.transition(id, 'ARRIVED_DUBAI', admin, 'arrived_dubai_at = datetime(\'now\')', [], note ?? 'Marchandise arrivée à Dubaï');
  }

  reject(id: string, admin: { id: string; role: string }, reason: string): Promise<TransitionResult> {
    return this.transition(id, 'REJECTED', admin, 'rejection_reason = ?', [reason], reason);
  }

  /**
   * Final audit validation at Dubai. Atomically, in one D1 batch:
   *   - mark AUDIT_VALIDATED with the refined weight + LBMA data,
   *   - ALLOCATE the refined weight to gold_stock.total_allocated (backing in),
   *   - PAY THE PRODUCER in tokens (1 token = 1 g of refined gold) and count
   *     those tokens as issued,
   *   - record the event and an audit log.
   *
   * The producer is paid in grams, not XOF, so no gold price or valuation date
   * has to be fixed for a lot. `producerShare` (0..1) is the fraction of the
   * refined weight credited to him; the remainder stays as free sellable stock.
   *
   * gold_stock is updated in a SINGLE statement so the
   * `tokens_issued <= total_allocated` CHECK is never transiently violated.
   */
  async auditValidate(
    id: string,
    admin: { id: string; role: string },
    p: {
      refinedWeightG?: number;
      refineryLot?: string;
      lbmaCertificate?: string;
      producerShare?: number;
    }
  ): Promise<TransitionResult> {
    if (!(typeof p.refinedWeightG === 'number' && p.refinedWeightG > 0)) {
      return { ok: false, error: 'INVALID_TRANSITION' };
    }
    const current = await this.getById(id);
    if (!current) return { ok: false, error: 'NOT_FOUND' };
    if (!ALLOWED[current.status].includes('AUDIT_VALIDATED')) {
      return { ok: false, error: 'INVALID_TRANSITION', from: current.status };
    }

    // Clamp defensively: a bad config value must never issue more tokens than
    // the gold that backs them.
    const share = Math.min(1, Math.max(0, typeof p.producerShare === 'number' ? p.producerShare : 1));
    // Token balances are grams at 0.001 precision.
    const due = Math.round(p.refinedWeightG * share * 1000) / 1000;

    // Only the BALANCE is paid here: a token advance at Dubai arrival already
    // delivered part of it, and already allocated its own weight. Paying `due`
    // again would credit the producer twice and inflate the reserve.
    const advanceTokens = current.advance_tokens_g ?? 0;
    const producerTokens = Math.max(0, Math.round((due - advanceTokens) * 1000) / 1000);

    // The advance allocated its share at arrival, so only the remainder of the
    // refined weight is allocated now.
    //
    // DELIBERATELY SIGNED, unlike `producerTokens` above. When the assay comes
    // in UNDER the advance, the advance allocated gold that refining never
    // confirmed — 621 g claimed as backing for a lot that yielded 500. Clamping
    // this at zero left that 121 g phantom in `total_allocated`, so the public
    // reserve overstated the physical gold and the invariant held only because
    // the advance had inflated both sides of it.
    //
    // Letting it go negative de-allocates the phantom. The producer keeps the
    // advance — no clawback, that is the commercial decision — so the shortfall
    // must be covered by the platform's own free stock. If there is none, the
    // `tokens_issued <= total_allocated` CHECK aborts the batch and the audit is
    // refused: claims that cannot be backed are not issued (ADR 006).
    const allocateG = Math.round((p.refinedWeightG - advanceTokens) * 1000) / 1000;

    // The producer may never have transacted, so his wallet may not exist yet.
    // Idempotent, and outside the batch: a spare empty wallet is harmless, while
    // a failed payout is not.
    let producerWalletId: string | null = null;
    if (producerTokens > 0) {
      await this.db
        .prepare(
          `INSERT OR IGNORE INTO wallets (id, user_id, token_balance, cash_balance) VALUES (?, ?, 0, 0)`
        )
        .bind(crypto.randomUUID(), current.producer_id)
        .run();
      const wallet = await this.db
        .prepare('SELECT id FROM wallets WHERE user_id = ?')
        .bind(current.producer_id)
        .first<{ id: string }>();
      if (!wallet) return { ok: false, error: 'CONFLICT', from: current.status };
      producerWalletId = wallet.id;
    }

    try {
      // Every statement is guarded on status = 'ARRIVED_DUBAI', and the status
      // flip comes LAST — see the concurrency contract on `transition()`. Without
      // this, a lost race still committed the gold_stock allocation while the
      // caller was told CONFLICT, inflating the tokenizable backing with no
      // physical gold behind it.
      const results = await this.db.batch([
        // Allocate the refined weight to the tokenizable stock, and count the
        // producer's tokens as issued — one statement, so the invariant holds.
        this.db
          .prepare(
            `UPDATE gold_stock
             SET total_allocated = ROUND(total_allocated + ?, 3),
                 tokens_issued = ROUND(tokens_issued + ?, 3),
                 updated_at = datetime('now')
             WHERE id = ?
               AND EXISTS (SELECT 1 FROM gold_consignments WHERE id = ? AND status = 'ARRIVED_DUBAI')`
          )
          .bind(allocateG, producerTokens, GOLD_STOCK_ID, id),
        // Pay the producer in tokens.
        ...(producerTokens > 0
          ? [
              this.db
                .prepare(
                  `UPDATE wallets SET token_balance = ROUND(token_balance + ?, 3), updated_at = datetime('now')
                   WHERE id = ?
                     AND EXISTS (SELECT 1 FROM gold_consignments WHERE id = ? AND status = 'ARRIVED_DUBAI')`
                )
                .bind(producerTokens, producerWalletId, id),
              this.db
                .prepare(
                  `INSERT INTO transactions
                     (id, user_id, wallet_id, type, status, token_amount, cash_amount, fees, payment_reference, completed_at)
                   SELECT ?, ?, ?, 'CONSIGNMENT', 'COMPLETED', ?, 0, 0, ?, datetime('now')
                   WHERE EXISTS (SELECT 1 FROM gold_consignments WHERE id = ? AND status = 'ARRIVED_DUBAI')`
                )
                .bind(crypto.randomUUID(), current.producer_id, producerWalletId, producerTokens, current.reference, id),
            ]
          : []),
        this.guardedEventStmt(id, current.status, 'AUDIT_VALIDATED', admin.id, admin.role, `Audit validé à Dubaï — ${p.refinedWeightG} g raffinés, ${producerTokens} g crédités au producteur`, 'ARRIVED_DUBAI'),
        this.db
          .prepare(
            `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at)
             SELECT ?, ?, 'CONSIGNMENT_AUDIT_VALIDATED', 'consignment', ?, ?, datetime('now')
             WHERE EXISTS (SELECT 1 FROM gold_consignments WHERE id = ? AND status = 'ARRIVED_DUBAI')`
          )
          .bind(crypto.randomUUID(), admin.id, id, JSON.stringify({ refinedWeightG: p.refinedWeightG, refineryLot: p.refineryLot, allocatedTo: GOLD_STOCK_ID, producerShare: share, producerTokens, producerId: current.producer_id }), id),
        this.db
          .prepare(
            `UPDATE gold_consignments
             SET status = 'AUDIT_VALIDATED', refined_weight_g = ?, refinery_lot = ?, lbma_certificate = ?,
                 producer_tokens_credited = ?, balance_tokens_g = ?, audited_by = ?, audited_at = datetime('now'),
                 updated_at = datetime('now')
             WHERE id = ? AND status = 'ARRIVED_DUBAI'`
          )
          .bind(p.refinedWeightG, p.refineryLot ?? null, p.lbmaCertificate ?? null, producerTokens, producerTokens, admin.id, id),
      ]);
      // The guarded consignment UPDATE must have changed exactly one row.
      const consignmentUpdate = results[results.length - 1] as { meta: { changes: number } };
      if (consignmentUpdate.meta.changes === 0) {
        return { ok: false, error: 'CONFLICT', from: current.status };
      }
    } catch {
      return { ok: false, error: 'CONFLICT', from: current.status };
    }
    const updated = await this.getById(id);
    return { ok: true, consignment: updated! };
  }
}
