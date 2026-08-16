/**
 * Independent verification of a reserve attestation, in the browser.
 *
 * This deliberately does NOT ask the API whether an attestation is valid — an
 * attestation that you can only check by asking us proves nothing. Everything
 * here runs on the visitor's machine, from the published payload, signature and
 * public key, using native WebCrypto.
 */

export interface AttestationRecord {
  sequence: number;
  digest: string;
  previousDigest: string | null;
  payload: string;
  signature: string | null;
  signingKeyId: string | null;
  anchorChain: string | null;
  anchorTxHash: string | null;
  anchoredAt: string | null;
  createdAt: string;
}

export interface VerificationOutcome {
  digestMatches: boolean;
  signatureValid: boolean | null; // null when no key is published
  computedDigest: string;
}

/** Lowercase hex SHA-256 — must match the server's `sha256Hex`. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// No explicit return type: annotating it as `Uint8Array` widens the backing
// buffer to ArrayBufferLike, which WebCrypto's BufferSource does not accept.
function base64UrlToBytes(input: string) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Verify a compact JWS (ES256) over the digest.
 *
 * JWS carries the ECDSA signature as raw r||s, which is exactly what WebCrypto
 * expects — no DER conversion needed.
 */
async function verifyCompactJws(jws: string, expectedPayload: string, jwk: JsonWebKey): Promise<boolean> {
  const parts = jws.split('.');
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, signatureB64] = parts;

  try {
    const header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerB64)));
    if (header.alg !== 'ES256') return false;

    // The signed statement must be the digest itself, not something else.
    if (new TextDecoder().decode(base64UrlToBytes(payloadB64)) !== expectedPayload) return false;

    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );

    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      base64UrlToBytes(signatureB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    );
  } catch {
    return false;
  }
}

/**
 * Recompute the digest from the published payload and check the signature.
 * `publicJwk` may be null when no key has been published yet.
 */
export async function verifyAttestation(
  record: AttestationRecord,
  publicJwk: JsonWebKey | null
): Promise<VerificationOutcome> {
  const computedDigest = await sha256Hex(record.payload);
  const digestMatches = computedDigest === record.digest;

  let signatureValid: boolean | null = null;
  if (publicJwk && record.signature) {
    signatureValid = await verifyCompactJws(record.signature, record.digest, publicJwk);
  }

  return { digestMatches, signatureValid, computedDigest };
}

/**
 * Check that a list of attestations forms an unbroken chain, newest first.
 * Returns the sequence numbers where the link is broken.
 */
export function findChainBreaks(items: AttestationRecord[]): number[] {
  const breaks: number[] = [];
  const sorted = [...items].sort((a, b) => a.sequence - b.sequence);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].previousDigest !== sorted[i - 1].digest) {
      breaks.push(sorted[i].sequence);
    }
  }
  return breaks;
}
