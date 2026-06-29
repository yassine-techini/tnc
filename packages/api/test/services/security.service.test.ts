/**
 * Security Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SecurityService, SECURITY_DEFAULTS } from '../../src/services/security.service';
import { createMockD1Database, createMockKVNamespace } from '../setup';

describe('SecurityService', () => {
  let securityService: SecurityService;
  let mockDb: D1Database;
  let mockCache: KVNamespace;

  beforeEach(() => {
    mockDb = createMockD1Database();
    mockCache = createMockKVNamespace();
    securityService = new SecurityService(mockDb, mockCache);
  });

  // ─── Security Defaults ───────────────────────────────────
  describe('SECURITY_DEFAULTS', () => {
    it('defines reasonable login attempt limits', () => {
      expect(SECURITY_DEFAULTS.MAX_LOGIN_ATTEMPTS).toBe(5);
      expect(SECURITY_DEFAULTS.LOCKOUT_DURATION_MINUTES).toBe(15);
    });

    it('defines strong password requirements', () => {
      expect(SECURITY_DEFAULTS.PASSWORD_MIN_LENGTH).toBe(12);
      expect(SECURITY_DEFAULTS.PASSWORD_REQUIRE_UPPERCASE).toBe(true);
      expect(SECURITY_DEFAULTS.PASSWORD_REQUIRE_SPECIAL).toBe(true);
    });

    it('defines session timeouts', () => {
      expect(SECURITY_DEFAULTS.SESSION_TIMEOUT_MINUTES).toBe(15);
      expect(SECURITY_DEFAULTS.ABSOLUTE_SESSION_TIMEOUT_HOURS).toBe(8);
    });
  });

  // ─── Password Validation ─────────────────────────────────
  describe('validatePassword', () => {
    it('rejects password shorter than minimum length', () => {
      const result = securityService.validatePassword('Short1!');

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('au moins') && e.includes('caractères'))).toBe(true);
    });

    it('rejects password without uppercase', () => {
      const result = securityService.validatePassword('lowercaseonly123!');

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('majuscule'))).toBe(true);
    });

    it('rejects password without lowercase', () => {
      const result = securityService.validatePassword('UPPERCASEONLY123!');

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('minuscule'))).toBe(true);
    });

    it('rejects password without number', () => {
      const result = securityService.validatePassword('NoNumbersHere!');

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('chiffre'))).toBe(true);
    });

    it('rejects password without special character', () => {
      const result = securityService.validatePassword('NoSpecialChar123');

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('caractère spécial'))).toBe(true);
    });

    it('rejects password with common patterns', () => {
      const result = securityService.validatePassword('MyPassword123!');

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('commune') || e.includes('courant'))).toBe(true);
    });

    it('rejects password with repeated characters', () => {
      const result = securityService.validatePassword('Secuuure123!!');

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('identiques') || e.includes('répét'))).toBe(true);
    });

    it('accepts strong password', () => {
      const result = securityService.validatePassword('MyStr0ng&Secure!Pass');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(['strong', 'very_strong']).toContain(result.strength);
    });

    it('calculates password strength', () => {
      const weak = securityService.validatePassword('weak');
      const medium = securityService.validatePassword('Medium123!aa');
      const strong = securityService.validatePassword('Str0ng!SecurePass');

      expect(weak.strength).toBe('weak');
      // Medium can be 'medium' or 'strong' depending on implementation
      expect(['medium', 'strong']).toContain(medium.strength);
      expect(['strong', 'very_strong']).toContain(strong.strength);
    });
  });

  // ─── Account Lockout ─────────────────────────────────────
  describe('recordFailedLogin', () => {
    it('returns remaining attempts after first failure', async () => {
      const result = await securityService.recordFailedLogin('user@example.com');

      expect(result.locked).toBe(false);
      expect(result.attemptsRemaining).toBe(4); // 5 - 1
    });

    it('locks account after max attempts', async () => {
      // Simulate 5 failed attempts
      for (let i = 0; i < 4; i++) {
        await securityService.recordFailedLogin('user@example.com');
      }

      const result = await securityService.recordFailedLogin('user@example.com');

      expect(result.locked).toBe(true);
      expect(result.attemptsRemaining).toBe(0);
      expect(result.lockoutUntil).toBeDefined();
    });

    it('records IP address in security log', async () => {
      await securityService.recordFailedLogin('user@example.com', '192.168.1.1');

      // Should have logged the security event
      expect(mockCache.put).toHaveBeenCalled();
    });
  });

  describe('isAccountLocked', () => {
    it('returns false for unknown identifier', async () => {
      const result = await securityService.isAccountLocked('unknown@example.com');

      expect(result.locked).toBe(false);
    });

    it('returns true when account is locked', async () => {
      // Lock the account first
      for (let i = 0; i < 5; i++) {
        await securityService.recordFailedLogin('locked@example.com');
      }

      const result = await securityService.isAccountLocked('locked@example.com');

      expect(result.locked).toBe(true);
      expect(result.remainingSeconds).toBeGreaterThan(0);
    });
  });

  describe('clearLoginAttempts', () => {
    it('clears login attempts from cache', async () => {
      await securityService.clearLoginAttempts('user@example.com');

      expect(mockCache.delete).toHaveBeenCalledWith('login_attempts:user@example.com');
    });
  });

  // ─── Audit Logging ───────────────────────────────────────
  describe('logAuditEvent', () => {
    it('inserts audit log entry', async () => {
      const id = await securityService.logAuditEvent({
        action: 'USER_LOGIN',
        entityType: 'user',
        entityId: 'user-123',
        userId: 'user-123',
        riskLevel: 'low',
        success: true,
      });

      expect(id).toBeDefined();
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_logs')
      );
    });

    it('caches high-risk events', async () => {
      await securityService.logAuditEvent({
        action: 'ADMIN_ACTION',
        entityType: 'system',
        riskLevel: 'high',
        success: true,
      });

      expect(mockCache.put).toHaveBeenCalledWith(
        expect.stringContaining('security_alert:'),
        expect.any(String),
        expect.any(Object)
      );
    });
  });

  // ─── Data Encryption ─────────────────────────────────────
  describe('encryptSensitiveData / decryptSensitiveData', () => {
    const encryptionKey = 'test-encryption-key-32-characters';

    it('encrypts and decrypts data correctly', async () => {
      const originalData = 'sensitive-user-data';

      const encrypted = await securityService.encryptSensitiveData(originalData, encryptionKey);
      const decrypted = await securityService.decryptSensitiveData(encrypted, encryptionKey);

      expect(encrypted).not.toBe(originalData);
      expect(decrypted).toBe(originalData);
    });

    it('produces different ciphertext for same input (random IV)', async () => {
      const data = 'same-data';

      const encrypted1 = await securityService.encryptSensitiveData(data, encryptionKey);
      const encrypted2 = await securityService.encryptSensitiveData(data, encryptionKey);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('fails to decrypt with wrong key', async () => {
      const encrypted = await securityService.encryptSensitiveData('data', encryptionKey);

      await expect(
        securityService.decryptSensitiveData(encrypted, 'wrong-key-32-characters-here!!')
      ).rejects.toThrow();
    });
  });

  // ─── Transaction Security ────────────────────────────────
  describe('generateTransactionSignature / verifyTransactionSignature', () => {
    const secretKey = 'transaction-secret-key';
    const transactionData = {
      userId: 'user-123',
      type: 'BUY',
      amount: 50000,
      timestamp: Date.now(),
    };

    it('generates signature for transaction', async () => {
      const signature = await securityService.generateTransactionSignature(
        transactionData,
        secretKey
      );

      expect(signature).toBeDefined();
      expect(typeof signature).toBe('string');
    });

    it('verifies valid signature', async () => {
      const signature = await securityService.generateTransactionSignature(
        transactionData,
        secretKey
      );

      const isValid = await securityService.verifyTransactionSignature(
        transactionData,
        signature,
        secretKey
      );

      expect(isValid).toBe(true);
    });

    it('rejects tampered data', async () => {
      const signature = await securityService.generateTransactionSignature(
        transactionData,
        secretKey
      );

      const tamperedData = { ...transactionData, amount: 100000 };
      const isValid = await securityService.verifyTransactionSignature(
        tamperedData,
        signature,
        secretKey
      );

      expect(isValid).toBe(false);
    });

    it('rejects expired signature', async () => {
      const oldTransaction = {
        ...transactionData,
        timestamp: Date.now() - 10 * 60 * 1000, // 10 minutes ago
      };
      const signature = await securityService.generateTransactionSignature(
        oldTransaction,
        secretKey
      );

      const isValid = await securityService.verifyTransactionSignature(
        oldTransaction,
        signature,
        secretKey
      );

      expect(isValid).toBe(false);
    });
  });

  describe('isHighValueTransaction', () => {
    it('returns true for transaction above threshold', async () => {
      const result = await securityService.isHighValueTransaction(2_000_000);
      expect(result).toBe(true);
    });

    it('returns false for transaction below threshold', async () => {
      const result = await securityService.isHighValueTransaction(100_000);
      expect(result).toBe(false);
    });
  });

  // ─── Rate Limiting ───────────────────────────────────────
  describe('checkRateLimit', () => {
    it('allows request within limit', async () => {
      const result = await securityService.checkRateLimit(
        'user-123',
        'sensitive_op',
        10,
        3600
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
    });

    it('blocks request when limit exceeded', async () => {
      // Exhaust the limit
      for (let i = 0; i < 10; i++) {
        await securityService.checkRateLimit('user-123', 'test_op', 10, 3600);
      }

      const result = await securityService.checkRateLimit(
        'user-123',
        'test_op',
        10,
        3600
      );

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.resetAt).toBeDefined();
    });
  });

  // ─── TOTP 2FA ────────────────────────────────────────────
  describe('generateTotpSecret', () => {
    it('generates base32 encoded secret', () => {
      const secret = securityService.generateTotpSecret();

      expect(secret).toMatch(/^[A-Z2-7]+$/);
      expect(secret.length).toBeGreaterThanOrEqual(16);
    });

    it('generates unique secrets', () => {
      const secrets = new Set();
      for (let i = 0; i < 100; i++) {
        secrets.add(securityService.generateTotpSecret());
      }
      expect(secrets.size).toBe(100);
    });
  });

  describe('generateTotpCode', () => {
    it('generates 6 digit code', async () => {
      const secret = securityService.generateTotpSecret();
      const code = await securityService.generateTotpCode(secret);

      expect(code).toMatch(/^\d{6}$/);
    });

    it('generates same code for same time window', async () => {
      const secret = securityService.generateTotpSecret();
      const timestamp = Date.now();

      const code1 = await securityService.generateTotpCode(secret, timestamp);
      const code2 = await securityService.generateTotpCode(secret, timestamp + 1000);

      expect(code1).toBe(code2);
    });

    it('generates different codes for different time windows', async () => {
      const secret = securityService.generateTotpSecret();
      const now = Date.now();

      const code1 = await securityService.generateTotpCode(secret, now);
      const code2 = await securityService.generateTotpCode(secret, now + 30000);

      expect(code1).not.toBe(code2);
    });
  });

  describe('verifyTotpCode', () => {
    it('verifies valid code', async () => {
      const secret = securityService.generateTotpSecret();
      const code = await securityService.generateTotpCode(secret);

      const isValid = await securityService.verifyTotpCode(secret, code);

      expect(isValid).toBe(true);
    });

    it('rejects invalid code', async () => {
      const secret = securityService.generateTotpSecret();

      const isValid = await securityService.verifyTotpCode(secret, '000000');

      expect(isValid).toBe(false);
    });

    it('accepts code from adjacent time window', async () => {
      const secret = securityService.generateTotpSecret();
      // Generate code for 30 seconds ago
      const code = await securityService.generateTotpCode(secret, Date.now() - 30000);

      const isValid = await securityService.verifyTotpCode(secret, code);

      expect(isValid).toBe(true);
    });
  });

  describe('generateTotpUri', () => {
    it('generates valid otpauth URI', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const email = 'user@example.com';

      const uri = await securityService.generateTotpUri(secret, email);

      expect(uri).toContain('otpauth://totp/');
      expect(uri).toContain(encodeURIComponent(email));
      expect(uri).toContain(`secret=${secret}`);
      expect(uri).toContain('algorithm=SHA1');
      expect(uri).toContain('digits=6');
      expect(uri).toContain('period=30');
    });
  });

  // ─── Password History ────────────────────────────────────
  describe('checkPasswordHistory', () => {
    it('returns true when password not in history', async () => {
      mockDb = createMockD1Database({ all: [] });
      securityService = new SecurityService(mockDb, mockCache);

      const result = await securityService.checkPasswordHistory(
        'user-123',
        'new-password-hash'
      );

      expect(result).toBe(true);
    });

    it('returns false when password was used recently', async () => {
      mockDb = createMockD1Database({
        all: [{ password_hash: 'existing-hash' }],
      });
      securityService = new SecurityService(mockDb, mockCache);

      const result = await securityService.checkPasswordHistory(
        'user-123',
        'existing-hash'
      );

      expect(result).toBe(false);
    });
  });

  describe('addPasswordToHistory', () => {
    it('inserts password hash into history', async () => {
      await securityService.addPasswordToHistory('user-123', 'new-hash');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO password_history')
      );
    });

    it('cleans up old password history', async () => {
      await securityService.addPasswordToHistory('user-123', 'new-hash');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM password_history')
      );
    });
  });
});
