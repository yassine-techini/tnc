/**
 * Reserve attestations — ADR 002, phase 1.
 *
 * Publishes a periodic, signed, hash-chained statement of the reserve. No token
 * exists on-chain and no balance moves: the chain, when configured, receives
 * only a digest. That is deliberate — it delivers the auditability that
 * motivates the whole move (nobody, including the operator, can rewrite the
 * reserve's history) without introducing a second, irreversible ledger.
 *
 * Each attestation embeds the previous digest. Rewriting an old one breaks every
 * later digest, so anchoring a single recent digest externally covers all the
 * history behind it.
 */
import { canonicalJson, grams, sha256Hex, type CanonicalValue } from '../lib/canonical';
import { GOLD_STOCK_ID } from './market.service';

export const ATTESTATION_VERSION = 1;

export interface AttestationRow {
  id: string;
  sequence: number;
  previous_digest: string | null;
  digest: string;
  payload: string;
  signature: string | null;
  signing_key_id: string | null;
  anchor_chain: string | null;
  anchor_tx_hash: string | null;
  anchored_at: string | null;
  created_at: string;
}

export type CreateError = 'NO_STOCK' | 'NOT_SIGNED' | 'CONFLICT';

/**
 * Both branches carry both keys on purpose. This package compiles with
 * `strictNullChecks: false`, which breaks narrowing on discriminated unions, so
 * a `{ ok: true } | { ok: false }` shape would not let callers read `.error`.
 * Same flat shape as TradeResult, for the same reason.
 */
export type CreateResult =
  | { ok: true; attestation: AttestationRow; error: null }
  | { ok: false; attestation: null; error: CreateError };

interface StockRow {
  total_allocated: number;
  tokens_issued: number;
  gold_on_loan: number | null;
}

interface AuditedLot {
  reference: string;
  refined_weight_g: number;
  producer_tokens_credited: number | null;
  audited_at: string;
}

export class AttestationService {
  constructor(private db: D1Database) {}

  async getLatest(): Promise<AttestationRow | null> {
    const row = await this.db
      .prepare('SELECT * FROM reserve_attestations ORDER BY sequence DESC LIMIT 1')
      .first<AttestationRow>();
    return row || null;
  }

  async getByDigest(digest: string): Promise<AttestationRow | null> {
    const row = await this.db
      .prepare('SELECT * FROM reserve_attestations WHERE digest = ?')
      .bind(digest)
      .first<AttestationRow>();
    return row || null;
  }

  async list(limit = 50, offset = 0): Promise<{ items: AttestationRow[]; total: number }> {
    const count = await this.db
      .prepare('SELECT COUNT(*) as c FROM reserve_attestations')
      .first<{ c: number }>();
    const rows = await this.db
      .prepare('SELECT * FROM reserve_attestations ORDER BY sequence DESC LIMIT ? OFFSET ?')
      .bind(limit, offset)
      .all<AttestationRow>();
    return { items: rows.results || [], total: count?.c || 0 };
  }

  /**
   * Build the canonical payload describing the reserve right now.
   *
   * Every gram travels as a fixed-precision string, so the digest never depends
   * on float rendering. `generatedAt` is part of the hashed document: an
   * attestation states "this was the reserve at that instant", and its truth is
   * not meant to be re-derived from a later database.
   */
  async buildPayload(previousDigest: string | null, generatedAt: string): Promise<CanonicalValue | null> {
    const stock = await this.db
      .prepare('SELECT total_allocated, tokens_issued, gold_on_loan FROM gold_stock WHERE id = ?')
      .bind(GOLD_STOCK_ID)
      .first<StockRow>();
    if (!stock) return null;

    // Lots audited since the previous attestation are what justifies any growth
    // of the backing. Ordered deterministically, not by insertion.
    const since = previousDigest
      ? (
          await this.db
            .prepare('SELECT created_at FROM reserve_attestations WHERE digest = ?')
            .bind(previousDigest)
            .first<{ created_at: string }>()
        )?.created_at ?? null
      : null;

    const lots = await this.db
      .prepare(
        `SELECT reference, refined_weight_g, producer_tokens_credited, audited_at
         FROM gold_consignments
         WHERE status = 'AUDIT_VALIDATED' AND audited_at IS NOT NULL
           AND (? IS NULL OR audited_at > ?)
         ORDER BY audited_at ASC, reference ASC`
      )
      .bind(since, since)
      .all<AuditedLot>();

    const free = stock.total_allocated - stock.tokens_issued;
    const onLoan = stock.gold_on_loan ?? 0;
    const vaulted = stock.total_allocated - onLoan;

    // Counterparties currently holding lent gold. Disclosed by name and weight:
    // an attestation that reported full coverage while part of the reserve sat
    // with a borrower would be materially incomplete.
    const loans = await this.db
      .prepare(
        `SELECT counterparty, weight_g, due_at FROM gold_loans
         WHERE status = 'ACTIVE' ORDER BY started_at ASC, counterparty ASC`
      )
      .all<{ counterparty: string; weight_g: number; due_at: string | null }>();

    return {
      version: ATTESTATION_VERSION,
      generatedAt,
      previousDigest,
      reserve: {
        totalAllocatedG: grams(stock.total_allocated),
        tokensIssuedG: grams(stock.tokens_issued),
        freeStockG: grams(free),
        // The split that tells a reader what is actually THERE. Lent gold is
        // owned but absent, and depends on a counterparty returning it.
        vaultedG: grams(vaulted),
        onLoanG: grams(onLoan),
        // The invariant this platform rests on, stated explicitly so a reader
        // does not have to trust our arithmetic.
        invariantHolds: stock.tokens_issued <= stock.total_allocated,
        // Stronger statement: claims covered by gold physically in the vault,
        // with no counterparty risk in between. FALSE is not necessarily a
        // fault — it is the lease product working — but it must be visible.
        fullyVaulted: stock.tokens_issued <= vaulted,
      },
      activeLoans: (loans.results || []).map((l) => ({
        counterparty: l.counterparty,
        weightG: grams(l.weight_g),
        dueAt: l.due_at,
      })),
      lotsAuditedSincePrevious: (lots.results || []).map((l) => ({
        reference: l.reference,
        refinedWeightG: grams(l.refined_weight_g),
        producerCreditedG: grams(l.producer_tokens_credited ?? 0),
        auditedAt: l.audited_at,
      })),
    };
  }

