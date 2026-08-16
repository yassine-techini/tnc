/**
 * Settlement statement assembled from a real lot.
 *
 * The arithmetic is covered by src/lib/settlement-statement.test.ts. What is
 * tested here is that the columns actually written by the consignment flow end
 * up on the document — a statement built from the wrong column reconciles
 * perfectly and is still wrong.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SettlementStatementService, statementFilename } from '../../src/services/settlement-statement.service';
import { ConfigService } from '../../src/services/config.service';
import { createTestD1, type TestD1 } from '../helpers/real-d1';

const asD1 = (db: TestD1) => db as unknown as D1Database;
const LOT = 'lot-1';
const PRODUCER = 'producer-1';

function makeService(db: TestD1) {
  const kv = {
    get: async () => null,
    put: async () => undefined,
    delete: async () => undefined,
  } as unknown as KVNamespace;
  return new SettlementStatementService(asD1(db), new ConfigService(asD1(db), kv));
}

function seedLot(db: TestD1, overrides: Record<string, unknown> = {}) {
  const row = {
    id: LOT,
    reference: 'CONS-AB12CD34',
    producer_id: PRODUCER,
    weight_declared_g: 1000,
    purity_declared: 0.92,
    gold_type: 'nuggets',
    origin_country: 'BF',
    origin_zone: 'Poura',
    origin_verified: 1,
    status: 'AUDIT_VALIDATED',
    forwarder_validated_at: '2026-06-03T10:00:00Z',
    transit_started_at: '2026-06-05T10:00:00Z',
    arrived_dubai_at: '2026-07-02T10:00:00Z',
    refined_weight_g: 910,
    producer_tokens_credited: 289,
    refinery_lot: 'LOT-2026-114',
    lbma_certificate: 'LBMA-88231',
    audited_at: '2026-07-20T10:00:00Z',
    advance_tokens_g: 621,
    advance_paid_at: '2026-07-02T10:00:00Z',
    balance_tokens_g: 289,
    balance_paid_at: '2026-07-20T10:00:00Z',
    ...overrides,
  };
  const cols = Object.keys(row);
  db.sqlite
    .prepare(
      `INSERT INTO gold_consignments (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    )
    .run(...(Object.values(row) as never[]));
}

describe('SettlementStatementService (real D1)', () => {
  let db: TestD1;

  beforeEach(() => {
    db = createTestD1();
  });

  it('reads the advance and balance the consignment flow actually wrote', async () => {
    seedLot(db);
    const input = await makeService(db).inputFor(LOT, new Date('2026-08-16T12:00:00Z'));

    expect(input).toMatchObject({
      reference: 'CONS-AB12CD34',
      declaredWeightG: 1000,
      refinedWeightG: 910,
      advanceTokensG: 621,
      balanceTokensG: 289,
      producerTokensCredited: 289,
      originVerified: true,
      lbmaCertificate: 'LBMA-88231',
    });
  });

  it('names the producer by their legal entity when a profile exists', async () => {
    seedLot(db);
    db.sqlite
      .prepare(
        `INSERT INTO producer_profiles (id, user_id, entity_type, legal_name, representative_name)
         VALUES ('p1', ?, 'COOPERATIVE', 'Coopérative de Poura', 'A. Ouédraogo')`
      )
      .run(PRODUCER);

    const input = await makeService(db).inputFor(LOT);
    expect(input!.producerName).toBe('Coopérative de Poura');
  });

  it('still produces a statement for a producer with no profile row', async () => {
    seedLot(db);
    // A lot must remain documentable even if the KYB record is missing.
    const input = await makeService(db).inputFor(LOT);
    expect(input!.producerName).toBe(PRODUCER);
  });

  it('applies the share in force rather than assuming 100 %', async () => {
    seedLot(db);
    db.sqlite
      .prepare("INSERT INTO config (key, value) VALUES ('consignment_producer_share', '0.95')")
      .run();

    const input = await makeService(db).inputFor(LOT);
    expect(input!.producerShare).toBe(0.95);
  });

  it('returns null for a lot that does not exist', async () => {
    expect(await makeService(db).inputFor('nope')).toBeNull();
    expect(await makeService(db).pdfFor('nope')).toBeNull();
  });

  it('renders a downloadable PDF named after the lot', async () => {
    seedLot(db);
    const pdf = await makeService(db).pdfFor(LOT);

    expect(pdf).not.toBeNull();
    expect(new TextDecoder().decode(pdf!.slice(0, 8))).toContain('%PDF-1.4');
    expect(statementFilename('CONS-AB12CD34')).toBe('releve-reglement-CONS-AB12CD34.pdf');
  });

  it('documents a lot still in transit instead of refusing', async () => {
    seedLot(db, {
      status: 'IN_TRANSIT',
      refined_weight_g: null,
      producer_tokens_credited: null,
      audited_at: null,
      balance_tokens_g: null,
      balance_paid_at: null,
      advance_tokens_g: null,
      advance_paid_at: null,
      refinery_lot: null,
      lbma_certificate: null,
    });

    const pdf = await makeService(db).pdfFor(LOT);
    expect(pdf).not.toBeNull();
    expect(pdf!.byteLength).toBeGreaterThan(1000);
  });
});
