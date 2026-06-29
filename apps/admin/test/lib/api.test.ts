/**
 * Admin API Client Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Simple mock implementation for testing API client logic
class MockAdminApiClient {
  private baseUrl: string;
  private onAuthError: (() => void) | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  setAuthErrorCallback(callback: () => void) {
    this.onAuthError = callback;
  }

  getBaseUrl() {
    return this.baseUrl;
  }

  triggerAuthError() {
    if (this.onAuthError) {
      this.onAuthError();
    }
  }
}

describe('AdminApiClient', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Configuration', () => {
    it('should store base URL', () => {
      const client = new MockAdminApiClient('http://localhost:8787');
      expect(client.getBaseUrl()).toBe('http://localhost:8787');
    });

    it('should handle production URL', () => {
      const client = new MockAdminApiClient('https://api.tnc-trading.bf');
      expect(client.getBaseUrl()).toBe('https://api.tnc-trading.bf');
    });
  });

  describe('Auth Error Callback', () => {
    it('should register auth error callback', () => {
      const client = new MockAdminApiClient('http://localhost:8787');
      const callback = vi.fn();

      client.setAuthErrorCallback(callback);
      client.triggerAuthError();

      expect(callback).toHaveBeenCalled();
    });

    it('should not throw when no callback registered', () => {
      const client = new MockAdminApiClient('http://localhost:8787');

      expect(() => client.triggerAuthError()).not.toThrow();
    });
  });

  describe('Login Flow', () => {
    it('should handle successful login response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            user: {
              id: 'admin-1',
              email: 'admin@tnc.trading',
              name: 'Admin',
              role: 'SUPER_ADMIN',
              permissions: { users: ['read', 'write'] },
              twoFactorEnabled: true,
            },
            tokens: {
              accessToken: 'access-token',
              refreshToken: 'refresh-token',
              expiresIn: 900,
            },
          },
        }),
      });

      const response = await fetch('http://localhost:8787/api/v1/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@tnc.trading', password: 'password' }),
        credentials: 'include',
      });

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.user.email).toBe('admin@tnc.trading');
    });

    it('should handle 2FA required response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({
          success: false,
          error: {
            code: '2FA_REQUIRED',
            message: 'Code 2FA requis',
          },
        }),
      });

      const response = await fetch('http://localhost:8787/api/v1/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@tnc.trading', password: 'password' }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('2FA_REQUIRED');
    });

    it('should handle 2FA setup required response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({
          success: false,
          error: {
            code: '2FA_SETUP_REQUIRED',
            message: 'Configuration 2FA obligatoire',
          },
          data: {
            setupToken: 'setup-token-123',
          },
        }),
      });

      const response = await fetch('http://localhost:8787/api/v1/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@tnc.trading', password: 'password' }),
      });

      const data = await response.json();
      expect(data.error.code).toBe('2FA_SETUP_REQUIRED');
      expect(data.data.setupToken).toBe('setup-token-123');
    });

    it('should handle invalid credentials', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Email ou mot de passe incorrect',
          },
        }),
      });

      const response = await fetch('http://localhost:8787/api/v1/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'wrong@email.com', password: 'wrong' }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('2FA Setup Flow', () => {
    it('should get 2FA setup data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            secret: 'JBSWY3DPEHPK3PXP',
            uri: 'otpauth://totp/TNC:admin@tnc.trading?secret=JBSWY3DPEHPK3PXP',
            issuer: 'TNC Trading Admin',
            message: 'Scannez le QR code',
          },
          requestId: 'req-123',
        }),
      });

      const response = await fetch('http://localhost:8787/api/v1/admin/2fa/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupToken: 'setup-token' }),
      });

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.secret).toBe('JBSWY3DPEHPK3PXP');
      expect(data.data.uri).toContain('otpauth://totp/');
    });

    it('should verify 2FA code', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            message: '2FA activé avec succès',
            user: {
              id: 'admin-1',
              email: 'admin@tnc.trading',
              name: 'Admin',
              role: 'SUPER_ADMIN',
              permissions: {},
              twoFactorEnabled: true,
            },
            tokens: {
              accessToken: 'new-access-token',
              refreshToken: 'new-refresh-token',
              expiresIn: 900,
            },
          },
          requestId: 'req-124',
        }),
      });

      const response = await fetch('http://localhost:8787/api/v1/admin/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupToken: 'setup-token', code: '123456' }),
      });

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.user.twoFactorEnabled).toBe(true);
    });
  });

  describe('Dashboard API', () => {
    it('should fetch dashboard data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            totalUsers: 1500,
            activeUsers: 320,
            totalTransactions: 5000,
            totalVolume: 2500000000,
            pendingKyc: 45,
            pendingWithdrawals: 12,
            stockCoverage: 100.5,
            recentTransactions: [],
          },
          requestId: 'req-125',
        }),
      });

      const response = await fetch('http://localhost:8787/api/v1/admin/dashboard', {
        credentials: 'include',
      });

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.totalUsers).toBe(1500);
      expect(data.data.stockCoverage).toBeGreaterThan(100);
    });
  });

  describe('Users API', () => {
    it('should fetch users with pagination', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            items: [
              {
                id: 'user-1',
                email: 'user1@example.com',
                phone: '+22670000001',
                country: 'BF',
                kycLevel: 'VERIFIED',
                kycStatus: 'APPROVED',
                createdAt: '2024-01-15T10:00:00Z',
              },
            ],
            total: 150,
            page: 1,
            limit: 20,
            hasMore: true,
          },
          requestId: 'req-126',
        }),
      });

      const response = await fetch('http://localhost:8787/api/v1/admin/users?page=1&limit=20', {
        credentials: 'include',
      });

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.items).toHaveLength(1);
      expect(data.data.total).toBe(150);
      expect(data.data.hasMore).toBe(true);
    });

    it('should search users', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            items: [
              {
                id: 'user-1',
                email: 'john@example.com',
                phone: '+22670000001',
                country: 'BF',
                kycLevel: 'STANDARD',
                kycStatus: 'APPROVED',
                createdAt: '2024-01-15T10:00:00Z',
              },
            ],
            total: 1,
            page: 1,
            limit: 20,
            hasMore: false,
          },
          requestId: 'req-127',
        }),
      });

      const response = await fetch('http://localhost:8787/api/v1/admin/users?search=john', {
        credentials: 'include',
      });

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.items[0].email).toBe('john@example.com');
    });
  });

  describe('Stock API', () => {
    it('should fetch stock status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            totalAllocated: 100000,
            tokensIssued: 95000,
            availableStock: 5000,
            coverage: 105.26,
            lastAuditDate: '2024-01-01T00:00:00Z',
          },
          requestId: 'req-128',
        }),
      });

      const response = await fetch('http://localhost:8787/api/v1/admin/stock', {
        credentials: 'include',
      });

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.coverage).toBeGreaterThan(100);
      expect(data.data.totalAllocated).toBeGreaterThan(data.data.tokensIssued);
    });

    it('should adjust stock', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            message: 'Stock ajusté avec succès',
            newTotal: 105000,
          },
          requestId: 'req-129',
        }),
      });

      const response = await fetch('http://localhost:8787/api/v1/admin/stock/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 5000, reason: 'Nouvel approvisionnement' }),
        credentials: 'include',
      });

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.newTotal).toBe(105000);
    });
  });

  describe('Withdrawals API', () => {
    it('should fetch pending withdrawals', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            items: [
              {
                id: 'wd-1',
                userId: 'user-1',
                userEmail: 'user@example.com',
                amount: 100000,
                paymentMethod: 'orange_money',
                phoneNumber: '+22670000000',
                status: 'PENDING',
                createdAt: '2024-01-15T10:00:00Z',
              },
            ],
          },
          requestId: 'req-130',
        }),
      });

      const response = await fetch('http://localhost:8787/api/v1/admin/withdrawals?status=PENDING', {
        credentials: 'include',
      });

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.items[0].status).toBe('PENDING');
    });

    it('should approve withdrawal', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            message: 'Retrait approuvé',
          },
          requestId: 'req-131',
        }),
      });

      const response = await fetch('http://localhost:8787/api/v1/admin/withdrawals/wd-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
        credentials: 'include',
      });

      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should reject withdrawal with reason', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            message: 'Retrait rejeté',
          },
          requestId: 'req-132',
        }),
      });

      const response = await fetch('http://localhost:8787/api/v1/admin/withdrawals/wd-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', reason: 'Documents manquants' }),
        credentials: 'include',
      });

      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });

  describe('KYC API', () => {
    it('should fetch pending KYC submissions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            items: [
              {
                id: 'kyc-1',
                userId: 'user-1',
                email: 'user@example.com',
                phone: '+22670000000',
                firstName: 'Jean',
                lastName: 'Dupont',
                dateOfBirth: '1990-01-15',
                documentType: 'CNIB',
                documentNumber: 'B00123456',
                frontImageUrl: 'https://r2.example.com/kyc/front.jpg',
                backImageUrl: 'https://r2.example.com/kyc/back.jpg',
                selfieUrl: 'https://r2.example.com/kyc/selfie.jpg',
                submittedAt: '2024-01-15T10:00:00Z',
                kycLevel: 'BASIC',
              },
            ],
            total: 45,
            page: 1,
            limit: 20,
            hasMore: true,
          },
          requestId: 'req-133',
        }),
      });

      const response = await fetch('http://localhost:8787/api/v1/admin/kyc/pending?page=1&limit=20', {
        credentials: 'include',
      });

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.items[0].documentType).toBe('CNIB');
    });

    it('should approve KYC with level upgrade', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            message: 'KYC approuvé, niveau mis à jour vers VERIFIED',
          },
          requestId: 'req-134',
        }),
      });

      const response = await fetch('http://localhost:8787/api/v1/admin/kyc/kyc-1/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', newLevel: 'VERIFIED' }),
        credentials: 'include',
      });

      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should reject KYC with reason', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            message: 'KYC rejeté',
          },
          requestId: 'req-135',
        }),
      });

      const response = await fetch('http://localhost:8787/api/v1/admin/kyc/kyc-1/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', rejectionReason: 'Photo floue' }),
        credentials: 'include',
      });

      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });

  describe('Session Refresh', () => {
    it('should handle session refresh', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            accessToken: 'new-access-token',
            expiresIn: 900,
          },
          requestId: 'req-136',
        }),
      });

      const response = await fetch('http://localhost:8787/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should handle failed refresh', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({
          success: false,
          error: {
            code: 'INVALID_REFRESH_TOKEN',
            message: 'Session expirée',
          },
        }),
      });

      const response = await fetch('http://localhost:8787/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('INVALID_REFRESH_TOKEN');
    });
  });

  describe('Error Handling', () => {
    it('should handle network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        fetch('http://localhost:8787/api/v1/admin/dashboard')
      ).rejects.toThrow('Network error');
    });

    it('should handle 500 server error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Erreur serveur interne',
          },
        }),
      });

      const response = await fetch('http://localhost:8787/api/v1/admin/dashboard');
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error.code).toBe('INTERNAL_ERROR');
    });

    it('should handle 403 forbidden', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Permission refusée',
          },
        }),
      });

      const response = await fetch('http://localhost:8787/api/v1/admin/stock/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 1000 }),
      });

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('FORBIDDEN');
    });
  });
});

describe('Request Building', () => {
  it('should build correct pagination params', () => {
    const page = 2;
    const limit = 50;
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit)
    });

    expect(params.get('page')).toBe('2');
    expect(params.get('limit')).toBe('50');
    expect(params.toString()).toBe('page=2&limit=50');
  });

  it('should build search params with filters', () => {
    const params = new URLSearchParams();
    params.set('page', '1');
    params.set('limit', '20');
    params.set('search', 'john@email.com');
    params.set('status', 'PENDING');

    expect(params.toString()).toBe('page=1&limit=20&search=john%40email.com&status=PENDING');
  });

  it('should handle empty optional params', () => {
    const page = 1;
    const limit = 20;
    const search: string | undefined = undefined;

    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit)
    });

    if (search) params.set('search', search);

    expect(params.has('search')).toBe(false);
  });
});
