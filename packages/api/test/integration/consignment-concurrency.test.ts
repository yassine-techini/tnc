/**
 * Concurrency guarantees of the consignment state machine, against a real SQLite
 * engine with genuine batch (all-or-nothing) semantics.
 *
 * A D1/SQLite UPDATE matching zero rows is NOT an error and does not abort the
 * surrounding batch — so guarding only the status flip left every other write in
 * the batch committing on a lost race. These tests pin the fix: a lost race must
 * be a complete no-op, not a partial commit.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConsignmentService } from '../../src/services/consignment.service';
import { createTestD1, seedStock, type TestD1 } from '../helpers/real-d1';

const asD1 = (db: TestD1) => db as unknown as D1Database;
const PRODUCER = 'prod-1';
const FORWARDER = { id: 'adm-forwarder', role: 'TRANSITAIRE' };
const AUDITOR = { id: 'adm-dubai', role: 'DUBAI_VALIDATOR' };

function stockAllocated(db: TestD1): number {
  const r = db.sqlite.prepare("SELECT total_allocated FROM gold_stock WHERE id='main'").get() as {
    total_allocated: number;
  };
  return r.total_allocated;
}

function countEvents(db: TestD1, consignmentId: string): number {
  const r = db.sqlite
    .prepare('SELECT COUNT(*) AS c FROM consignment_events WHERE consignment_id = ?')
    .get(consignmentId) as { c: number };
  return r.c;
}

/**
 * Simulate losing a race: our request reads `status`, then a concurrent request
 * moves the row on before our batch runs. Patches getById once, exactly at the
 * point where the service takes its decision.
 */
function loseRaceAfterRead(svc: ConsignmentService, db: TestD1, winnerStatus: string): void {
  const realGetById = svc.getById.bind(svc);
  let firstRead = true;
  (svc as unknown as { getById: typeof realGetById }).getById = async (id: string) => {
    const row = await realGetById(id);
    if (firstRead) {
      firstRead = false;
      db.sqlite
        .prepare('UPDATE gold_consignments SET status = ? WHERE id = ?')
        .run(winnerStatus, id);
    }
    return row;
  };
}

describe('Consignment concurrency (real D1)', () => {
  let db: TestD1;
  let svc: ConsignmentService;

  beforeEach(() => {
    db = createTestD1();
    seedStock(db, { totalAllocated: 10, tokensIssued: 0 });
    svc = new ConsignmentService(asD1(db));
  });

  const arrived = async () => {
    const c = await svc.create({
      producerId: PRODUCER,
      weightDeclaredG: 1000,
      purityDeclared: 0.916,
      goldType: 'nuggets',
    });
    await svc.forwarderValidate(c.id, FORWARDER);
    await svc.startTransit(c.id, FORWARDER);
    await svc.arriveDubai(c.id, FORWARDER);
    return c;
  };

  it('auditValidate: a lost race allocates nothing to gold_stock', async () => {
    const c = await arrived();
    loseRaceAfterRead(svc, db, 'AUDIT_VALIDATED');

    const before = stockAllocated(db);
    const eventsBefore = countEvents(db, c.id);

    const r = await svc.auditValidate(c.id, AUDITOR, { refinedWeightG: 900 });

    expect(r).toMatchObject({ ok: false, error: 'CONFLICT' });
    // The whole batch must be a no-op: no allocation, no event, no audit log.
    expect(stockAllocated(db)).toBe(before);
    expect(countEvents(db, c.id)).toBe(eventsBefore);
    const log = db.sqlite
      .prepare(
        "SELECT COUNT(*) AS c FROM audit_logs WHERE entity_id = ? AND action = 'CONSIGNMENT_AUDIT_VALIDATED'"
      )
      .get(c.id) as { c: number };
    expect(log.c).toBe(0);
  });

  it('auditValidate: the happy path still allocates exactly once', async () => {
    const c = await arrived();
    const before = stockAllocated(db);

    const r = await svc.auditValidate(c.id, AUDITOR, { refinedWeightG: 900, refineryLot: 'LOT-1' });

    expect(r.ok).toBe(true);
    expect(stockAllocated(db)).toBe(before + 900);
    const log = db.sqlite
      .prepare(
        "SELECT COUNT(*) AS c FROM audit_logs WHERE entity_id = ? AND action = 'CONSIGNMENT_AUDIT_VALIDATED'"
      )
      .get(c.id) as { c: number };
    expect(log.c).toBe(1);
  });

  it('transition: a lost race records no event and leaves the winner status', async () => {
    const c = await svc.create({
      producerId: PRODUCER,
      weightDeclaredG: 500,
      purityDeclared: 0.916,
      goldType: 'bar',
    });
    await svc.forwarderValidate(c.id, FORWARDER);
    // A concurrent request starts transit; ours tries to reject from the same state.
    loseRaceAfterRead(svc, db, 'IN_TRANSIT');
    const eventsBefore = countEvents(db, c.id);

    const r = await svc.reject(c.id, FORWARDER, 'Pureté non conforme');

    expect(r).toMatchObject({ ok: false, error: 'CONFLICT' });
    // No orphan REJECTED event in the "immutable" trail…
    expect(countEvents(db, c.id)).toBe(eventsBefore);
    // …and the winner's status stands.
    expect((await svc.getById(c.id))!.status).toBe('IN_TRANSIT');
  });
});
