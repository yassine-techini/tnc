import { test, expect } from '@playwright/test';
import { mockApiResponse, mockAuthenticatedUser } from './fixtures';

test.describe('Marketplace', () => {
  test.beforeEach(async ({ page }) => {
    // Mock authentication
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

    await mockAuthenticatedUser(page);
  });

  test.describe('Price Display', () => {
    test('should display current gold price', async ({ page }) => {
      await page.goto('/marketplace');

      // Wait for price to load - check for any price value in the XOF format
      await expect(page.getByText(/\d{2}[,\s]?\d{3}/)).toBeVisible({ timeout: 10000 });
    });

    test('should show buy and sell prices', async ({ page }) => {
      await page.goto('/marketplace');

      // Should have tabs or sections for buy/sell
      await expect(page.getByRole('button', { name: /Acheter/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Vendre/i })).toBeVisible();
    });
  });

  test.describe('Buy Flow', () => {
    test('should open buy form', async ({ page }) => {
      await page.goto('/marketplace');

      // Click buy tab/button
      const buyTab = page.locator('button:has-text("Acheter"), [role="tab"]:has-text("Acheter")').first();
      await buyTab.click();

      // Should show amount input
      await expect(page.locator('input[type="number"], input[placeholder*="montant"]').first()).toBeVisible();
    });

    test('should calculate quote when entering amount', async ({ page }) => {
      // Mock quote endpoint
      await mockApiResponse(page, '**/api/v1/market/quote', {
        success: true,
        data: {
          quoteId: 'quote-1',
          type: 'BUY',
          tokenAmount: 1.0,
          cashAmount: 53550,
          pricePerGram: 53550,
          fees: 1071,
          total: 54621,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
        requestId: 'test',
      });

      await page.goto('/marketplace');

      const buyTab = page.locator('button:has-text("Acheter"), [role="tab"]:has-text("Acheter")').first();
      await buyTab.click();

      // Enter amount
      const amountInput = page.locator('input[type="number"], input[placeholder*="montant"]').first();
      await amountInput.fill('1');

      // Click calculate/quote button or wait for auto-calculation
      const calcButton = page.locator('button:has-text("Calculer"), button:has-text("Obtenir")');
      if (await calcButton.isVisible()) {
        await calcButton.click();
      }

      // Should show quote details - look for price or fees in the summary
      await expect(page.getByText(/XOF\/g|Frais|Total/)).toBeVisible({ timeout: 5000 });
    });

    test('should execute buy transaction', async ({ page }) => {
      // Mock quote
      await mockApiResponse(page, '**/api/v1/market/quote', {
        success: true,
        data: {
          quoteId: 'quote-1',
          type: 'BUY',
          tokenAmount: 1.0,
          cashAmount: 53550,
          pricePerGram: 53550,
          fees: 1071,
          total: 54621,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
        requestId: 'test',
      });

      // Mock buy execution
      await mockApiResponse(page, '**/api/v1/market/buy', {
        success: true,
        data: {
          transactionId: 'tx-123',
          type: 'BUY',
          tokenAmount: 1.0,
          cashAmount: 53550,
          status: 'COMPLETED',
        },
        requestId: 'test',
      });

      await page.goto('/marketplace');

      const buyTab = page.locator('button:has-text("Acheter"), [role="tab"]:has-text("Acheter")').first();
      await buyTab.click();

      // Enter amount and get quote
      const amountInput = page.locator('input[type="number"], input[placeholder*="montant"]').first();
      await amountInput.fill('1');

      const calcButton = page.locator('button:has-text("Calculer"), button:has-text("Obtenir")');
      if (await calcButton.isVisible()) {
        await calcButton.click();
      }

      // Wait for quote to appear
      await page.waitForTimeout(1000);

      // Click confirm/buy button
      const confirmButton = page.locator('button:has-text("Confirmer"), button:has-text("Acheter")').last();
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }

      // Should show success modal or message
      await expect(
        page.getByText(/succes|reussi|complete/i)
      ).toBeVisible({ timeout: 10000 });
    });

    test('should show error for insufficient balance', async ({ page }) => {
      // Mock quote with error
      await mockApiResponse(
        page,
        '**/api/v1/market/quote',
        {
          success: false,
          error: {
            code: 'TRADING_INSUFFICIENT_BALANCE',
            message: 'Solde insuffisant',
          },
          requestId: 'test',
        },
        400
      );

      await page.goto('/marketplace');

      const buyTab = page.locator('button:has-text("Acheter"), [role="tab"]:has-text("Acheter")').first();
      await buyTab.click();

      const amountInput = page.locator('input[type="number"], input[placeholder*="montant"]').first();
      await amountInput.fill('1000');

      const calcButton = page.locator('button:has-text("Calculer"), button:has-text("Obtenir")');
      if (await calcButton.isVisible()) {
        await calcButton.click();
      }

      await expect(page.locator('text=Solde insuffisant')).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Sell Flow', () => {
    test('should open sell form', async ({ page }) => {
      await page.goto('/marketplace');

      const sellTab = page.locator('button:has-text("Vendre"), [role="tab"]:has-text("Vendre")').first();
      await sellTab.click();

      await expect(page.locator('input[type="number"], input[placeholder*="montant"]').first()).toBeVisible();
    });

    test('should execute sell transaction', async ({ page }) => {
      // Mock quote
      await mockApiResponse(page, '**/api/v1/market/quote', {
        success: true,
        data: {
          quoteId: 'quote-2',
          type: 'SELL',
          tokenAmount: 1.0,
          cashAmount: 51450,
          pricePerGram: 51450,
          fees: 1029,
          total: 50421,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
        requestId: 'test',
      });

      // Mock sell execution
      await mockApiResponse(page, '**/api/v1/market/sell', {
        success: true,
        data: {
          transactionId: 'tx-456',
          type: 'SELL',
          tokenAmount: 1.0,
          cashAmount: 50421,
          status: 'COMPLETED',
        },
        requestId: 'test',
      });

      await page.goto('/marketplace');

      const sellTab = page.locator('button:has-text("Vendre"), [role="tab"]:has-text("Vendre")').first();
      await sellTab.click();

      const amountInput = page.locator('input[type="number"], input[placeholder*="montant"]').first();
      await amountInput.fill('1');

      const calcButton = page.locator('button:has-text("Calculer"), button:has-text("Obtenir")');
      if (await calcButton.isVisible()) {
        await calcButton.click();
      }

      await page.waitForTimeout(1000);

      const confirmButton = page.locator('button:has-text("Confirmer"), button:has-text("Vendre")').last();
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }

      await expect(
        page.getByText(/succes|reussi|complete/i)
      ).toBeVisible({ timeout: 10000 });
    });

    test('should show error for insufficient tokens', async ({ page }) => {
      await mockApiResponse(
        page,
        '**/api/v1/market/quote',
        {
          success: false,
          error: {
            code: 'TRADING_INSUFFICIENT_BALANCE',
            message: 'Solde or insuffisant',
          },
          requestId: 'test',
        },
        400
      );

      await page.goto('/marketplace');

      const sellTab = page.locator('button:has-text("Vendre"), [role="tab"]:has-text("Vendre")').first();
      await sellTab.click();

      const amountInput = page.locator('input[type="number"], input[placeholder*="montant"]').first();
      await amountInput.fill('100');

      const calcButton = page.locator('button:has-text("Calculer"), button:has-text("Obtenir")');
      if (await calcButton.isVisible()) {
        await calcButton.click();
      }

      await expect(page.locator('text=insuffisant')).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Stock Display', () => {
    test('should display available stock', async ({ page }) => {
      await page.goto('/marketplace');

      // Should show stock information - check for stock label or coverage
      await expect(
        page.getByText(/Stock disponible|Couverture/i)
      ).toBeVisible({ timeout: 10000 });
    });
  });
});
