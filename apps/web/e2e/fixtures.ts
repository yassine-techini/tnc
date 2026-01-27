import { test as base, expect } from '@playwright/test';

// Test user credentials
export const TEST_USER = {
  email: 'e2e.test@tnc-trading.com',
  phone: '+22670000001',
  password: 'Test123!@#',
};

export const TEST_USER_VERIFIED = {
  email: 'e2e.verified@tnc-trading.com',
  phone: '+22670000002',
  password: 'Test123!@#',
  kycLevel: 'VERIFIED',
};

// Custom fixtures
type TestFixtures = {
  authenticatedPage: ReturnType<typeof base.extend>;
};

// Extended test with authentication helper
export const test = base.extend<TestFixtures>({
  // eslint-disable-next-line no-empty-pattern
  authenticatedPage: async ({ page }, use) => {
    // Navigate to login
    await page.goto('/login');

    // Fill login form
    await page.fill('input[type="email"], input[placeholder*="email"]', TEST_USER.email);
    await page.fill('input[type="password"]', TEST_USER.password);

    // Submit
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    await use(page);
  },
});

// Re-export expect
export { expect };

// Helper functions
export async function login(page: ReturnType<typeof base.page>, user = TEST_USER) {
  await page.goto('/login');
  await page.fill('input[type="email"], input[placeholder*="email"]', user.email);
  await page.fill('input[type="password"]', user.password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 10000 });
}

export async function logout(page: ReturnType<typeof base.page>) {
  // Click user menu or logout button
  const logoutBtn = page.locator('button:has-text("Deconnexion"), a:has-text("Deconnexion")');
  if (await logoutBtn.isVisible()) {
    await logoutBtn.click();
  }
}

export async function waitForApiResponse(page: ReturnType<typeof base.page>, urlPattern: string | RegExp) {
  return page.waitForResponse((response) => {
    if (typeof urlPattern === 'string') {
      return response.url().includes(urlPattern);
    }
    return urlPattern.test(response.url());
  });
}

// API mocking helpers
export async function mockApiResponse(
  page: ReturnType<typeof base.page>,
  urlPattern: string | RegExp,
  response: object,
  status = 200
) {
  await page.route(urlPattern, (route) => {
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });
}

// Mock authenticated user
export async function mockAuthenticatedUser(page: ReturnType<typeof base.page>) {
  // Set up localStorage auth state before navigating
  await page.addInitScript(() => {
    const authState = {
      state: {
        user: {
          id: 'user-1',
          email: 'test@tnc.com',
          phone: '+22670000000',
          country: 'BF',
          kycLevel: 'VERIFIED',
          kycStatus: 'APPROVED',
          emailVerified: true,
          phoneVerified: true,
          twoFactorEnabled: false,
        },
        tokens: {
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
          expiresIn: 900,
        },
        isAuthenticated: true,
      },
      version: 0,
    };
    localStorage.setItem('tnc-auth-storage', JSON.stringify(authState));
  });

  // Mock price endpoint
  await mockApiResponse(page, '**/api/v1/market/price', {
    success: true,
    data: {
      lbmaUsd: 85.50,
      priceXof: 52500,
      buyPrice: 53550,
      sellPrice: 51450,
      spreadBuy: 0.02,
      spreadSell: 0.02,
      exchangeRate: 615,
      change24h: 0.5,
      updatedAt: new Date().toISOString(),
    },
    requestId: 'mock-request-id',
  });

  // Mock wallet endpoint
  await mockApiResponse(page, '**/api/v1/wallet', {
    success: true,
    data: {
      id: 'wallet-1',
      userId: 'user-1',
      tokenBalance: 5.5,
      cashBalance: 100000,
      estimatedValue: 288750,
      averageBuyPrice: 50000,
      profitLoss: 7975,
      profitLossPercent: 2.9,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: new Date().toISOString(),
    },
    requestId: 'mock-request-id',
  });

  // Mock stock endpoint
  await mockApiResponse(page, '**/api/v1/market/stock', {
    success: true,
    data: {
      totalAllocated: 10000,
      tokensIssued: 5000,
      availableStock: 5000,
      coverage: 2.0,
      lastAuditDate: '2024-01-15T00:00:00Z',
    },
    requestId: 'mock-request-id',
  });

  // Mock transactions endpoint
  await mockApiResponse(page, '**/api/v1/wallet/transactions**', {
    success: true,
    data: {
      items: [
        {
          id: 'tx-1',
          type: 'BUY',
          status: 'COMPLETED',
          tokenAmount: 1.0,
          cashAmount: 53550,
          pricePerGram: 53550,
          fees: 1071,
          paymentMethod: 'orange_money',
          createdAt: '2024-01-20T10:00:00Z',
          completedAt: '2024-01-20T10:01:00Z',
        },
        {
          id: 'tx-2',
          type: 'DEPOSIT',
          status: 'COMPLETED',
          tokenAmount: null,
          cashAmount: 100000,
          pricePerGram: null,
          fees: 0,
          paymentMethod: 'orange_money',
          createdAt: '2024-01-19T15:00:00Z',
          completedAt: '2024-01-19T15:02:00Z',
        },
      ],
      total: 2,
      page: 1,
      limit: 20,
      hasMore: false,
    },
    requestId: 'mock-request-id',
  });
}
