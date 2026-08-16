/**
 * Anchor the latest reserve attestation on a public chain — ADR 003.
 *
 * Runs separately from, and after, the attestation job. An attestation exists
 * and verifies without an anchor; the anchor is an extra confirmation, never a
 * precondition. Because each attestation embeds the previous digest, anchoring
 * the most recent one covers all the history behind it — a few transactions a
 * month, not one per movement.
 */

import type { Env } from '../../types/env';
import { AttestationService } from '../../services/attestation.service';
import { createAnchorAdapter, isMainnet, DEFAULT_CHAIN } from '../../lib/anchoring';

export async function anchorLatestAttestation(env: Env, _ctx: ExecutionContext): Promise<void> {
  console.log('[Anchor] Starting');

  const chain = env.ANCHOR_CHAIN || DEFAULT_CHAIN;

  // Mainnet requires an explicit opt-in: a misconfigured deployment must anchor
  // on a testnet, not spend real funds by accident (ADR 003).
  if (isMainnet(chain) && env.ANCHOR_ALLOW_MAINNET !== 'true') {
    console.error(`[Anchor] ${chain} is a mainnet — set ANCHOR_ALLOW_MAINNET=true to confirm. Skipped.`);
    return;
  }

  const adapter = createAnchorAdapter({
    chain,
    rpcUrl: env.ANCHOR_RPC_URL,
    privateKey: env.ANCHOR_PRIVATE_KEY,
  });

  if (!(await adapter.isAvailable())) {
    console.warn('[Anchor] Not configured — attestations remain published and verifiable, simply not anchored');
    return;
  }

  const service = new AttestationService(env.DB);
  const latest = await service.getLatest();

  if (!latest) {
    console.warn('[Anchor] No attestation to anchor');
    return;
  }
  if (latest.anchor_tx_hash) {
    console.log(`[Anchor] #${latest.sequence} already anchored (${latest.anchor_tx_hash})`);
    return;
  }

  const result = await adapter.anchor(latest.digest);
  if (!result.ok || !result.txHash) {
    console.error(`[Anchor] Failed for #${latest.sequence}: ${result.error}`);
    return;
  }

  // Guarded on anchor_tx_hash IS NULL: a retry after a network timeout cannot
  // rewrite which transaction anchored what.
  const recorded = await service.recordAnchor(
    latest.digest,
    result.chain || chain,
    result.txHash,
    new Date().toISOString()
  );

  if (!recorded) {
    console.warn(
      `[Anchor] #${latest.sequence} was anchored concurrently; transaction ${result.txHash} is a duplicate and was not recorded`
    );
    return;
  }

  console.log(`[Anchor] #${latest.sequence} anchored on ${chain}: ${result.txHash}`);
}
