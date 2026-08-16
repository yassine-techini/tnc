/**
 * Origin capture on a lot.
 *
 * The distinction that matters for a "certified route": a position measured by
 * a device is evidence, a zone typed by a human is a declaration. Recording
 * both the same way would let a manual entry pass for a GPS reading.
 *
 * These tests also exercise the INSERT itself, which TypeScript cannot check:
 * a mismatch between placeholders and bound values only shows at runtime.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConsignmentService } from '../../src/services/consignment.service';
import { createTestD1, seedStock, type TestD1 } from '../helpers/real-d1';

const asD1 = (db: TestD1) => db as unknown as D1Database;
const PRODUCER = 'prod-1';

const base = {
  producerId: PRODUCER,
  weightDeclaredG: 1000,
  purityDeclared: 0.916,
  goldType: 'nuggets' as const,
};

describe('Consignment origin (real D1)', () => {
  let db: TestD1;
  let svc: ConsignmentService;

  beforeEach(() => {
    db = createTestD1();
    seedStock(db, { totalAllocated: 10, tokensIssued: 0 });
    svc = new ConsignmentService(asD1(db));
  });

  it('records a device fix as verified', async () => {
    const lot = await svc.create({
      ...base,
      gps: { lat: 12.3714, lng: -1.5197 },
      gpsVerified: true,
    });

    expect(lot.origin_gps_lat).toBeCloseTo(12.3714);
    expect(lot.origin_gps_lng).toBeCloseTo(-1.5197);
    expect(lot.origin_verified).toBe(1);
  });

  it('records hand-entered coordinates as NOT verified', async () => {
    // Same shape of data, different provenance. Marking these as verified would
    // be the whole traceability claim quietly undermined.
    const lot = await svc.create({
      ...base,
      gps: { lat: 12.3714, lng: -1.5197 },
      gpsVerified: false,
    });
    expect(lot.origin_gps_lat).toBeCloseTo(12.3714);
    expect(lot.origin_verified).toBe(0);
  });

  it('defaults to not verified when provenance is not stated', async () => {
    const lot = await svc.create({ ...base, gps: { lat: 12.3, lng: -1.5 } });
    expect(lot.origin_verified).toBe(0);
  });

  it('records a declared zone with no coordinates', async () => {
    const lot = await svc.create({ ...base, originZone: 'Site de Bouda, Yatenga' });
    expect(lot.origin_zone).toBe('Site de Bouda, Yatenga');
    expect(lot.origin_gps_lat).toBeNull();
    expect(lot.origin_verified).toBe(0);
  });

  it('never marks an origin verified without a position', async () => {
    // A "verified" flag with nothing measured is meaningless, so it is ignored.
    const lot = await svc.create({ ...base, originZone: 'Zone X', gpsVerified: true });
    expect(lot.origin_verified).toBe(0);
  });

  it('keeps a lot with no origin information at all', async () => {
    const lot = await svc.create(base);
    expect(lot.origin_zone).toBeNull();
    expect(lot.origin_gps_lat).toBeNull();
    expect(lot.origin_verified).toBe(0);
    // And the rest of the row is intact — the INSERT binds line up.
    expect(lot).toMatchObject({ weight_declared_g: 1000, gold_type: 'nuggets', status: 'SUBMITTED' });
  });

  it('stores photos alongside the origin without shifting the columns', async () => {
    // Guards the exact failure this test file exists for: adding columns to the
    // INSERT without adding the matching bind values.
    const lot = await svc.create({
      ...base,
      gps: { lat: 1, lng: 2 },
      gpsVerified: true,
      originZone: 'Zone Y',
      photos: ['consignments/prod-1/a.jpg'],
      estimatedValueXof: 5_000_000,
    });

    expect(JSON.parse(lot.photos!)).toEqual(['consignments/prod-1/a.jpg']);
    expect(lot.estimated_value_xof).toBe(5_000_000);
    expect(lot.origin_zone).toBe('Zone Y');
    expect(lot.origin_verified).toBe(1);
  });
});
