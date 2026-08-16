/**
 * Reserve Attestation Job — ADR 002, phase 1.
 *
 * Publishes one signed, hash-chained statement of the reserve per run. No token
 * moves and nothing is sent to a chain here: anchoring a digest externally is a
 * separate, later step, and an attestation is already verifiable without it.
 *
 * Disabled until `ATTESTATION_SIGNING_JWK` is configured — producing an unsigned
 * statement that looks official would be worse than producing none.
 */

import type { Env } from '../../types/env';
import { AttestationService } from '../../services/attestation.service';
import { createAttestationSigner } from '../../lib/attestation-signing';

export async function publishReserveAttestation(env: Env, _ctx: ExecutionContext): Promise<void> {
  console.log('[ReserveAttestation] Starting');

  const signer = await createAttestationSigner(env.ATTESTATION_SIGNING_JWK);
  if (!signer) {
    console.warn('[ReserveAttestation] ATTESTATION_SIGNING_JWK not configured — skipped');
    return;
  }

  const service = new AttestationService(env.DB);
  const generatedAt = new Date().toISOString();

  const result = await service.create(generatedAt, (digest) => signer.sign(digest));

  if (!result.ok) {
    // NO_STOCK means the reserve row does not exist yet — nothing to attest to,
    // which is the normal state of a freshly migrated database.
    if (result.error === 'NO_STOCK') {
      console.warn('[ReserveAttestation] No gold_stock row — nothing to attest');
      return;
    }
    console.error(`[ReserveAttestation] Failed: ${result.error}`);
    return;
  }

  const { sequence, digest, previous_digest } = result.attestation;
  console.log(
    `[ReserveAttestation] Published #${sequence} ${digest}` +
      (previous_digest ? ` (chained to ${previous_digest.slice(0, 12)}…)` : ' (genesis)')
  );
}
