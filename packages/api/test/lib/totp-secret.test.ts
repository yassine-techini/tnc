import { describe, it, expect } from 'vitest';
import { encryptTotpSecret, decryptTotpSecret, isEncryptedTotpSecret } from '../../src/lib/totp-secret';

// 64-hex-char (32-byte) test key
const KEY = 'a'.repeat(64);

describe('totp-secret encryption at rest', () => {
  it('round-trips an encrypted secret', async () => {
    const secret = 'JBSWY3DPEHPK3PXP'; // base32 TOTP secret
    const enc = await encryptTotpSecret(KEY, secret);
    expect(enc).toMatch(/^enc:v1:/);
    expect(enc).not.toContain(secret);
    expect(await decryptTotpSecret(KEY, enc)).toBe(secret);
  });

  it('produces a different ciphertext each time (random IV)', async () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const a = await encryptTotpSecret(KEY, secret);
    const b = await encryptTotpSecret(KEY, secret);
    expect(a).not.toBe(b);
    expect(await decryptTotpSecret(KEY, a)).toBe(secret);
    expect(await decryptTotpSecret(KEY, b)).toBe(secret);
  });

  it('passes through a legacy plaintext secret unchanged (backward compat)', async () => {
    const legacy = 'JBSWY3DPEHPK3PXP';
    expect(await decryptTotpSecret(KEY, legacy)).toBe(legacy);
    expect(isEncryptedTotpSecret(legacy)).toBe(false);
  });

  it('detects encrypted values', async () => {
    const enc = await encryptTotpSecret(KEY, 'JBSWY3DPEHPK3PXP');
    expect(isEncryptedTotpSecret(enc)).toBe(true);
    expect(isEncryptedTotpSecret(null)).toBe(false);
    expect(isEncryptedTotpSecret('')).toBe(false);
  });

  it('fails to decrypt with a wrong key', async () => {
    const enc = await encryptTotpSecret(KEY, 'JBSWY3DPEHPK3PXP');
    await expect(decryptTotpSecret('b'.repeat(64), enc)).rejects.toBeDefined();
  });
});
