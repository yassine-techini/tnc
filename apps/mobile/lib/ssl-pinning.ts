/**
 * SSL Certificate Pinning Configuration
 *
 * This module provides certificate pinning configuration for the TNC Trading mobile app.
 * True SSL pinning requires native code integration via EAS Build.
 *
 * For production deployment:
 * 1. Generate certificate hashes: openssl s_client -connect api.example.com:443 | openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl enc -base64
 * 2. Add the hashes to CERTIFICATE_PINS below
 * 3. Configure native SSL pinning via expo-modules or react-native-ssl-pinning
 *
 * @see https://owasp.org/www-community/controls/Certificate_and_Public_Key_Pinning
 */

/**
 * SHA-256 hashes of the public keys for certificate pinning.
 * Include multiple pins to support certificate rotation.
 */
export const CERTIFICATE_PINS: Record<string, string[]> = {
  // Production API
  'bf-api.tnc.trading': [
    // Primary certificate (current)
    // 'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    // Backup certificate (for rotation)
    // 'sha256/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
  ],
  // Staging API (Cloudflare Workers)
  'tnc-trading-api-staging.yassine-techini.workers.dev': [
    // Cloudflare's edge certificates are dynamically managed
    // Pin Cloudflare's intermediate CA instead for workers
    'sha256/jQJTbIh0grw0/1TkHSumWb+Fs0Ggogr621gT3PvPKG0=', // Cloudflare Inc ECC CA-3
    'sha256/5VLcahb6x4EvvFrCF2TePj8ZmM2w8h6vXhPvrTbU/qI=', // Cloudflare Origin RSA CA
  ],
  // Development API
  'tnc-trading-api-dev.yassine-techini.workers.dev': [
    'sha256/jQJTbIh0grw0/1TkHSumWb+Fs0Ggogr621gT3PvPKG0=', // Cloudflare Inc ECC CA-3
    'sha256/5VLcahb6x4EvvFrCF2TePj8ZmM2w8h6vXhPvrTbU/qI=', // Cloudflare Origin RSA CA
  ],
};

/**
 * Domains that require SSL pinning enforcement.
 * Requests to these domains will fail if pinning validation fails.
 */
export const PINNED_DOMAINS = [
  'bf-api.tnc.trading',
  'tnc-trading-api-staging.yassine-techini.workers.dev',
  'tnc-trading-api-dev.yassine-techini.workers.dev',
];

/**
 * Configuration for SSL pinning behavior
 */
export const SSL_PINNING_CONFIG = {
  /** Enable SSL pinning (should be true in production) */
  enabled: !__DEV__,

  /** Report pinning failures to backend for monitoring */
  reportFailures: true,

  /** Allow fallback to system trust store (should be false in production) */
  allowSystemTrust: __DEV__,

  /** Timeout for SSL handshake (ms) */
  handshakeTimeoutMs: 10000,
};

/**
 * Certificate pinning validation result
 */
export interface PinningResult {
  success: boolean;
  host: string;
  error?: string;
  certificateChain?: string[];
}

/**
 * Check if a host requires SSL pinning
 */
export function requiresPinning(host: string): boolean {
  return PINNED_DOMAINS.includes(host);
}

/**
 * Get the expected pins for a host
 */
export function getPinsForHost(host: string): string[] {
  return CERTIFICATE_PINS[host] || [];
}

/**
 * Validate a certificate hash against expected pins.
 * This function is called by the native SSL pinning module.
 *
 * @param host - The hostname being connected to
 * @param certificateHash - SHA-256 hash of the server's public key
 * @returns true if the certificate is trusted
 */
export function validateCertificatePin(
  host: string,
  certificateHash: string
): boolean {
  const expectedPins = getPinsForHost(host);

  // If no pins configured, allow in dev mode only
  if (expectedPins.length === 0) {
    if (__DEV__) {
      console.warn(`[SSL Pinning] No pins configured for ${host}, allowing in dev mode`);
      return true;
    }
    console.error(`[SSL Pinning] No pins configured for ${host}`);
    return false;
  }

  // Check if the certificate hash matches any expected pin
  const normalizedHash = certificateHash.startsWith('sha256/')
    ? certificateHash
    : `sha256/${certificateHash}`;

  const isValid = expectedPins.some((pin) => pin === normalizedHash);

  if (!isValid) {
    console.error(
      `[SSL Pinning] Certificate validation failed for ${host}. ` +
        `Received: ${normalizedHash}, Expected one of: ${expectedPins.join(', ')}`
    );
  }

  return isValid;
}

/**
 * Report a pinning failure for security monitoring.
 * This helps detect potential MITM attacks.
 */
export async function reportPinningFailure(result: PinningResult): Promise<void> {
  if (!SSL_PINNING_CONFIG.reportFailures) return;

  try {
    // In production, send this to a security monitoring endpoint
    // that doesn't require SSL pinning (or uses a different pinning config)
    console.error('[SSL Pinning] Pinning failure detected:', result);

    // TODO: Implement actual reporting when monitoring endpoint is available
    // await fetch('https://security-monitor.tnc.trading/api/pinning-failure', {
    //   method: 'POST',
    //   body: JSON.stringify({
    //     ...result,
    //     timestamp: new Date().toISOString(),
    //     appVersion: Application.nativeApplicationVersion,
    //   }),
    // });
  } catch (error) {
    console.error('[SSL Pinning] Failed to report pinning failure:', error);
  }
}

/**
 * Instructions for native SSL pinning integration
 *
 * For iOS (using TrustKit via expo-modules):
 * ```swift
 * TrustKit.initSharedInstance(withConfiguration: [
 *   kTSKSwizzleNetworkDelegates: true,
 *   kTSKPinnedDomains: [
 *     "bf-api.tnc.trading": [
 *       kTSKEnforcePinning: true,
 *       kTSKPublicKeyHashes: ["AAAA...", "BBBB..."],
 *     ]
 *   ]
 * ])
 * ```
 *
 * For Android (using OkHttp CertificatePinner):
 * ```kotlin
 * val certificatePinner = CertificatePinner.Builder()
 *   .add("bf-api.tnc.trading", "sha256/AAAA...", "sha256/BBBB...")
 *   .build()
 *
 * val client = OkHttpClient.Builder()
 *   .certificatePinner(certificatePinner)
 *   .build()
 * ```
 */
