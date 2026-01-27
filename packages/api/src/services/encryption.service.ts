/**
 * Encryption Service - AES-256-GCM for KYC documents
 * Uses Web Crypto API (available in Cloudflare Workers)
 */

export class EncryptionService {
  private keyMaterial: Uint8Array;

  constructor(encryptionKeyHex: string) {
    // ENCRYPTION_KEY should be a 64-char hex string (32 bytes = 256 bits)
    this.keyMaterial = hexToBytes(encryptionKeyHex);
  }

  /**
   * Encrypt data with AES-256-GCM.
   * Returns: IV (12 bytes) + ciphertext + auth tag (concatenated).
   */
  async encrypt(data: ArrayBuffer): Promise<ArrayBuffer> {
    const key = await crypto.subtle.importKey(
      'raw',
      this.keyMaterial,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );

    // Prepend IV to ciphertext
    const result = new Uint8Array(iv.length + ciphertext.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(ciphertext), iv.length);

    return result.buffer;
  }

  /**
   * Decrypt AES-256-GCM data (expects IV prepended).
   */
  async decrypt(encryptedData: ArrayBuffer): Promise<ArrayBuffer> {
    const key = await crypto.subtle.importKey(
      'raw',
      this.keyMaterial,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    const dataArray = new Uint8Array(encryptedData);
    const iv = dataArray.slice(0, 12);
    const ciphertext = dataArray.slice(12);

    return crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
