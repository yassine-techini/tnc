/**
 * Producer KYB against a real SQLite engine.
 *
 * Approving a KYB grants a KYC level, which is what lets a producer consign a
 * lot and sell the tokens it pays. That grant and the status change must be
 * all-or-nothing: a lost race must not leave a producer holding a level nobody
 * decided to give.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ProducerProfileService } from '../../src/services/producer-profile.service';
import { createTestD1, type TestD1 } from '../helpers/real-d1';

const asD1 = (db: TestD1) => db as unknown as D1Database;
const REVIEWER = { id: 'adm-kyc' };
const USER = 'user-coop-1';

function kycLevel(db: TestD1, userId: string): string {
  const r = db.sqlite.prepare('SELECT kyc_level FROM users WHERE id = ?').get(userId) as
    | { kyc_level: string }
    | undefined;
  return r?.kyc_level ?? 'MISSING';
}

const COOP = {
  entityType: 'COOPERATIVE' as const,
  legalName: 'Coopérative Minière du Sanmatenga',
  registrationNumber: 'BF-OUA-2026-B-1234',
  miningAuthorization: 'AUT-ART-2026-77',
  representativeName: 'Awa Ouédraogo',
  representativeRole: 'Gérante',
};

describe('Producer KYB (real D1)', () => {
  let db: TestD1;
  let svc: ProducerProfileService;

  beforeEach(() => {
    db = createTestD1();
    db.sqlite
      .prepare("INSERT INTO users (id, email, kyc_level, kyc_status) VALUES (?, ?, 'BASIC', 'PENDING')")
      .run(USER, 'coop@example.bf');
    svc = new ProducerProfileService(asD1(db));
  });

  it('submits a cooperative dossier as SUBMITTED', async () => {
    const p = await svc.submit(USER, COOP);
    expect(p).toMatchObject({
      status: 'SUBMITTED',
      entity_type: 'COOPERATIVE',
      legal_name: COOP.legalName,
      registration_number: COOP.registrationNumber,
    });
    // Submitting alone grants nothing.
    expect(kycLevel(db, USER)).toBe('BASIC');
  });

  it('approving grants the KYC level that makes selling possible', async () => {
    const p = await svc.submit(USER, COOP);
    const r = await svc.approve(p!.id, REVIEWER, 'STANDARD');

    expect(r.ok).toBe(true);
    expect((await svc.getById(p!.id))!.status).toBe('VERIFIED');
    // BASIC cannot sell, so a producer stuck there could never be paid.
    expect(kycLevel(db, USER)).toBe('STANDARD');
    const log = db.sqlite
      .prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'PRODUCER_KYB_APPROVED' AND entity_id = ?")
      .get(p!.id) as { c: number };
    expect(log.c).toBe(1);
  });

  it('rejecting grants nothing and keeps the reason', async () => {
    const p = await svc.submit(USER, COOP);
    const r = await svc.reject(p!.id, REVIEWER, 'RCCM illisible');

    expect(r.ok).toBe(true);
    const after = await svc.getById(p!.id);
    expect(after).toMatchObject({ status: 'REJECTED', rejection_reason: 'RCCM illisible' });
    expect(kycLevel(db, USER)).toBe('BASIC');
  });

  it('a rejected dossier can be resubmitted, a verified one cannot', async () => {
    const p = await svc.submit(USER, COOP);
    await svc.reject(p!.id, REVIEWER, 'RCCM illisible');

    const again = await svc.submit(USER, { ...COOP, legalName: 'Coopérative du Sanmatenga' });
    expect(again).toMatchObject({ status: 'SUBMITTED', rejection_reason: null, legal_name: 'Coopérative du Sanmatenga' });

    await svc.approve(again!.id, REVIEWER, 'STANDARD');
    // Once verified, the producer cannot silently rewrite its own dossier.
    expect(await svc.submit(USER, { ...COOP, legalName: 'Autre Nom' })).toBeNull();
    expect((await svc.getByUserId(USER))!.legal_name).toBe('Coopérative du Sanmatenga');
  });

  it('a dossier already decided cannot be decided again', async () => {
    const p = await svc.submit(USER, COOP);
    await svc.approve(p!.id, REVIEWER, 'STANDARD');

    const second = await svc.approve(p!.id, REVIEWER, 'VERIFIED');
    expect(second).toMatchObject({ ok: false, error: 'INVALID_TRANSITION', from: 'VERIFIED' });
    // The level granted by the first decision stands.
    expect(kycLevel(db, USER)).toBe('STANDARD');
  });

  it('a lost race grants no KYC level', async () => {
    const p = await svc.submit(USER, COOP);

    // Our request reads SUBMITTED, then a concurrent reviewer decides first.
    const realGetById = svc.getById.bind(svc);
    let first = true;
    (svc as unknown as { getById: typeof realGetById }).getById = async (id: string) => {
      const row = await realGetById(id);
      if (first) {
        first = false;
        db.sqlite.prepare("UPDATE producer_profiles SET status = 'REJECTED' WHERE id = ?").run(id);
      }
      return row;
    };

    const r = await svc.approve(p!.id, REVIEWER, 'VERIFIED');

    expect(r).toMatchObject({ ok: false, error: 'CONFLICT' });
    // The whole batch is a no-op: no grant, no audit log.
    expect(kycLevel(db, USER)).toBe('BASIC');
    const log = db.sqlite
      .prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'PRODUCER_KYB_APPROVED'")
      .get() as { c: number };
    expect(log.c).toBe(0);
  });
});
