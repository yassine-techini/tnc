/**
 * Producer KYB — identifying the entity behind a producer account.
 *
 * A producer may be an individual orpailleur or a legal entity. `kyc_documents`
 * only describes a natural person, so a cooperative had no way to reach the
 * KYC >= STANDARD level that consigning a lot requires. Approving a KYB grants
 * that level, in one atomic batch with the status change.
 *
 * A cooperative is one account held by its manager, so this is a single profile
 * row per user — not an organisation with members.
 */

import { z } from 'zod';

/**
 * Submission schema. Kept here with the service so the wire contract and the
 * type the service consumes cannot drift apart.
 */
export const kybSchema = z.object({
  entityType: z.enum(['INDIVIDUAL', 'COOPERATIVE', 'COMPANY']),
  legalName: z.string().min(2).max(200),
  registrationNumber: z.string().max(64).optional(),
  miningAuthorization: z.string().max(64).optional(),
  taxId: z.string().max(64).optional(),
  address: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  region: z.string().max(100).optional(),
  country: z.string().length(2).optional(),
  representativeName: z.string().min(2).max(150),
  representativeRole: z.string().max(100).optional(),
  representativePhone: z.string().max(32).optional(),
  documents: z.array(z.string().max(256)).max(10).optional(),
});

export type EntityType = 'INDIVIDUAL' | 'COOPERATIVE' | 'COMPANY';
export type KybStatus = 'SUBMITTED' | 'PROCESSING' | 'VERIFIED' | 'REJECTED';

export interface ProducerProfileRow {
  id: string;
  user_id: string;
  entity_type: EntityType;
  legal_name: string;
  registration_number: string | null;
  mining_authorization: string | null;
  tax_id: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string;
  representative_name: string;
  representative_role: string | null;
  representative_phone: string | null;
  documents: string | null;
  status: KybStatus;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ProducerProfileInput = z.infer<typeof kybSchema>;

export type ReviewResult =
  | { ok: true; profile: ProducerProfileRow }
  | { ok: false; error: 'NOT_FOUND' | 'INVALID_TRANSITION' | 'CONFLICT'; from?: KybStatus };

/** A decided KYB cannot be re-decided; the producer must resubmit. */
const DECIDABLE: KybStatus[] = ['SUBMITTED', 'PROCESSING'];

export class ProducerProfileService {
  constructor(private db: D1Database) {}

  async getByUserId(userId: string): Promise<ProducerProfileRow | null> {
    const row = await this.db
      .prepare('SELECT * FROM producer_profiles WHERE user_id = ?')
      .bind(userId)
      .first<ProducerProfileRow>();
    return row || null;
  }

  async getById(id: string): Promise<ProducerProfileRow | null> {
    const row = await this.db
      .prepare('SELECT * FROM producer_profiles WHERE id = ?')
      .bind(id)
      .first<ProducerProfileRow>();
    return row || null;
  }

  /**
   * Create the profile, or replace a rejected one with a fresh submission.
   * A profile already VERIFIED is never overwritten by the producer.
   */
  async submit(userId: string, p: ProducerProfileInput): Promise<ProducerProfileRow | null> {
    const existing = await this.getByUserId(userId);
    if (existing && existing.status === 'VERIFIED') return null;

    const documents = p.documents && p.documents.length ? JSON.stringify(p.documents) : null;

    if (existing) {
      await this.db
        .prepare(
          `UPDATE producer_profiles
           SET entity_type = ?, legal_name = ?, registration_number = ?, mining_authorization = ?,
               tax_id = ?, address = ?, city = ?, region = ?, country = ?,
               representative_name = ?, representative_role = ?, representative_phone = ?,
               documents = ?, status = 'SUBMITTED', rejection_reason = NULL,
               reviewed_by = NULL, reviewed_at = NULL, updated_at = datetime('now')
           WHERE user_id = ? AND status != 'VERIFIED'`
        )
        .bind(
          p.entityType, p.legalName, p.registrationNumber ?? null, p.miningAuthorization ?? null,
          p.taxId ?? null, p.address ?? null, p.city ?? null, p.region ?? null, p.country ?? 'BF',
          p.representativeName, p.representativeRole ?? null, p.representativePhone ?? null,
          documents, userId
        )
        .run();
    } else {
      await this.db
        .prepare(
          `INSERT INTO producer_profiles
             (id, user_id, entity_type, legal_name, registration_number, mining_authorization,
              tax_id, address, city, region, country, representative_name, representative_role,
              representative_phone, documents, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED')`
        )
        .bind(
          crypto.randomUUID(), userId, p.entityType, p.legalName, p.registrationNumber ?? null,
          p.miningAuthorization ?? null, p.taxId ?? null, p.address ?? null, p.city ?? null,
          p.region ?? null, p.country ?? 'BF', p.representativeName, p.representativeRole ?? null,
          p.representativePhone ?? null, documents
        )
        .run();
    }
    return this.getByUserId(userId);
  }

