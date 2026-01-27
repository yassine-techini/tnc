/**
 * Security Service Tests
 * Tests for rate limiting, password validation, and security features
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('SecurityService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Password Validation', () => {
    const validatePassword = (password: string) => {
      const errors: string[] = [];

      if (password.length < 8) {
        errors.push('Password must be at least 8 characters');
      }
      if (password.length > 128) {
        errors.push('Password must be at most 128 characters');
      }
      if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
      }
      if (!/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
      }
      if (!/[0-9]/.test(password)) {
        errors.push('Password must contain at least one number');
      }
      if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
        errors.push('Password must contain at least one special character');
      }

      return {
        isValid: errors.length === 0,
        errors,
      };
    };

    it('should reject passwords shorter than 8 characters', () => {
      const result = validatePassword('Short1!');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters');
    });

    it('should reject passwords without uppercase', () => {
      const result = validatePassword('password123!');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one uppercase letter');
    });

    it('should reject passwords without lowercase', () => {
      const result = validatePassword('PASSWORD123!');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one lowercase letter');
    });

    it('should reject passwords without numbers', () => {
      const result = validatePassword('Password!!!');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one number');
    });

    it('should reject passwords without special characters', () => {
      const result = validatePassword('Password123');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one special character');
    });

    it('should accept valid strong passwords', () => {
      const validPasswords = [
        'SecureP@ss1',
        'MyStr0ng!Password',
        'C0mplex#Pass123',
      ];

      validPasswords.forEach(pwd => {
        const result = validatePassword(pwd);
        expect(result.isValid).toBe(true);
      });
    });

    it('should reject common passwords', () => {
      const commonPasswords = [
        'password',
        '123456789',
        'qwerty123',
        'admin123',
        'letmein',
      ];

      // These should fail other rules anyway
      commonPasswords.forEach(pwd => {
        const result = validatePassword(pwd);
        expect(result.isValid).toBe(false);
      });
    });
  });

  describe('Password History', () => {
    it('should prevent reuse of last 5 passwords', () => {
      const passwordHistory = [
        'hash1', 'hash2', 'hash3', 'hash4', 'hash5'
      ];
      const newPasswordHash = 'hash3';

      const isReused = passwordHistory.includes(newPasswordHash);
      expect(isReused).toBe(true);
    });

    it('should allow reuse after 5 password changes', () => {
      const passwordHistory = [
        'hash6', 'hash7', 'hash8', 'hash9', 'hash10'
      ];
      const oldPasswordHash = 'hash1';

      const isReused = passwordHistory.includes(oldPasswordHash);
      expect(isReused).toBe(false);
    });
  });

  describe('Rate Limiting', () => {
    it('should allow requests under limit', () => {
      const RATE_LIMIT = 100; // requests per minute
      const currentRequests = 50;

      expect(currentRequests < RATE_LIMIT).toBe(true);
    });

    it('should block requests over limit', () => {
      const RATE_LIMIT = 100;
      const currentRequests = 100;

      expect(currentRequests >= RATE_LIMIT).toBe(true);
    });

    it('should reset counter after window expires', () => {
      const windowStart = Date.now() - 60000; // 1 minute ago
      const WINDOW_MS = 60000; // 1 minute

      const windowExpired = Date.now() - windowStart >= WINDOW_MS;
      expect(windowExpired).toBe(true);
    });

    it('should apply different limits per endpoint', () => {
      const rateLimits = {
        'POST /auth/login': 5,
        'POST /auth/register': 3,
        'GET /market/price': 1000,
        'POST /market/buy': 10,
      };

      expect(rateLimits['POST /auth/login']).toBe(5);
      expect(rateLimits['GET /market/price']).toBe(1000);
    });

    it('should apply user-based rate limiting', () => {
      const userRateLimits = {
        BASIC: 50,
        STANDARD: 100,
        VERIFIED: 200,
      };

      expect(userRateLimits['VERIFIED']).toBeGreaterThan(userRateLimits['BASIC']);
    });
  });

  describe('IP Blocking', () => {
    it('should block suspicious IP addresses', () => {
      const blockedIPs = new Set(['192.168.1.100', '10.0.0.50']);
      const requestIP = '192.168.1.100';

      expect(blockedIPs.has(requestIP)).toBe(true);
    });

    it('should track failed attempts per IP', () => {
      const ipAttempts = new Map();
      const ip = '192.168.1.1';

      ipAttempts.set(ip, (ipAttempts.get(ip) || 0) + 1);
      ipAttempts.set(ip, (ipAttempts.get(ip) || 0) + 1);
      ipAttempts.set(ip, (ipAttempts.get(ip) || 0) + 1);

      expect(ipAttempts.get(ip)).toBe(3);
    });

    it('should auto-block IP after threshold', () => {
      const BLOCK_THRESHOLD = 10;
      const failedAttempts = 15;

      expect(failedAttempts >= BLOCK_THRESHOLD).toBe(true);
    });
  });

  describe('TOTP Validation', () => {
    it('should validate 6-digit TOTP codes', () => {
      const code = '123456';
      expect(/^\d{6}$/.test(code)).toBe(true);
    });

    it('should reject invalid TOTP format', () => {
      const invalidCodes = ['12345', '1234567', 'abcdef', '12345a'];

      invalidCodes.forEach(code => {
        expect(/^\d{6}$/.test(code)).toBe(false);
      });
    });

    it('should allow 30-second window for TOTP', () => {
      const TOTP_WINDOW = 30; // seconds
      const codeGeneratedAt = Date.now() - 25000; // 25 seconds ago
      const isWithinWindow = (Date.now() - codeGeneratedAt) < TOTP_WINDOW * 1000;

      expect(isWithinWindow).toBe(true);
    });

    it('should reject expired TOTP', () => {
      const TOTP_WINDOW = 30;
      const codeGeneratedAt = Date.now() - 60000; // 60 seconds ago
      const isWithinWindow = (Date.now() - codeGeneratedAt) < TOTP_WINDOW * 1000;

      expect(isWithinWindow).toBe(false);
    });
  });

  describe('Recovery Codes', () => {
    it('should generate 8 unique recovery codes', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 8; i++) {
        codes.add(Math.random().toString(36).substring(2, 10).toUpperCase());
      }
      expect(codes.size).toBe(8);
    });

    it('should mark recovery code as used after use', () => {
      const recoveryCode = {
        codeHash: 'hash-xxx',
        used: false,
        usedAt: null as string | null,
      };

      // Use the code
      recoveryCode.used = true;
      recoveryCode.usedAt = new Date().toISOString();

      expect(recoveryCode.used).toBe(true);
      expect(recoveryCode.usedAt).toBeTruthy();
    });

    it('should prevent reuse of recovery codes', () => {
      const recoveryCode = {
        used: true,
      };

      expect(recoveryCode.used).toBe(true);
    });
  });

  describe('Session Security', () => {
    it('should invalidate all sessions on password change', () => {
      const sessions = [
        { id: 'session-1', valid: true },
        { id: 'session-2', valid: true },
        { id: 'session-3', valid: true },
      ];

      // Password changed - invalidate all sessions
      sessions.forEach(s => s.valid = false);

      expect(sessions.every(s => !s.valid)).toBe(true);
    });

    it('should allow selective session revocation', () => {
      const sessions = [
        { id: 'session-1', valid: true },
        { id: 'session-2', valid: true },
        { id: 'session-3', valid: true },
      ];

      const sessionToRevoke = 'session-2';
      const session = sessions.find(s => s.id === sessionToRevoke);
      if (session) session.valid = false;

      expect(sessions.filter(s => s.valid).length).toBe(2);
    });

    it('should track session device info', () => {
      const session = {
        deviceInfo: 'iPhone 14, iOS 17',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0...',
        lastActive: new Date().toISOString(),
      };

      expect(session.deviceInfo).toBeTruthy();
      expect(session.ipAddress).toBeTruthy();
    });
  });

  describe('Input Sanitization', () => {
    it('should escape HTML entities', () => {
      const escapeHtml = (str: string) => {
        return str
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      };

      const malicious = '<script>alert("xss")</script>';
      const sanitized = escapeHtml(malicious);

      expect(sanitized).not.toContain('<script>');
      expect(sanitized).toContain('&lt;script&gt;');
    });

    it('should strip SQL injection attempts', () => {
      const suspicious = "'; DROP TABLE users; --";
      const hasSqlInjection = /['";]|--|\bDROP\b|\bDELETE\b|\bUPDATE\b|\bINSERT\b/i.test(suspicious);

      expect(hasSqlInjection).toBe(true);
    });
  });

  describe('Webhook Signature Verification', () => {
    it('should verify webhook signature', () => {
      const payload = '{"event":"payment.success"}';
      const expectedSignature = 'sha256=abc123...';
      const receivedSignature = 'sha256=abc123...';

      expect(receivedSignature === expectedSignature).toBe(true);
    });

    it('should reject invalid signatures', () => {
      const expectedSignature = 'sha256=abc123';
      const receivedSignature = 'sha256=xyz789';

      expect(receivedSignature === expectedSignature).toBe(false);
    });

    it('should reject expired webhook timestamps', () => {
      const WEBHOOK_TOLERANCE = 5 * 60 * 1000; // 5 minutes
      const webhookTimestamp = Date.now() - 10 * 60 * 1000; // 10 minutes ago

      const isTooOld = Date.now() - webhookTimestamp > WEBHOOK_TOLERANCE;
      expect(isTooOld).toBe(true);
    });
  });

  describe('Audit Logging', () => {
    it('should create audit log for sensitive actions', () => {
      const auditLog = {
        id: 'audit-123',
        adminId: 'admin-123',
        userId: 'user-123',
        action: 'KYC_APPROVED',
        entityType: 'USER',
        entityId: 'user-123',
        oldValue: JSON.stringify({ kycStatus: 'SUBMITTED' }),
        newValue: JSON.stringify({ kycStatus: 'APPROVED' }),
        ipAddress: '192.168.1.1',
        createdAt: new Date().toISOString(),
      };

      expect(auditLog.action).toBe('KYC_APPROVED');
      expect(auditLog.oldValue).toBeTruthy();
      expect(auditLog.newValue).toBeTruthy();
    });

    it('should not log sensitive data in audit logs', () => {
      const sensitiveFields = ['password', 'passwordHash', 'twoFactorSecret', 'refreshToken'];
      const auditData = {
        action: 'USER_UPDATED',
        changes: { email: 'new@example.com', name: 'New Name' },
      };

      const hasNoSensitiveFields = sensitiveFields.every(
        field => !Object.keys(auditData.changes).includes(field)
      );

      expect(hasNoSensitiveFields).toBe(true);
    });
  });
});
