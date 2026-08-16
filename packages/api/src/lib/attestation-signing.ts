/**
 * Detached signature over an attestation digest.
 *
 * Asymmetric on purpose: an HMAC would only be verifiable by whoever can also
 * forge it, which defeats the point of publishing an attestation. ES256 lets
 * anyone holding the published public JWK check a statement without trusting us.
 *
 * The signing key lives in `ATTESTATION_SIGNING_JWK` (a private JWK). When it is
 * absent, signing is unavailable and no attestation is produced at all — an
 * unsigned statement that looks official is worse than no statement.
 */
import * as jose from 'jose';

export interface Signer {
  sign(digest: string): Promise<{ signature: string; keyId: string }>;
}

/**
 * Build a signer from the configured private JWK, or null when unconfigured.
 * Returns null on a malformed key too: failing closed beats signing with
 * something we could not parse.
 */
export async function createAttestationSigner(privateJwk?: string): Promise<Signer | null> {
  if (!privateJwk) return null;

  let jwk: jose.JWK;
  try {
    jwk = JSON.parse(privateJwk) as jose.JWK;
  } catch {
    console.error('ATTESTATION_SIGNING_JWK is not valid JSON — attestations disabled');
    return null;
  }

  // jose.importJWK accepts a symmetric `oct` key even when asked for ES256, and
  // would then produce an HMAC — verifiable only by whoever can also forge it,
  // which is precisely what this module exists to avoid. Require an actual
  // P-256 private key before going anywhere near importJWK.
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d) {
    console.error('ATTESTATION_SIGNING_JWK is not an EC P-256 private key — attestations disabled');
    return null;
  }

  let key: Awaited<ReturnType<typeof jose.importJWK>>;
  try {
    key = await jose.importJWK(jwk, 'ES256');
  } catch {
    console.error('ATTESTATION_SIGNING_JWK could not be imported as ES256 — attestations disabled');
    return null;
  }

  // A key id is what lets a verifier pick the right public key after a rotation.
  const keyId = jwk.kid || (await jose.calculateJwkThumbprint(jwk));

  return {
    async sign(digest: string) {
      const signature = await new jose.CompactSign(new TextEncoder().encode(digest))
        .setProtectedHeader({ alg: 'ES256', kid: keyId })
        .sign(key);
      return { signature, keyId };
    },
  };
}

/**
 * Verify a detached attestation signature against a published public JWK.
 * Used by the public verification endpoint so a third party can check without
 * running any of our code.
 */
export async function verifyAttestationSignature(
  signature: string,
  digest: string,
  publicJwk: string
): Promise<boolean> {
  try {
    const key = await jose.importJWK(JSON.parse(publicJwk) as jose.JWK, 'ES256');
    const { payload } = await jose.compactVerify(signature, key);
    return new TextDecoder().decode(payload) === digest;
  } catch {
    return false;
  }
}
