/**
 * Reserve attestations, end to end with a REAL ES256 key.
 *
 * The other attestation tests use a stand-in signer to isolate the hash chain.
 * This one exercises the whole pipeline the way production does: generate a key,
 * build the signer the job builds, publish, then verify the signature the way a
 * third party would — from the published payload and the public key alone.
 *
 * It also pins the reserve disclosure. The lease product funds its yield by
 * LENDING the gold out, so a portion of the reserve can be owned but absent. An
 * attestation that reported full coverage without saying so would mislead the
 * State, a citizen or an auditor about counterparty risk.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as jose from 'jose';
import { AttestationService } from '../../src/services/attestation.service';
import { createAttestationSigner, verifyAttestationSignature } from '../../src/lib/attestation-signing';
import { sha256Hex } from '../../src/lib/canonical';
import { createTestD1, seedStock, type TestD1 } from '../helpers/real-d1';

const asD1 = (db: TestD1) => db as unknown as D1Database;

interface ReservePayload {
  version: number;
  reserve: {
    totalAllocatedG: string;
    tokensIssuedG: string;
    vaultedG: string;
    onLoanG: string;
    invariantHolds: boolean;
    fullyVaulted: boolean;
  };
  activeLoans: Array<{ counterparty: string; weightG: string; dueAt: string | null }>;
}

async function realSigner() {
  const { privateKey, publicKey } = await jose.generateKeyPair('ES256', { extractable: true });
  const privateJwk = JSON.stringify(await jose.exportJWK(privateKey));
  const publicJwk = JSON.stringify(await jose.exportJWK(publicKey));
  const signer = await createAttestationSigner(privateJwk);
  return { signer: signer!, publicJwk };
}

describe('Attestation pipeline (real key, end to end)', () => {
  let db: TestD1;
  let svc: AttestationService;

  beforeEach(() => {
    db = createTestD1();
    seedStock(db, { totalAllocated: 10000, tokensIssued: 4000 });
    svc = new AttestationService(asD1(db));
  });

  it('publishes an attestation a third party can verify with the public key alone', async () => {
    const { signer, publicJwk } = await realSigner();

    const r = await svc.create('2026-08-16T00:30:00.000Z', (d) => signer.sign(d));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { payload, digest, signature } = r.attestation;

    // Exactly what a verifier does: recompute, then check the signature.
    expect(await sha256Hex(payload)).toBe(digest);
    expect(await verifyAttestationSignature(signature!, digest, publicJwk)).toBe(true);

    // And a payload edited after the fact stops matching its digest.
    const tampered = payload.replace('"tokensIssuedG":"4000.000"', '"tokensIssuedG":"1.000"');
    expect(await sha256Hex(tampered)).not.toBe(digest);
  });

  it('a signature from another key is refused', async () => {
    const { signer } = await realSigner();
    const other = await realSigner();

    const r = await svc.create('2026-08-16T00:30:00.000Z', (d) => signer.sign(d));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(
      await verifyAttestationSignature(r.attestation.signature!, r.attestation.digest, other.publicJwk)
    ).toBe(false);
  });

  it('states full vaulting when no gold is lent', async () => {
    const { signer } = await realSigner();
    const r = await svc.create('2026-08-16T00:30:00.000Z', (d) => signer.sign(d));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const payload = JSON.parse(r.attestation.payload) as ReservePayload;
    expect(payload.reserve).toMatchObject({
      totalAllocatedG: '10000.000',
      vaultedG: '10000.000',
      onLoanG: '0.000',
      invariantHolds: true,
      fullyVaulted: true,
    });
    expect(payload.activeLoans).toEqual([]);
  });

  it('discloses lent gold, and stops claiming full vaulting when claims exceed it', async () => {
    // 8 000 g lent out of 10 000 owned, against 4 000 g of tokens issued.
    // Ownership still covers the claims, but only 2 000 g are actually present.
    db.sqlite.prepare("UPDATE gold_stock SET gold_on_loan = 8000 WHERE id = 'main'").run();
    db.sqlite
      .prepare(
        `INSERT INTO gold_loans (id, counterparty, weight_g, due_at, status)
         VALUES ('l1', 'Bullion Bank X', 8000, '2026-12-31', 'ACTIVE')`
      )
      .run();

    const { signer } = await realSigner();
    const r = await svc.create('2026-08-16T00:30:00.000Z', (d) => signer.sign(d));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const payload = JSON.parse(r.attestation.payload) as ReservePayload;

    // Owned gold still covers the tokens…
    expect(payload.reserve.invariantHolds).toBe(true);
    // …but 4 000 g of claims sit against 2 000 g physically present.
    expect(payload.reserve.vaultedG).toBe('2000.000');
    expect(payload.reserve.onLoanG).toBe('8000.000');
    expect(payload.reserve.fullyVaulted).toBe(false);

    // And the counterparty is named, which is what makes the risk auditable.
    expect(payload.activeLoans).toEqual([
      { counterparty: 'Bullion Bank X', weightG: '8000.000', dueAt: '2026-12-31' },
    ]);
  });

  it('a returned loan restores full vaulting', async () => {
    db.sqlite.prepare("UPDATE gold_stock SET gold_on_loan = 5000 WHERE id = 'main'").run();
    db.sqlite
      .prepare(
        `INSERT INTO gold_loans (id, counterparty, weight_g, status) VALUES ('l1', 'X', 5000, 'ACTIVE')`
      )
      .run();

    const { signer } = await realSigner();
    await svc.create('2026-08-16T00:30:00.000Z', (d) => signer.sign(d));

    db.sqlite.prepare("UPDATE gold_stock SET gold_on_loan = 0 WHERE id = 'main'").run();
    db.sqlite.prepare("UPDATE gold_loans SET status = 'RETURNED' WHERE id = 'l1'").run();

    const r = await svc.create('2026-08-17T00:30:00.000Z', (d) => signer.sign(d));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const payload = JSON.parse(r.attestation.payload) as ReservePayload;
    expect(payload.reserve.fullyVaulted).toBe(true);
    expect(payload.activeLoans).toEqual([]);
  });

  it('chains across a lending event, so the disclosure cannot be rewritten later', async () => {
    const { signer } = await realSigner();
    const first = await svc.create('2026-08-16T00:30:00.000Z', (d) => signer.sign(d));

    db.sqlite.prepare("UPDATE gold_stock SET gold_on_loan = 3000 WHERE id = 'main'").run();
    const second = await svc.create('2026-08-17T00:30:00.000Z', (d) => signer.sign(d));

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.attestation.previous_digest).toBe(first.attestation.digest);
    // Rewriting the pre-loan attestation breaks its own digest, and the later
    // one still points at a value nothing can reproduce.
    const check = await svc.verify(second.attestation.digest);
    expect(check).toMatchObject({ digestMatches: true, chainLinkValid: true });
  });
});
