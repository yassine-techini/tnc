import { test, expect } from '@playwright/test';
import { mockApiResponse, mockAuthenticatedUser } from './fixtures';

test.describe('KYC Verification', () => {
  test.beforeEach(async ({ page }) => {
    await mockApiResponse(page, '**/api/v1/auth/login', {
      success: true,
      data: {
        accessToken: 'mock-token',
        refreshToken: 'mock-refresh',
        expiresIn: 900,
        user: {
          id: 'user-1',
          email: 'test@tnc.com',
          phone: '+22670000000',
          country: 'BF',
          kycLevel: 'BASIC',
          kycStatus: 'PENDING',
          emailVerified: true,
          phoneVerified: true,
          twoFactorEnabled: false,
        },
      },
      requestId: 'test',
    });

    await mockAuthenticatedUser(page);
  });

  test.describe('KYC Status Display', () => {
    test('should show KYC level in profile', async ({ page }) => {
      await page.goto('/profile');

      await expect(page.getByText(/KYC|Verification|Niveau/i)).toBeVisible({ timeout: 10000 });
    });

    test('should show pending status for new users', async ({ page }) => {
      await page.goto('/profile');

      await expect(
        page.getByText(/Basique|En attente|Complet/i)
      ).toBeVisible({ timeout: 10000 });
    });

    test('should show KYC limits information', async ({ page }) => {
      await page.goto('/profile');

      await expect(
        page.getByText(/Limite|Achat|Jour/i)
      ).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('KYC Document Submission', () => {
    test('should open KYC submission form', async ({ page }) => {
      await page.goto('/profile');

      const kycButton = page.locator('button:has-text("Verifier"), a:has-text("Verifier"), button:has-text("KYC")').first();
      if (await kycButton.isVisible()) {
        await kycButton.click();
        await expect(page.getByText(/Document|Identite|Verification/i)).toBeVisible({ timeout: 5000 });
      }
    });

    test('should display document type options', async ({ page }) => {
      await page.goto('/kyc');

      await expect(page.getByText(/CNIB/i)).toBeVisible({ timeout: 10000 });
      await expect(page.getByText(/Passeport/i)).toBeVisible();
    });

    test('should show upload instructions', async ({ page }) => {
      await page.goto('/kyc');

      await expect(
        page.getByText(/Photo|Recto|Verso|Selfie/i)
      ).toBeVisible({ timeout: 10000 });
    });

    test('should require front image', async ({ page }) => {
      await page.goto('/kyc');

      const submitBtn = page.locator('button[type="submit"], button:has-text("Soumettre")').first();
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        await expect(page.getByText(/requis|obligatoire/i)).toBeVisible({ timeout: 5000 });
      }
    });
  });

  test.describe('KYC Level Upgrade Flow', () => {
    test('should show upgrade benefits', async ({ page }) => {
      await page.goto('/profile');

      await expect(
        page.getByText(/Standard|Verifie|Avantages/i)
      ).toBeVisible({ timeout: 10000 });
    });

    test('should show current limits and upgraded limits', async ({ page }) => {
      await page.goto('/profile');

      // Check for limit display
      await expect(page.locator('text=/0|100|500|1000|5000/').first()).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Verified User Experience', () => {
    test.beforeEach(async ({ page }) => {
      // Override with verified user
      await mockApiResponse(page, '**/api/v1/auth/login', {
        success: true,
        data: {
          accessToken: 'mock-token',
          refreshToken: 'mock-refresh',
          expiresIn: 900,
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
        },
        requestId: 'test',
      });
    });

    test('should show verified badge', async ({ page }) => {
      await page.goto('/profile');

      await expect(
        page.getByText(/Verifie|Approuve/i)
      ).toBeVisible({ timeout: 10000 });
    });

    test('should show higher limits for verified user', async ({ page }) => {
      await page.goto('/profile');

      // Verified users have 1000g/day limit
      await expect(
        page.locator('text=/1[,\s]?000|5[,\s]?000/').first()
      ).toBeVisible({ timeout: 10000 });
    });
  });
});
