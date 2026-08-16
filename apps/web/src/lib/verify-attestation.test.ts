/**
 * The browser verifier must accept exactly what the API signs, and reject
 * everything else. This is the contract that crosses the network boundary, so
 * it is tested against a real ES256 signature rather than a fixture.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { verifyAttestation, sha256Hex, findChainBreaks, type AttestationRecord } from './verify-attestation';

const PAYLOAD = '{"reserve":{"tokensIssuedG":"175.500","totalAllocatedG":"10000.000"},"version":1}';

let publicJwk: JsonWebKey;
let otherPublicJwk: JsonWebKey;
let digest: string;
let signature: string;

function b64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Build a compact JWS the way the API does. `jose` is not a dependency of this
 * app, so the equivalent is produced with WebCrypto here; the API-side test
 * pins that jose emits this exact structure (ES256 header, digest as payload,
 * raw r||s signature).
 */
async function signCompactJws(privateKey: CryptoKey, payload: string): Promise<string> {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: 'test-key' }));
  const body = b64url(payload);
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(`${header}.${body}`)
  );
  return `${header}.${body}.${b64url(new Uint8Array(sig))}`;
}

beforeAll(async () => {
  digest = await sha256Hex(PAYLOAD);

  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  signature = await signCompactJws(pair.privateKey, digest);

  const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  otherPublicJwk = await crypto.subtle.exportKey('jwk', other.publicKey);
});

function record(overrides: Partial<AttestationRecord> = {}): AttestationRecord {
  return {
    sequence: 1,
    digest,
    previousDigest: null,
    payload: PAYLOAD,
    signature,
    signingKeyId: 'test-key',
    anchorChain: null,
    anchorTxHash: null,
    anchoredAt: null,
    createdAt: '2026-08-15T00:30:00.000Z',
    ...overrides,
  };
}

describe('verifyAttestation', () => {
  it('accepts a genuine attestation signed by the API', async () => {
    const r = await verifyAttestation(record(), publicJwk);
    expect(r).toMatchObject({ digestMatches: true, signatureValid: true, computedDigest: digest });
  });

  it('detects a payload edited after signature', async () => {
    const tampered = record({ payload: PAYLOAD.replace('10000.000', '99000.000') });
    const r = await verifyAttestation(tampered, publicJwk);
    // The document no longer hashes to the digest it claims…
    expect(r.digestMatches).toBe(false);
    // …while the signature still covers the ORIGINAL digest, so it stays valid.
    // That is the point: the mismatch is what exposes the edit.
    expect(r.signatureValid).toBe(true);
  });

  it('detects a digest swapped to match a forged payload', async () => {
    const forgedPayload = PAYLOAD.replace('10000.000', '99000.000');
    const forged = record({ payload: forgedPayload, digest: await sha256Hex(forgedPayload) });
    const r = await verifyAttestation(forged, publicJwk);
    // The hash now matches, but nothing signed that digest.
    expect(r.digestMatches).toBe(true);
    expect(r.signatureValid).toBe(false);
  });

  it('rejects a signature from another key', async () => {
    const r = await verifyAttestation(record(), otherPublicJwk);
    expect(r.signatureValid).toBe(false);
  });

  it('reports signature as unknown rather than valid when no key is published', async () => {
    const r = await verifyAttestation(record(), null);
    expect(r.digestMatches).toBe(true);
    expect(r.signatureValid).toBeNull();
  });

  it('rejects a malformed signature without throwing', async () => {
    expect((await verifyAttestation(record({ signature: 'not-a-jws' }), publicJwk)).signatureValid).toBe(false);
    expect((await verifyAttestation(record({ signature: 'a.b.c' }), publicJwk)).signatureValid).toBe(false);
  });
});

describe('findChainBreaks', () => {
  it('accepts an unbroken chain', () => {
    const items = [
      record({ sequence: 1, digest: 'aaa', previousDigest: null }),
      record({ sequence: 2, digest: 'bbb', previousDigest: 'aaa' }),
      record({ sequence: 3, digest: 'ccc', previousDigest: 'bbb' }),
    ];
    expect(findChainBreaks(items)).toEqual([]);
  });

  it('points at the attestation where the chain was broken', () => {
    const items = [
      record({ sequence: 1, digest: 'aaa', previousDigest: null }),
      // #2 no longer references #1 — an attestation was replaced.
      record({ sequence: 2, digest: 'bbb', previousDigest: 'zzz' }),
      record({ sequence: 3, digest: 'ccc', previousDigest: 'bbb' }),
    ];
    expect(findChainBreaks(items)).toEqual([2]);
  });

  it('does not depend on the order the records arrive in', () => {
    const items = [
      record({ sequence: 3, digest: 'ccc', previousDigest: 'bbb' }),
      record({ sequence: 1, digest: 'aaa', previousDigest: null }),
      record({ sequence: 2, digest: 'bbb', previousDigest: 'aaa' }),
    ];
    expect(findChainBreaks(items)).toEqual([]);
  });
});
