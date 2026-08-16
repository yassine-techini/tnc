/**
 * SSL certificate pinning.
 *
 * Pinning is enforced natively — TrustKit on iOS, OkHttp's CertificatePinner on
 * Android — configured by `plugins/withSSLPinning.js` at prebuild. This module
 * is the JavaScript view of the same configuration: it decides what the app
 * believes about a host, and it must not be able to disagree with what the
 * native layer enforces.
 *
 * IT USED TO DISAGREE. The pins lived twice: once in `app.json` for the plugin,
 * once hardcoded here — and the production host `bf-api.tnc.trading` was pinned
 * natively while this file carried an empty array for it. Two sources of truth
 * for a security control is one too many, so both now read
 * `expo.extra.sslPinning` from the app config.
 *
 * FAIL-CLOSED: a release build with no pins for a pinned host refuses the host.
 * It does not quietly fall back to the system trust store, because that is
 * exactly the state an attacker with a rogue CA needs. `scripts/check-ssl-pins.mjs`
 * makes that a build failure rather than a runtime surprise.
 */

import Constants from 'expo-constants';
import { checkPin, normalizePin, pinningReadiness, type Pin } from './ssl-pinning-rules';

// Re-exported so callers keep one import, and so the rules stay testable
// without a native runtime (see ssl-pinning-rules.ts).
export { checkPin, normalizePin, pinningReadiness };
export type { Pin };

export interface SslPinningConfig {
  /** host -> SHA-256 public key pins, base64, "sha256/" prefixed. */
  domains: Record<string, string[]>;
}

/**
 * Read the pins from the app config — the same object the native plugin
 * consumes, so the two cannot drift.
 */
function readConfiguredDomains(): Record<string, string[]> {
  const extra = (Constants.expoConfig?.extra ?? {}) as {
    sslPinning?: Partial<SslPinningConfig>;
  };
  const domains = extra.sslPinning?.domains;
  if (!domains || typeof domains !== 'object') return {};

  // Defensive: `extra` travels through JSON and an over-the-air update, so it
  // is not typed at runtime whatever TypeScript believes here.
  const clean: Record<string, string[]> = {};
  for (const [host, pins] of Object.entries(domains)) {
    if (Array.isArray(pins)) clean[host] = pins.filter((p) => typeof p === 'string' && p.length > 0);
  }
  return clean;
}

export const CERTIFICATE_PINS: Record<string, string[]> = readConfiguredDomains();

/** Hosts pinning applies to — exactly those declared, nothing implied. */
export const PINNED_DOMAINS: string[] = Object.keys(CERTIFICATE_PINS);

export const SSL_PINNING_CONFIG = {
  /** Enforced in every build that is not a dev build. */
  enabled: !__DEV__,
  reportFailures: true,
  /**
   * Never true outside development. Falling back to the system trust store on a
   * pinning failure would make pinning decorative: any device with an installed
   * rogue CA — a corporate proxy, an interception tool — would be trusted again.
   */
  allowSystemTrust: __DEV__,
  handshakeTimeoutMs: 10000,
};

export interface PinningResult {
  success: boolean;
  host: string;
  error?: string;
  certificateChain?: string[];
}

export function requiresPinning(host: string): boolean {
  return PINNED_DOMAINS.includes(host);
}

export function getPinsForHost(host: string): string[] {
  return CERTIFICATE_PINS[host] || [];
}

export function validateCertificatePin(host: string, certificateHash: string): boolean {
  const result = checkPin({
    host,
    certificateHash,
    pins: getPinsForHost(host),
    isDev: __DEV__,
  });

  if (!result.trusted) {
    console.error(`[SSL Pinning] ${result.reason} for ${host}`);
  } else if (result.reason === 'NO_PINS_DEV') {
    console.warn(`[SSL Pinning] No pins configured for ${host}, allowed in dev only`);
  }

  return result.trusted;
}

export async function reportPinningFailure(result: PinningResult): Promise<void> {
  if (!SSL_PINNING_CONFIG.reportFailures) return;
  try {
    // Reporting must not itself go through a pinned, failing channel — hence a
    // separate monitoring endpoint. Not implemented yet, and saying so beats a
    // silent no-op that looks like monitoring.
    console.error('[SSL Pinning] Pinning failure detected:', result);
  } catch (error) {
    console.error('[SSL Pinning] Failed to report pinning failure:', error);
  }
}