  async list(opts: { status?: string; limit?: number; offset?: number } = {}): Promise<{
    items: ProducerProfileRow[];
    total: number;
  }> {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const where = opts.status ? 'WHERE status = ?' : '';
    const binds = opts.status ? [opts.status] : [];
    const count = await this.db
      .prepare(`SELECT COUNT(*) as c FROM producer_profiles ${where}`)
      .bind(...binds)
      .first<{ c: number }>();
    const rows = await this.db
      .prepare(`SELECT * FROM producer_profiles ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .bind(...binds, limit, offset)
      .all<ProducerProfileRow>();
    return { items: rows.results || [], total: count?.c || 0 };
  }

  /**
   * Approve a KYB and grant the producer the configured KYC level.
   *
   * Both writes are guarded on the observed status and go in one batch, with the
   * status flip LAST — same contract as ConsignmentService.transition(): a
   * statement matching zero rows does not abort a batch, so a lost race must
   * leave the KYC level untouched rather than granting it twice over.
   */
  async approve(
    id: string,
    admin: { id: string },
    grantedLevel: 'STANDARD' | 'VERIFIED'
  ): Promise<ReviewResult> {
    const current = await this.getById(id);
    if (!current) return { ok: false, error: 'NOT_FOUND' };
    if (!DECIDABLE.includes(current.status)) {
      return { ok: false, error: 'INVALID_TRANSITION', from: current.status };
    }

    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE users SET kyc_level = ?, kyc_status = 'APPROVED', updated_at = datetime('now')
           WHERE id = ?
             AND EXISTS (SELECT 1 FROM producer_profiles WHERE id = ? AND status = ?)`
        )
        .bind(grantedLevel, current.user_id, id, current.status),
      this.db
        .prepare(
          `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at)
           SELECT ?, ?, 'PRODUCER_KYB_APPROVED', 'producer_profile', ?, ?, datetime('now')
           WHERE EXISTS (SELECT 1 FROM producer_profiles WHERE id = ? AND status = ?)`
        )
        .bind(
          crypto.randomUUID(), admin.id, id,
          JSON.stringify({ userId: current.user_id, entityType: current.entity_type, grantedLevel }),
          id, current.status
        ),
      this.db
        .prepare(
          `UPDATE producer_profiles
           SET status = 'VERIFIED', rejection_reason = NULL, reviewed_by = ?,
               reviewed_at = datetime('now'), updated_at = datetime('now')
           WHERE id = ? AND status = ?`
        )
        .bind(admin.id, id, current.status),
    ]);

    const flip = results[results.length - 1] as { meta: { changes: number } };
    if (flip.meta.changes === 0) return { ok: false, error: 'CONFLICT', from: current.status };
    const updated = await this.getById(id);
    return { ok: true, profile: updated! };
  }

  /** Reject a KYB. The KYC level is left alone — rejection grants nothing. */
  async reject(id: string, admin: { id: string }, reason: string): Promise<ReviewResult> {
    const current = await this.getById(id);
    if (!current) return { ok: false, error: 'NOT_FOUND' };
    if (!DECIDABLE.includes(current.status)) {
      return { ok: false, error: 'INVALID_TRANSITION', from: current.status };
    }

    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at)
           SELECT ?, ?, 'PRODUCER_KYB_REJECTED', 'producer_profile', ?, ?, datetime('now')
           WHERE EXISTS (SELECT 1 FROM producer_profiles WHERE id = ? AND status = ?)`
        )
        .bind(
          crypto.randomUUID(), admin.id, id,
          JSON.stringify({ userId: current.user_id, reason }), id, current.status
        ),
      this.db
        .prepare(
          `UPDATE producer_profiles
           SET status = 'REJECTED', rejection_reason = ?, reviewed_by = ?,
               reviewed_at = datetime('now'), updated_at = datetime('now')
           WHERE id = ? AND status = ?`
        )
        .bind(reason, admin.id, id, current.status),
    ]);

    const flip = results[results.length - 1] as { meta: { changes: number } };
    if (flip.meta.changes === 0) return { ok: false, error: 'CONFLICT', from: current.status };
    const updated = await this.getById(id);
    return { ok: true, profile: updated! };
  }
}
