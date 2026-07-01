/**
 * TOTP secret encryption at rest.
 *
 * 2FA secrets were previously stored in plaintext in users/admins, so a DB dump
 * would expose every second factor. These helpers wrap the shared
 * EncryptionService (AES-256-GCM) to encrypt secrets before storage and decrypt
 * them at verification time.
 *
 * Backward compatible: an unprefixed value is treated as a legacy plaintext
 * secret and returned as-is, so existing 2FA enrolments keep working and are
 * transparently re-encrypted the next time the secret is (re)written.
 */
import { EncryptionService } from '../services/encryption.service';

const ENC_PREFIX = 'enc:v1:';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encrypt a (base32) TOTP secret for storage. Returns an `enc:v1:`-prefixed,
 * base64-encoded IV+ciphertext+tag blob.
 */
export async function encryptTotpSecret(keyHex: string, plaintext: string): Promise<string> {
  const enc = new EncryptionService(keyHex);
  const buf = await enc.encrypt(new TextEncoder().encode(plaintext).buffer as ArrayBuffer);
  return ENC_PREFIX + bytesToBase64(new Uint8Array(buf));
}

/**
 * Decrypt a stored TOTP secret. If the value is not `enc:v1:`-prefixed it is a
 * legacy plaintext secret and returned unchanged.
 */
export async function decryptTotpSecret(keyHex: string, stored: string): Promise<string> {
  if (!stored || !stored.startsWith(ENC_PREFIX)) {
    return stored; // legacy plaintext (or empty)
  }
  const enc = new EncryptionService(keyHex);
  const bytes = base64ToBytes(stored.slice(ENC_PREFIX.length));
  const plainBuf = await enc.decrypt(bytes.buffer as ArrayBuffer);
  return new TextDecoder().decode(plainBuf);
}

/** True if the stored value is already encrypted. */
export function isEncryptedTotpSecret(stored: string | null | undefined): boolean {
  return !!stored && stored.startsWith(ENC_PREFIX);
}
