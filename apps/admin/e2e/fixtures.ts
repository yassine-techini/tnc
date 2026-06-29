import type { Page } from '@playwright/test';

/**
 * Mock API response for a specific endpoint
 */
export async function mockApiResponse(page: Page, url: string, response: Record<string, unknown>) {
  await page.route(url, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });
}

/**
 * Mock authenticated admin session
 */
export async function mockAuthenticatedAdmin(page: Page) {
  // Set localStorage for admin auth state
  await page.addInitScript(() => {
    localStorage.setItem('tnc-admin-auth', JSON.stringify({
      state: {
        user: {
          id: 'admin-1',
          email: 'admin@tnc.trading',
          name: 'Admin Test',
          role: 'SUPER_ADMIN',
        },
        permissions: {
          users: ['read', 'write', 'delete'],
          transactions: ['read'],
          stock: ['read', 'write'],
          kyc: ['read', 'write'],
          withdrawals: ['read', 'write'],
          admins: ['read', 'write', 'delete'],
          config: ['read', 'write'],
          integrations: ['read', 'write'],
          analytics: ['read'],
          audit: ['read'],
        },
        isAuthenticated: true,
        lastActivity: Date.now(),
      },
      version: 0,
    }));
  });

  // Mock common API endpoints
  await mockApiResponse(page, '**/api/v1/admin/dashboard', {
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
    requestId: 'test',
  });

  await mockApiResponse(page, '**/api/v1/market/price', {
    success: true,
    data: {
      lbmaUsd: 85.50,
      priceXof: 52600,
      buyPrice: 53652,
      sellPrice: 51548,
      spreadBuy: 0.02,
      spreadSell: 0.02,
      exchangeRate: 615,
      change24h: 0.5,
      updatedAt: new Date().toISOString(),
    },
    requestId: 'test',
  });
}

/**
 * Mock admin login flow
 */
export async function mockAdminLogin(page: Page) {
  await mockApiResponse(page, '**/api/v1/admin/login', {
    success: true,
    data: {
      user: {
        id: 'admin-1',
        email: 'admin@tnc.trading',
        name: 'Admin Test',
        role: 'SUPER_ADMIN',
        permissions: {
          users: ['read', 'write', 'delete'],
          transactions: ['read'],
          stock: ['read', 'write'],
        },
        twoFactorEnabled: true,
      },
      tokens: {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresIn: 900,
      },
    },
    requestId: 'test',
  });
}
