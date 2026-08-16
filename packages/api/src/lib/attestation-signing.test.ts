import { describe, it, expect, beforeAll } from 'vitest';
import * as jose from 'jose';
import { createAttestationSigner, verifyAttestationSignature } from './attestation-signing';

const DIGEST = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

let privateJwk: string;
let publicJwk: string;
let otherPublicJwk: string;

beforeAll(async () => {
  const { privateKey, publicKey } = await jose.generateKeyPair('ES256', { extractable: true });
  privateJwk = JSON.stringify(await jose.exportJWK(privateKey));
  publicJwk = JSON.stringify(await jose.exportJWK(publicKey));

  const other = await jose.generateKeyPair('ES256', { extractable: true });
  otherPublicJwk = JSON.stringify(await jose.exportJWK(other.publicKey));
});

describe('attestation signing', () => {
  it('signs a digest so anyone holding the public key can verify it', async () => {
    const signer = await createAttestationSigner(privateJwk);
    expect(signer).not.toBeNull();

    const { signature, keyId } = await signer!.sign(DIGEST);
    expect(keyId).toBeTruthy();
    expect(await verifyAttestationSignature(signature, DIGEST, publicJwk)).toBe(true);
  });

  it('rejects a signature checked against a different digest', async () => {
    const signer = await createAttestationSigner(privateJwk);
    const { signature } = await signer!.sign(DIGEST);
    const otherDigest = 'f'.repeat(64);
    expect(await verifyAttestationSignature(signature, otherDigest, publicJwk)).toBe(false);
  });

  it('rejects a signature from another key', async () => {
    const signer = await createAttestationSigner(privateJwk);
    const { signature } = await signer!.sign(DIGEST);
    // Someone else's key must not be able to vouch for our reserve.
    expect(await verifyAttestationSignature(signature, DIGEST, otherPublicJwk)).toBe(false);
  });

  it('rejects a tampered signature', async () => {
    const signer = await createAttestationSigner(privateJwk);
    const { signature } = await signer!.sign(DIGEST);
    const parts = signature.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${'A'.repeat(parts[2].length)}`;
    expect(await verifyAttestationSignature(tampered, DIGEST, publicJwk)).toBe(false);
  });

  it('fails closed when the key is absent or unusable', async () => {
    // No key at all — the job publishes nothing rather than an unsigned statement.
    expect(await createAttestationSigner(undefined)).toBeNull();
    expect(await createAttestationSigner('')).toBeNull();
    // Malformed key: signing with something we could not parse would be worse.
    expect(await createAttestationSigner('not json')).toBeNull();
  });

  it('refuses a symmetric key, which would silently produce an unverifiable HMAC', async () => {
    // jose.importJWK happily accepts an `oct` key when asked for ES256. Signing
    // with it would yield an HMAC that no published public key can check.
    expect(await createAttestationSigner('{"kty":"oct","k":"AAAAAAAAAAAAAAAAAAAAAA"}')).toBeNull();
  });

  it('refuses a public key or the wrong curve', async () => {
    // A public JWK has no `d`: it cannot sign, and accepting it would fail later.
    expect(await createAttestationSigner(publicJwk)).toBeNull();
    const p384 = await jose.generateKeyPair('ES384', { extractable: true });
    expect(await createAttestationSigner(JSON.stringify(await jose.exportJWK(p384.privateKey)))).toBeNull();
  });

  it('emits the compact JWS shape the browser verifier expects', async () => {
    // apps/web verifies attestations with native WebCrypto and no JOSE library.
    // It relies on exactly this: three parts, ES256, the digest as payload, and
    // a raw r||s signature (64 bytes for P-256) rather than DER.
    const signer = await createAttestationSigner(privateJwk);
    const { signature } = await signer!.sign(DIGEST);

    const parts = signature.split('.');
    expect(parts).toHaveLength(3);

    const header = JSON.parse(new TextDecoder().decode(jose.base64url.decode(parts[0])));
    expect(header.alg).toBe('ES256');
    expect(new TextDecoder().decode(jose.base64url.decode(parts[1]))).toBe(DIGEST);
    expect(jose.base64url.decode(parts[2]).byteLength).toBe(64);
  });

  it('carries a stable key id so a rotation stays verifiable', async () => {
    const signer = await createAttestationSigner(privateJwk);
    const a = await signer!.sign(DIGEST);
    const b = await signer!.sign(DIGEST);
    expect(a.keyId).toBe(b.keyId);

    const header = JSON.parse(new TextDecoder().decode(jose.base64url.decode(a.signature.split('.')[0])));
    expect(header).toMatchObject({ alg: 'ES256', kid: a.keyId });
  });
});
