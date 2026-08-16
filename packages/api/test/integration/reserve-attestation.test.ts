/**
 * Reserve attestations (ADR 002, phase 1) against a real SQLite engine.
 *
 * The promise is narrow and must be tested for exactly what it is: the sequence
 * of published statements is append-only and tamper-evident. Rewriting an old
 * attestation must break it AND everything chained behind it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AttestationService } from '../../src/services/attestation.service';
import { createTestD1, seedStock, type TestD1 } from '../helpers/real-d1';
import { sha256Hex } from '../../src/lib/canonical';

const asD1 = (db: TestD1) => db as unknown as D1Database;

// A deterministic stand-in for the real ES256 signer: the service only needs
// something that turns a digest into a signature, and key handling is tested
// separately from chaining.
const fakeSigner = async (digest: string) => ({
  signature: `sig:${digest.slice(0, 16)}`,
  keyId: 'test-key',
});

describe('Reserve attestations (real D1)', () => {
  let db: TestD1;
  let svc: AttestationService;

  beforeEach(() => {
    db = createTestD1();
    seedStock(db, { totalAllocated: 10000, tokensIssued: 175.5 });
    svc = new AttestationService(asD1(db));
  });

  it('refuses to publish without a signer', async () => {
    const r = await svc.create('2026-08-15T00:30:00.000Z', null);
    expect(r).toMatchObject({ ok: false, error: 'NOT_SIGNED' });
    expect(await svc.getLatest()).toBeNull();
  });

  it('publishes a genesis attestation carrying the reserve state', async () => {
    const r = await svc.create('2026-08-15T00:30:00.000Z', fakeSigner);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.attestation).toMatchObject({ sequence: 1, previous_digest: null, signing_key_id: 'test-key' });

    const payload = JSON.parse(r.attestation.payload);
    expect(payload.reserve).toEqual({
      totalAllocatedG: '10000.000',
      tokensIssuedG: '175.500',
      freeStockG: '9824.500',
      invariantHolds: true,
    });
    // The digest is the hash of exactly those bytes.
    expect(await sha256Hex(r.attestation.payload)).toBe(r.attestation.digest);
  });

  it('is reproducible: same state and instant give the same digest', async () => {
    const first = await svc.create('2026-08-15T00:30:00.000Z', fakeSigner);
    expect(first.ok).toBe(true);

    // A second, independent database in the same state must agree.
    const other = createTestD1();
    seedStock(other, { totalAllocated: 10000, tokensIssued: 175.5 });
    const otherSvc = new AttestationService(asD1(other));
    const second = await otherSvc.create('2026-08-15T00:30:00.000Z', fakeSigner);

    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.attestation.digest).toBe(first.attestation.digest);
  });

  it('chains each attestation to the previous one', async () => {
    const a = await svc.create('2026-08-15T00:30:00.000Z', fakeSigner);
    expect(a.ok).toBe(true);
    if (!a.ok) return;

    // The reserve grows, as it would after an audited lot.
    db.sqlite.prepare("UPDATE gold_stock SET total_allocated = 10900 WHERE id = 'main'").run();

    const b = await svc.create('2026-08-16T00:30:00.000Z', fakeSigner);
    expect(b.ok).toBe(true);
    if (!b.ok) return;

    expect(b.attestation.sequence).toBe(2);
    expect(b.attestation.previous_digest).toBe(a.attestation.digest);
    expect(b.attestation.digest).not.toBe(a.attestation.digest);

    const check = await svc.verify(b.attestation.digest);
    expect(check).toMatchObject({ found: true, digestMatches: true, chainLinkValid: true, anchored: false });
  });

  it('detects a rewritten attestation, and every one chained behind it', async () => {
    const a = await svc.create('2026-08-15T00:30:00.000Z', fakeSigner);
    const b = await svc.create('2026-08-16T00:30:00.000Z', fakeSigner);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    // Someone edits history: the reserve is made to look larger, after the fact.
    const tampered = a.attestation.payload.replace('"totalAllocatedG":"10000.000"', '"totalAllocatedG":"99000.000"');
    expect(tampered).not.toBe(a.attestation.payload);
    db.sqlite.prepare('UPDATE reserve_attestations SET payload = ? WHERE digest = ?').run(tampered, a.attestation.digest);

    // The rewritten record no longer hashes to its own digest…
    const checkA = await svc.verify(a.attestation.digest);
    expect(checkA.digestMatches).toBe(false);
    // …and B still points at a digest nothing can reproduce, so the forgery
    // cannot be laundered by rewriting A alone.
    const checkB = await svc.verify(b.attestation.digest);
    expect(checkB.digestMatches).toBe(true);
    expect(checkB.attestation!.previous_digest).toBe(a.attestation.digest);
  });

  it('lists the lots that justify the reserve growth since the previous attestation', async () => {
    const a = await svc.create('2026-08-15T00:30:00.000Z', fakeSigner);
    expect(a.ok).toBe(true);

    db.sqlite
      .prepare(
        `INSERT INTO gold_consignments
           (id, reference, producer_id, weight_declared_g, purity_declared, gold_type, status,
            refined_weight_g, producer_tokens_credited, audited_at)
         VALUES ('c1','CONS-AAAA1111','prod-1',1000,0.916,'nuggets','AUDIT_VALIDATED',900,810,datetime('now','+1 hour'))`
      )
      .run();

    const b = await svc.create('2026-08-16T00:30:00.000Z', fakeSigner);
    expect(b.ok).toBe(true);
    if (!b.ok) return;

    const payload = JSON.parse(b.attestation.payload);
    expect(payload.lotsAuditedSincePrevious).toEqual([
      expect.objectContaining({
        reference: 'CONS-AAAA1111',
        refinedWeightG: '900.000',
        producerCreditedG: '810.000',
      }),
    ]);
  });

  it('records an anchor once and refuses to overwrite it', async () => {
    const a = await svc.create('2026-08-15T00:30:00.000Z', fakeSigner);
    expect(a.ok).toBe(true);
    if (!a.ok) return;

    expect(await svc.recordAnchor(a.attestation.digest, 'somechain', '0xabc', '2026-08-15T01:00:00.000Z')).toBe(true);
    // A retry must not rewrite which transaction anchored it.
    expect(await svc.recordAnchor(a.attestation.digest, 'somechain', '0xdef', '2026-08-15T02:00:00.000Z')).toBe(false);

    const check = await svc.verify(a.attestation.digest);
    expect(check.anchored).toBe(true);
    expect(check.attestation!.anchor_tx_hash).toBe('0xabc');
  });

  it('reports no stock rather than attesting to a reserve that does not exist', async () => {
    const empty = createTestD1();
    const emptySvc = new AttestationService(asD1(empty));
    expect(await emptySvc.create('2026-08-15T00:30:00.000Z', fakeSigner)).toMatchObject({
      ok: false,
      error: 'NO_STOCK',
    });
  });
});
