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
  photos: string | null;
  estimated_value_xof: number | null;
  status: ConsignmentStatus;
  forwarder_id: string | null;
  forwarder_validated_at: string | null;
  transit_started_at: string | null;
  arrived_dubai_at: string | null;
  refined_weight_g: number | null;
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
              origin_country, origin_gps_lat, origin_gps_lng, photos, estimated_value_xof, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED')`
        )
        .bind(
          id, reference, p.producerId, p.weightDeclaredG, p.purityDeclared, p.goldType,
          p.originCountry ?? 'BF', p.gps?.lat ?? null, p.gps?.lng ?? null,
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
   * Final audit validation at Dubai. Atomically: mark AUDIT_VALIDATED with the
   * refined weight + LBMA data, record the event, ALLOCATE the refined weight to
   * gold_stock.total_allocated (increasing tokenizable backing), and write an
   * audit log — all in one D1 batch (all-or-nothing).
   */
  async auditValidate(
    id: string,
    admin: { id: string; role: string },
    p: { refinedWeightG?: number; refineryLot?: string; lbmaCertificate?: string }
  ): Promise<TransitionResult> {
    if (!(typeof p.refinedWeightG === 'number' && p.refinedWeightG > 0)) {
      return { ok: false, error: 'INVALID_TRANSITION' };
    }
    const current = await this.getById(id);
    if (!current) return { ok: false, error: 'NOT_FOUND' };
    if (!ALLOWED[current.status].includes('AUDIT_VALIDATED')) {
      return { ok: false, error: 'INVALID_TRANSITION', from: current.status };
    }
    try {
      // Every statement is guarded on status = 'ARRIVED_DUBAI', and the status
      // flip comes LAST — see the concurrency contract on `transition()`. Without
      // this, a lost race still committed the gold_stock allocation while the
      // caller was told CONFLICT, inflating the tokenizable backing with no
      // physical gold behind it.
      const results = await this.db.batch([
        // Allocate refined weight to the tokenizable stock.
        this.db
          .prepare(
            `UPDATE gold_stock SET total_allocated = total_allocated + ?, updated_at = datetime('now')
             WHERE id = ?
               AND EXISTS (SELECT 1 FROM gold_consignments WHERE id = ? AND status = 'ARRIVED_DUBAI')`
          )
          .bind(p.refinedWeightG, GOLD_STOCK_ID, id),
        this.guardedEventStmt(id, current.status, 'AUDIT_VALIDATED', admin.id, admin.role, `Audit validé à Dubaï — ${p.refinedWeightG} g raffinés alloués`, 'ARRIVED_DUBAI'),
        this.db
          .prepare(
            `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at)
             SELECT ?, ?, 'CONSIGNMENT_AUDIT_VALIDATED', 'consignment', ?, ?, datetime('now')
             WHERE EXISTS (SELECT 1 FROM gold_consignments WHERE id = ? AND status = 'ARRIVED_DUBAI')`
          )
          .bind(crypto.randomUUID(), admin.id, id, JSON.stringify({ refinedWeightG: p.refinedWeightG, refineryLot: p.refineryLot, allocatedTo: GOLD_STOCK_ID }), id),
        this.db
          .prepare(
            `UPDATE gold_consignments
             SET status = 'AUDIT_VALIDATED', refined_weight_g = ?, refinery_lot = ?, lbma_certificate = ?,
                 audited_by = ?, audited_at = datetime('now'), updated_at = datetime('now')
             WHERE id = ? AND status = 'ARRIVED_DUBAI'`
          )
          .bind(p.refinedWeightG, p.refineryLot ?? null, p.lbmaCertificate ?? null, admin.id, id),
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
