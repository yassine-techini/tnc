/**
 * Auth Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthService } from '../../src/services/auth.service';

describe('AuthService', () => {
  let authService: AuthService;
  const JWT_SECRET = 'test-jwt-secret-key-at-least-32-characters-long';

  beforeEach(() => {
    authService = new AuthService(JWT_SECRET);
  });

  // ─── Constructor ─────────────────────────────────────────
  describe('constructor', () => {
    it('throws error if JWT_SECRET is not provided', () => {
      expect(() => new AuthService('')).toThrow('JWT_SECRET is required');
    });

    it('creates instance with valid JWT_SECRET', () => {
      expect(authService).toBeInstanceOf(AuthService);
    });
  });

  // ─── Password Hashing ────────────────────────────────────
  describe('hashPassword', () => {
    it('hashes password with Argon2id prefix', async () => {
      const hash = await authService.hashPassword('TestPassword123!');
      expect(hash).toMatch(/^\$argon2id\$/);
    });

    it('generates different hashes for same password (salt)', async () => {
      const hash1 = await authService.hashPassword('SamePassword123!');
      const hash2 = await authService.hashPassword('SamePassword123!');
      expect(hash1).not.toBe(hash2);
    });

    it('generates hash with correct format', async () => {
      const hash = await authService.hashPassword('TestPassword123!');
      const parts = hash.split('$');
      expect(parts.length).toBe(4); // ['', 'argon2id', salt, hash]
    });
  });

  // ─── Password Verification ───────────────────────────────
  describe('verifyPassword', () => {
    it('returns true for correct password', async () => {
      const password = 'CorrectPassword123!';
      const hash = await authService.hashPassword(password);
      const isValid = await authService.verifyPassword(password, hash);
      expect(isValid).toBe(true);
    });

    it('returns false for incorrect password', async () => {
      const hash = await authService.hashPassword('CorrectPassword123!');
      const isValid = await authService.verifyPassword('WrongPassword123!', hash);
      expect(isValid).toBe(false);
    });

    it('returns false for malformed hash', async () => {
      const isValid = await authService.verifyPassword('test', 'invalid-hash');
      expect(isValid).toBe(false);
    });
  });

  // ─── Password Verification with Rehash Check ─────────────
  describe('verifyPasswordWithRehashCheck', () => {
    it('returns valid=true, needsRehash=false for Argon2id hash', async () => {
      const password = 'TestPassword123!';
      const hash = await authService.hashPassword(password);
      const result = await authService.verifyPasswordWithRehashCheck(password, hash);
      expect(result.valid).toBe(true);
      expect(result.needsRehash).toBe(false);
    });

    it('returns valid=false for wrong password', async () => {
      const hash = await authService.hashPassword('CorrectPassword123!');
      const result = await authService.verifyPasswordWithRehashCheck('WrongPassword123!', hash);
      expect(result.valid).toBe(false);
    });
  });

  // ─── JWT Token Generation ────────────────────────────────
  describe('generateTokens', () => {
    const payload = {
      sub: 'user-123',
      email: 'test@example.com',
      kycLevel: 'BASIC' as const,
    };

    it('generates access and refresh tokens', async () => {
      const tokens = await authService.generateTokens(payload);
      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
      expect(tokens.expiresIn).toBeGreaterThan(0);
    });

    it('generates different access and refresh tokens', async () => {
      const tokens = await authService.generateTokens(payload);
      expect(tokens.accessToken).not.toBe(tokens.refreshToken);
    });

    it('generates valid JWT format', async () => {
      const tokens = await authService.generateTokens(payload);
      const parts = tokens.accessToken.split('.');
      expect(parts.length).toBe(3); // header.payload.signature
    });
  });

  // ─── JWT Token Verification ──────────────────────────────
  describe('verifyToken', () => {
    const payload = {
      sub: 'user-123',
      email: 'test@example.com',
      kycLevel: 'BASIC' as const,
    };

    it('verifies valid access token', async () => {
      const tokens = await authService.generateTokens(payload);
      const verified = await authService.verifyToken(tokens.accessToken);
      expect(verified).not.toBeNull();
      expect(verified?.sub).toBe(payload.sub);
      expect(verified?.email).toBe(payload.email);
      expect(verified?.type).toBe('access');
    });

    it('verifies valid refresh token', async () => {
      const tokens = await authService.generateTokens(payload);
      const verified = await authService.verifyToken(tokens.refreshToken);
      expect(verified).not.toBeNull();
      expect(verified?.type).toBe('refresh');
    });

    it('returns null for invalid token', async () => {
      const verified = await authService.verifyToken('invalid.token.here');
      expect(verified).toBeNull();
    });

    it('returns null for expired token', async () => {
      // Mock time to create expired token
      vi.useFakeTimers();
      const tokens = await authService.generateTokens(payload);

      // Fast forward past expiry
      vi.advanceTimersByTime(20 * 60 * 1000); // 20 minutes

      const verified = await authService.verifyToken(tokens.accessToken);
      expect(verified).toBeNull();

      vi.useRealTimers();
    });

    it('returns null for tampered token', async () => {
      const tokens = await authService.generateTokens(payload);
      const tampered = tokens.accessToken.slice(0, -10) + 'tampered!!';
      const verified = await authService.verifyToken(tampered);
      expect(verified).toBeNull();
    });
  });

  // ─── Refresh Token ───────────────────────────────────────
  describe('refreshAccessToken', () => {
    const payload = {
      sub: 'user-123',
      email: 'test@example.com',
      kycLevel: 'STANDARD' as const,
    };

    it('generates new tokens from valid refresh token', async () => {
      const original = await authService.generateTokens(payload);
      const refreshed = await authService.refreshAccessToken(original.refreshToken);

      expect(refreshed).not.toBeNull();
      expect(refreshed?.accessToken).toBeDefined();
      expect(refreshed?.refreshToken).toBeDefined();
      expect(refreshed?.accessToken).not.toBe(original.accessToken);
    });

    it('returns null when using access token', async () => {
      const tokens = await authService.generateTokens(payload);
      const refreshed = await authService.refreshAccessToken(tokens.accessToken);
      expect(refreshed).toBeNull();
    });

    it('returns null for invalid token', async () => {
      const refreshed = await authService.refreshAccessToken('invalid-token');
      expect(refreshed).toBeNull();
    });
  });

  // ─── Verification Code ───────────────────────────────────
  describe('generateVerificationCode', () => {
    it('generates 6 digit code by default', () => {
      const code = authService.generateVerificationCode();
      expect(code).toMatch(/^\d{6}$/);
    });

    it('generates code with custom length', () => {
      const code = authService.generateVerificationCode(4);
      expect(code).toMatch(/^\d{4}$/);
    });

    it('generates different codes each time', () => {
      const codes = new Set();
      for (let i = 0; i < 100; i++) {
        codes.add(authService.generateVerificationCode());
      }
      // Should have many unique codes (collision probability is low)
      expect(codes.size).toBeGreaterThan(90);
    });
  });

  // ─── Session ID ──────────────────────────────────────────
  describe('generateSessionId', () => {
    it('generates 64 character hex string', () => {
      const sessionId = authService.generateSessionId();
      expect(sessionId).toMatch(/^[a-f0-9]{64}$/);
    });

    it('generates unique session IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(authService.generateSessionId());
      }
      expect(ids.size).toBe(100);
    });
  });
});
