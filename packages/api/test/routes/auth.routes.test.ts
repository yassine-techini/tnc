/**
 * Auth Routes Integration Tests
 * Full HTTP request/response cycle testing
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { authRoutes } from '../../src/routes/auth';
import type { AppEnv } from '../../src/types/env';
import { createMockD1Database, createMockKVNamespace, createMockEnv, testData } from '../setup';

describe('Auth Routes', () => {
  let app: Hono<AppEnv>;
  let mockEnv: ReturnType<typeof createMockEnv>;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create fresh mock environment
    mockEnv = createMockEnv();

    // Create test app with auth routes
    app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      // Inject mock environment - ensure c.env is initialized
      if (!c.env) {
        (c as any).env = {};
      }
      for (const [key, value] of Object.entries(mockEnv)) {
        (c.env as any)[key] = value;
      }
      return next();
    });
    app.route('/auth', authRoutes);
  });

  // ─── Health Check ───────────────────────────────────────
  describe('Basic Route Setup', () => {
    it('auth routes are mounted', async () => {
      const res = await app.request('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      // Should get validation error, not 404
      expect(res.status).not.toBe(404);
    });
  });

  // ─── Registration ───────────────────────────────────────
  describe('POST /auth/register', () => {
    it('rejects registration with invalid email', async () => {
      const res = await app.request('/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({
          email: 'invalid-email',
          phone: '+22670000000',
          password: 'SecureP@ssword123!',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it('rejects registration with short password', async () => {
      const res = await app.request('/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({
          email: 'test@example.com',
          phone: '+22670000000',
          password: 'short',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('rejects registration with invalid phone format', async () => {
      const res = await app.request('/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({
          email: 'test@example.com',
          phone: '123',
          password: 'SecureP@ssword123!',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('rejects duplicate email registration', async () => {
      // Setup mock to return existing user
      const existingUser = testData.user({ email: 'existing@example.com' });
      mockEnv.DB = createMockD1Database({ first: existingUser });

      const res = await app.request('/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({
          email: 'existing@example.com',
          phone: '+22670000000',
          password: 'SecureP@ssword123!',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('AUTH_EMAIL_EXISTS');
    });
  });

  // ─── Login ──────────────────────────────────────────────
  describe('POST /auth/login', () => {
    it('rejects login with missing credentials', async () => {
      const res = await app.request('/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('rejects login with empty password', async () => {
      const res = await app.request('/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({
          identifier: 'test@example.com',
          password: '',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('rejects login with non-existent user', async () => {
      // Mock database returns null for user lookup
      mockEnv.DB = createMockD1Database({ first: null });

      const res = await app.request('/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({
          identifier: 'nonexistent@example.com',
          password: 'SomePassword123!',
        }),
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });
  });

  // ─── Token Refresh ──────────────────────────────────────
  describe('POST /auth/refresh', () => {
    it('rejects refresh without token', async () => {
      const res = await app.request('/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('AUTH_REFRESH_TOKEN_REQUIRED');
    });

    it('rejects invalid refresh token', async () => {
      const res = await app.request('/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({
          refreshToken: 'invalid-token',
        }),
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe('AUTH_INVALID_REFRESH_TOKEN');
    });
  });

  // ─── Logout ─────────────────────────────────────────────
  describe('POST /auth/logout', () => {
    it('returns success even without token', async () => {
      const res = await app.request('/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });
  });

  // ─── Email Verification ─────────────────────────────────
  describe('POST /auth/verify-email', () => {
    it('rejects invalid verification code', async () => {
      // No code in cache
      mockEnv.CACHE = createMockKVNamespace({});

      const res = await app.request('/auth/verify-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({
          email: 'test@example.com',
          code: '123456',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('AUTH_INVALID_CODE');
    });

    it('rejects code with invalid format', async () => {
      const res = await app.request('/auth/verify-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({
          email: 'test@example.com',
          code: '12345', // Only 5 digits
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── Phone Verification ─────────────────────────────────
  describe('POST /auth/verify-phone', () => {
    it('rejects invalid phone verification code', async () => {
      mockEnv.CACHE = createMockKVNamespace({});

      const res = await app.request('/auth/verify-phone', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({
          phone: '+22670000000',
          code: '123456',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('AUTH_INVALID_CODE');
    });
  });

  // ─── Forgot Password ────────────────────────────────────
  describe('POST /auth/forgot-password', () => {
    it('returns success for any email (prevents enumeration)', async () => {
      mockEnv.DB = createMockD1Database({ first: null });

      const res = await app.request('/auth/forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({
          email: 'nonexistent@example.com',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('rejects invalid email format', async () => {
      const res = await app.request('/auth/forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({
          email: 'invalid-email',
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── Reset Password ─────────────────────────────────────
  describe('POST /auth/reset-password', () => {
    it('rejects invalid reset token', async () => {
      mockEnv.CACHE = createMockKVNamespace({});

      const res = await app.request('/auth/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({
          token: 'invalid-token',
          password: 'NewSecureP@ss123!',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('AUTH_INVALID_RESET_TOKEN');
    });

    it('rejects weak password', async () => {
      // Valid token in cache
      mockEnv.CACHE = createMockKVNamespace({
        'reset:valid-token': JSON.stringify({
          userId: 'user-123',
          email: 'test@example.com',
          createdAt: Date.now(),
        }),
      });

      const res = await app.request('/auth/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({
          token: 'valid-token',
          password: 'weak',
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── 2FA Setup ──────────────────────────────────────────
  describe('POST /auth/2fa/setup', () => {
    it('rejects setup without authentication', async () => {
      const res = await app.request('/auth/2fa/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({
          password: 'TestPassword123!',
        }),
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe('AUTH_REQUIRED');
    });
  });

  // ─── 2FA Verify ─────────────────────────────────────────
  describe('POST /auth/2fa/verify', () => {
    it('rejects verification without authentication', async () => {
      const res = await app.request('/auth/2fa/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({
          code: '123456',
          secret: 'JBSWY3DPEHPK3PXP',
        }),
      });

      expect(res.status).toBe(401);
    });
  });

  // ─── 2FA Disable ────────────────────────────────────────
  describe('POST /auth/2fa/disable', () => {
    it('rejects disable without authentication', async () => {
      const res = await app.request('/auth/2fa/disable', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({
          password: 'TestPassword123!',
          code: '123456',
        }),
      });

      expect(res.status).toBe(401);
    });
  });

  // ─── Sessions ───────────────────────────────────────────
  describe('GET /auth/sessions', () => {
    it('rejects without authentication', async () => {
      const res = await app.request('/auth/sessions', {
        method: 'GET',
        headers: {
          'Origin': 'http://localhost:5173',
        },
      });

      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /auth/sessions/:id', () => {
    it('rejects without authentication', async () => {
      const res = await app.request('/auth/sessions/session-123', {
        method: 'DELETE',
        headers: {
          'Origin': 'http://localhost:5173',
        },
      });

      expect(res.status).toBe(401);
    });
  });

  // ─── Resend Code ────────────────────────────────────────
  describe('POST /auth/resend-code', () => {
    it('accepts valid resend request', async () => {
      mockEnv.DB = createMockD1Database({ first: null });

      const res = await app.request('/auth/resend-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({
          type: 'email',
          identifier: 'test@example.com',
        }),
      });

      // Should succeed even for non-existent user (prevents enumeration)
      expect(res.status).toBe(200);
    });

    it('rejects invalid type', async () => {
      const res = await app.request('/auth/resend-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({
          type: 'invalid',
          identifier: 'test@example.com',
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── Passwordless Authentication ────────────────────────
  describe('POST /auth/passwordless/request', () => {
    it('accepts passwordless request', async () => {
      mockEnv.DB = createMockD1Database({ first: null });

      const res = await app.request('/auth/passwordless/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({
          identifier: 'test@example.com',
          method: 'email',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });
  });

  describe('POST /auth/passwordless/verify', () => {
    it('rejects invalid passwordless code', async () => {
      mockEnv.CACHE = createMockKVNamespace({});

      const res = await app.request('/auth/passwordless/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:5173',
        },
        body: JSON.stringify({
          identifier: 'test@example.com',
          code: '123456',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('AUTH_INVALID_CODE');
    });
  });
});
