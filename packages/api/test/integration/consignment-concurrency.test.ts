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

function stockIssued(db: TestD1): number {
  const r = db.sqlite.prepare("SELECT tokens_issued FROM gold_stock WHERE id='main'").get() as {
    tokens_issued: number;
  };
  return r.tokens_issued;
}

function producerTokens(db: TestD1, userId: string): number {
  const r = db.sqlite
    .prepare('SELECT token_balance FROM wallets WHERE user_id = ?')
    .get(userId) as { token_balance: number } | undefined;
  return r?.token_balance ?? 0;
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

  it('pays the producer in tokens and counts them as issued', async () => {
    const c = await arrived();

    const r = await svc.auditValidate(c.id, AUDITOR, { refinedWeightG: 900, producerShare: 1 });

    expect(r.ok).toBe(true);
    // 900 g of backing in, 900 g credited to the producer, 900 g issued.
    expect(stockAllocated(db)).toBe(10 + 900);
    expect(producerTokens(db, PRODUCER)).toBe(900);
    expect(stockIssued(db)).toBe(900);
    // The invariant still holds: issued never exceeds allocated.
    expect(stockIssued(db)).toBeLessThanOrEqual(stockAllocated(db));

    const tx = db.sqlite
      .prepare("SELECT * FROM transactions WHERE user_id = ? AND type = 'CONSIGNMENT'")
      .get(PRODUCER) as { token_amount: number; status: string; payment_reference: string };
    expect(tx).toMatchObject({ token_amount: 900, status: 'COMPLETED', payment_reference: c.reference });
  });

  it('leaves the remainder as free stock when the share is below 100%', async () => {
    const c = await arrived();

    const r = await svc.auditValidate(c.id, AUDITOR, { refinedWeightG: 900, producerShare: 0.9 });

    expect(r.ok).toBe(true);
    expect(producerTokens(db, PRODUCER)).toBe(810);
    expect(stockIssued(db)).toBe(810);
    // 90 g of the lot remain unissued — sellable free stock.
    expect(stockAllocated(db) - stockIssued(db)).toBe(10 + 90);
  });

  it('never issues more tokens than the gold backing them, whatever the config says', async () => {
    const c = await arrived();

    // A bad config value must not mint unbacked tokens.
    const r = await svc.auditValidate(c.id, AUDITOR, { refinedWeightG: 900, producerShare: 5 });

    expect(r.ok).toBe(true);
    expect(producerTokens(db, PRODUCER)).toBe(900);
    expect(stockIssued(db)).toBeLessThanOrEqual(stockAllocated(db));
  });

  it('pays nothing on a lost race', async () => {
    const c = await arrived();
    loseRaceAfterRead(svc, db, 'AUDIT_VALIDATED');

    const r = await svc.auditValidate(c.id, AUDITOR, { refinedWeightG: 900, producerShare: 1 });

    expect(r).toMatchObject({ ok: false, error: 'CONFLICT' });
    // No allocation, no payout, no issuance, no transaction.
    expect(stockAllocated(db)).toBe(10);
    expect(producerTokens(db, PRODUCER)).toBe(0);
    expect(stockIssued(db)).toBe(0);
    const count = db.sqlite
      .prepare("SELECT COUNT(*) AS c FROM transactions WHERE type = 'CONSIGNMENT'")
      .get() as { c: number };
    expect(count.c).toBe(0);
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