  /**
   * Create the next attestation.
   *
   * Refuses to produce an unsigned attestation: an unsigned statement that looks
   * official is worse than no statement. `sign` is injected so the service stays
   * free of key handling.
   */
  async create(
    generatedAt: string,
    sign: ((digest: string) => Promise<{ signature: string; keyId: string }>) | null
  ): Promise<CreateResult> {
    if (!sign) return { ok: false, attestation: null, error: 'NOT_SIGNED' };

    const latest = await this.getLatest();
    const previousDigest = latest?.digest ?? null;
    const sequence = (latest?.sequence ?? 0) + 1;

    const payloadValue = await this.buildPayload(previousDigest, generatedAt);
    if (!payloadValue) return { ok: false, attestation: null, error: 'NO_STOCK' };

    const payload = canonicalJson(payloadValue);
    const digest = await sha256Hex(payload);
    const { signature, keyId } = await sign(digest);

    const id = crypto.randomUUID();
    try {
      // sequence and digest are UNIQUE: two concurrent runs cannot both append,
      // and the loser fails here rather than forking the chain.
      await this.db
        .prepare(
          `INSERT INTO reserve_attestations
             (id, sequence, previous_digest, digest, payload, signature, signing_key_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(id, sequence, previousDigest, digest, payload, signature, keyId)
        .run();
    } catch {
      return { ok: false, attestation: null, error: 'CONFLICT' };
    }

    const created = await this.getByDigest(digest);
    return created
      ? { ok: true, attestation: created, error: null }
      : { ok: false, attestation: null, error: 'CONFLICT' };
  }

  /**
   * Recompute an attestation's digest from its stored payload and check its link
   * to the previous one. This is what a third party runs — it needs no database
   * access beyond the published records.
   */
  async verify(digest: string): Promise<{
    found: boolean;
    digestMatches: boolean;
    chainLinkValid: boolean;
    anchored: boolean;
    attestation: AttestationRow | null;
  }> {
    const row = await this.getByDigest(digest);
    if (!row) {
      return { found: false, digestMatches: false, chainLinkValid: false, anchored: false, attestation: null };
    }

    const recomputed = await sha256Hex(row.payload);
    const digestMatches = recomputed === row.digest;

    let chainLinkValid: boolean;
    if (row.previous_digest === null) {
      chainLinkValid = row.sequence === 1;
    } else {
      const prev = await this.db
        .prepare('SELECT sequence FROM reserve_attestations WHERE digest = ?')
        .bind(row.previous_digest)
        .first<{ sequence: number }>();
      chainLinkValid = !!prev && prev.sequence === row.sequence - 1;
    }

    return {
      found: true,
      digestMatches,
      chainLinkValid,
      anchored: !!row.anchor_tx_hash,
      attestation: row,
    };
  }

  /** Record that a digest was anchored on a chain. Idempotent per attestation. */
  async recordAnchor(digest: string, chain: string, txHash: string, anchoredAt: string): Promise<boolean> {
    const res = await this.db
      .prepare(
        `UPDATE reserve_attestations
         SET anchor_chain = ?, anchor_tx_hash = ?, anchored_at = ?
         WHERE digest = ? AND anchor_tx_hash IS NULL`
      )
      .bind(chain, txHash, anchoredAt, digest)
      .run();
    return res.meta.changes > 0;
  }
}
