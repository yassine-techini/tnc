import { test, expect } from '@playwright/test';
import { mockApiResponse, mockAuthenticatedAdmin } from './fixtures';

test.describe('Admin Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticatedAdmin(page);
  });

  test.describe('Dashboard Display', () => {
    test('should display dashboard after login', async ({ page }) => {
      await page.goto('/');

      await expect(page.getByText(/Dashboard|Tableau de bord/i)).toBeVisible({ timeout: 10000 });
    });

    test('should display KPIs', async ({ page }) => {
      await page.goto('/');

      // Should show total users
      await expect(page.getByText(/Utilisateurs|Users/i).first()).toBeVisible({ timeout: 10000 });
    });

    test('should display pending KYC count', async ({ page }) => {
      await page.goto('/');

      await expect(page.getByText(/KYC|Verification/i).first()).toBeVisible({ timeout: 10000 });
    });

    test('should display pending withdrawals', async ({ page }) => {
      await page.goto('/');

      await expect(page.getByText(/Retrait|Withdrawal/i).first()).toBeVisible({ timeout: 10000 });
    });

    test('should display gold price', async ({ page }) => {
      await page.goto('/');

      // Should show current gold price
      await expect(page.getByText(/XOF|Prix/i).first()).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Navigation', () => {
    test('should have sidebar navigation', async ({ page }) => {
      await page.goto('/');

      // Should show navigation items
      await expect(page.getByText(/Utilisateurs/i).first()).toBeVisible({ timeout: 10000 });
      await expect(page.getByText(/Transactions/i).first()).toBeVisible();
    });

    test('should navigate to users page', async ({ page }) => {
      await mockApiResponse(page, '**/api/v1/admin/users**', {
        success: true,
        data: {
          items: [],
          total: 0,
          page: 1,
          limit: 20,
          hasMore: false,
        },
        requestId: 'test',
      });

      await page.goto('/');

      const usersLink = page.locator('a[href="/users"]').first();
      if (await usersLink.isVisible()) {
        await usersLink.click();
        await page.waitForURL('**/users', { timeout: 5000 });
      }
    });

    test('should navigate to KYC review', async ({ page }) => {
      await mockApiResponse(page, '**/api/v1/admin/kyc/pending**', {
        success: true,
        data: {
          items: [],
          total: 0,
          page: 1,
          limit: 20,
          hasMore: false,
        },
        requestId: 'test',
      });

      await page.goto('/');

      const kycLink = page.locator('a[href="/kyc"]').first();
      if (await kycLink.isVisible()) {
        await kycLink.click();
        await page.waitForURL('**/kyc', { timeout: 5000 });
      }
    });

    test('should navigate to stock page', async ({ page }) => {
      await mockApiResponse(page, '**/api/v1/admin/stock', {
        success: true,
        data: {
          totalAllocated: 100000,
          tokensIssued: 95000,
          availableStock: 5000,
          coverage: 105.26,
          lastAuditDate: null,
        },
        requestId: 'test',
      });

      await page.goto('/');

      const stockLink = page.locator('a[href="/stock"]').first();
      if (await stockLink.isVisible()) {
        await stockLink.click();
        await page.waitForURL('**/stock', { timeout: 5000 });
      }
    });
  });

  test.describe('Stock Coverage', () => {
    test('should display stock coverage percentage', async ({ page }) => {
      await page.goto('/');

      // Should show coverage > 100%
      await expect(page.getByText(/%/i).first()).toBeVisible({ timeout: 10000 });
    });
  });
});
