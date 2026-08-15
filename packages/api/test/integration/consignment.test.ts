/**
 * Integration tests for the gold consignment (export) workflow against a real
 * SQLite engine that enforces the state-machine CHECK constraints and gives the
 * audit-validation allocation genuine atomic (batch) semantics.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConsignmentService } from '../../src/services/consignment.service';
import { createTestD1, seedStock, type TestD1 } from '../helpers/real-d1';

const asD1 = (db: TestD1) => db as unknown as D1Database;
const PRODUCER = 'prod-1';
const FORWARDER = { id: 'adm-forwarder', role: 'TRANSITAIRE' };
const AUDITOR = { id: 'adm-dubai', role: 'DUBAI_VALIDATOR' };

function stockAllocated(db: TestD1): number {
  const r = db.sqlite.prepare("SELECT total_allocated FROM gold_stock WHERE id='main'").get() as { total_allocated: number };
  return r.total_allocated;
}

describe('Consignment workflow (real D1)', () => {
  let db: TestD1;
  let svc: ConsignmentService;

  beforeEach(() => {
    db = createTestD1();
    seedStock(db, { totalAllocated: 10, tokensIssued: 0 });
    svc = new ConsignmentService(asD1(db));
  });

  const create = () =>
    svc.create({ producerId: PRODUCER, weightDeclaredG: 1000, purityDeclared: 0.916, goldType: 'nuggets', photos: ['a.jpg', 'b.jpg'] });

  it('creates a SUBMITTED consignment with a reference and an initial event', async () => {
    const c = await create();
    expect(c.status).toBe('SUBMITTED');
    expect(c.reference).toMatch(/^CONS-[0-9A-F]{8}$/);
    expect(c.producer_id).toBe(PRODUCER);
    const events = await svc.listEvents(c.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ to_status: 'SUBMITTED', actor_role: 'producer' });
  });

  it('walks the full happy path and allocates the refined weight to stock at audit', async () => {
    const c = await create();

    expect((await svc.forwarderValidate(c.id, FORWARDER)).ok).toBe(true);
    expect((await svc.startTransit(c.id, FORWARDER)).ok).toBe(true);
    expect((await svc.arriveDubai(c.id, FORWARDER)).ok).toBe(true);

    const before = stockAllocated(db);
    const r = await svc.auditValidate(c.id, AUDITOR, { refinedWeightG: 900, refineryLot: 'LOT-1', lbmaCertificate: 'LBMA-XYZ' });
    expect(r.ok).toBe(true);

    const final = await svc.getById(c.id);
    expect(final!.status).toBe('AUDIT_VALIDATED');
    expect(final!.refined_weight_g).toBe(900);
    expect(final!.audited_by).toBe(AUDITOR.id);
    // Allocation happened atomically: stock grew by the refined weight.
    expect(stockAllocated(db)).toBe(before + 900);
    // Audit log written.
    const log = db.sqlite.prepare("SELECT * FROM audit_logs WHERE entity_id = ? AND action='CONSIGNMENT_AUDIT_VALIDATED'").get(c.id);
    expect(log).toBeTruthy();
    // Full event trail.
    const events = await svc.listEvents(c.id);
    expect(events.map((e) => e.to_status)).toEqual(['SUBMITTED', 'FORWARDER_VALIDATED', 'IN_TRANSIT', 'ARRIVED_DUBAI', 'AUDIT_VALIDATED']);
  });

  it('rejects an invalid transition (skip steps)', async () => {
    const c = await create();
    const r = await svc.arriveDubai(c.id, FORWARDER);
    expect(r).toMatchObject({ ok: false, error: 'INVALID_TRANSITION', from: 'SUBMITTED' });
    // Nothing changed.
    expect((await svc.getById(c.id))!.status).toBe('SUBMITTED');
  });

  it('does not allocate stock when audit is attempted before Dubai arrival', async () => {
    const c = await create();
    await svc.forwarderValidate(c.id, FORWARDER);
    const before = stockAllocated(db);
    const r = await svc.auditValidate(c.id, AUDITOR, { refinedWeightG: 900 });
    expect(r.ok).toBe(false);
    expect(stockAllocated(db)).toBe(before); // no allocation
  });

  it('rejects a consignment with a reason', async () => {
    const c = await create();
    const r = await svc.reject(c.id, FORWARDER, 'Pureté non conforme');
    expect(r.ok).toBe(true);
    const final = await svc.getById(c.id);
    expect(final!.status).toBe('REJECTED');
    expect(final!.rejection_reason).toBe('Pureté non conforme');
  });

  it('lists a producer own consignments', async () => {
    await create();
    await create();
    const { items, total } = await svc.listByProducer(PRODUCER);
    expect(total).toBe(2);
    expect(items).toHaveLength(2);
  });
});
