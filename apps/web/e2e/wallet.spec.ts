import { test, expect } from '@playwright/test';
import { mockApiResponse, mockAuthenticatedUser } from './fixtures';

test.describe('Wallet', () => {
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

  test.describe('Balance Display', () => {
    test('should display gold balance', async ({ page }) => {
      await page.goto('/wallet');

      // Should show gold balance - using regex for locale-independent matching
      await expect(page.getByText(/5[.,]500/)).toBeVisible({ timeout: 10000 });
      await expect(page.getByText(/Solde Or/i)).toBeVisible();
    });

    test('should display cash balance', async ({ page }) => {
      await page.goto('/wallet');

      // Should show cash balance - using regex for locale-independent matching
      await expect(page.getByText(/100[,\s]?000/)).toBeVisible({ timeout: 10000 });
      await expect(page.getByText(/Disponible|XOF/i)).toBeVisible();
    });

    test('should display performance metrics', async ({ page }) => {
      await page.goto('/wallet');

      // Should show profit/loss
      await expect(page.getByText('Performance')).toBeVisible();
      await expect(page.getByText(/Gain|Perte|Rendement/i)).toBeVisible();
    });
  });

  test.describe('Transaction History', () => {
    test('should display recent transactions', async ({ page }) => {
      await page.goto('/wallet');

      // Should show transactions section
      await expect(page.locator('text=/Transactions|Historique/i')).toBeVisible();

      // Should show at least one transaction
      await expect(page.locator('text=/Achat|Vente|Depot|Retrait/i').first()).toBeVisible({ timeout: 10000 });
    });

    test('should show transaction status', async ({ page }) => {
      await page.goto('/wallet');

      // Should show status
      await expect(
        page.locator('text=/Complete|En cours|En attente/i').first()
      ).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Deposit Flow', () => {
    test('should open deposit modal', async ({ page }) => {
      await page.goto('/wallet');

      // Click deposit button
      const depositBtn = page.locator('button:has-text("Deposer")').first();
      await depositBtn.click();

      // Modal should open
      await expect(page.locator('text=/Deposer des fonds|Mode de paiement/i')).toBeVisible({ timeout: 5000 });
    });

    test('should show payment methods in deposit modal', async ({ page }) => {
      await page.goto('/wallet');

      const depositBtn = page.locator('button:has-text("Deposer")').first();
      await depositBtn.click();

      // Should show Orange Money option
      await expect(page.locator('text=Orange Money')).toBeVisible();
      await expect(page.locator('text=Moov Money')).toBeVisible();
    });

    test('should show quick amount buttons', async ({ page }) => {
      await page.goto('/wallet');

      const depositBtn = page.locator('button:has-text("Deposer")').first();
      await depositBtn.click();

      // Should show quick amounts
      await expect(page.locator('button:has-text("5,000"), button:has-text("5000")').first()).toBeVisible();
      await expect(page.locator('button:has-text("10,000"), button:has-text("10000")').first()).toBeVisible();
    });

    test('should execute deposit', async ({ page }) => {
      // Mock deposit endpoint
      await mockApiResponse(page, '**/api/v1/wallet/deposit', {
        success: true,
        data: {
          transactionId: 'tx-deposit-1',
          amount: 10000,
          paymentMethod: 'orange_money',
          paymentUrl: 'https://payment.example.com/deposit',
          status: 'PENDING',
        },
        requestId: 'test',
      });

      await page.goto('/wallet');

      const depositBtn = page.locator('button:has-text("Deposer")').first();
      await depositBtn.click();

      // Fill amount
      const amountInput = page.locator('input[type="number"]').first();
      await amountInput.fill('10000');

      // Select payment method (Orange Money should be default)
      const orangeMoneyBtn = page.locator('button:has-text("Orange Money")');
      if (await orangeMoneyBtn.isVisible()) {
        await orangeMoneyBtn.click();
      }

      // Fill phone number
      const phoneInput = page.locator('input[type="tel"]');
      await phoneInput.fill('70000000');

      // Click deposit button
      const submitBtn = page.locator('button:has-text("Deposer 10")').last();
      await submitBtn.click();

      // Should show success
      await expect(
        page.locator('text=/initie|succes|paiement/i').first()
      ).toBeVisible({ timeout: 10000 });
    });

    test('should validate minimum deposit amount', async ({ page }) => {
      await page.goto('/wallet');

      const depositBtn = page.locator('button:has-text("Deposer")').first();
      await depositBtn.click();

      const amountInput = page.locator('input[type="number"]').first();
      await amountInput.fill('500'); // Less than 1000 minimum

      const phoneInput = page.locator('input[type="tel"]');
      await phoneInput.fill('70000000');

      const submitBtn = page.locator('button:has-text("Deposer")').last();
      await submitBtn.click();

      // Should show error
      await expect(page.locator('text=/minimum|1,000|1000/i')).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Withdrawal Flow', () => {
    test('should open withdrawal modal', async ({ page }) => {
      await page.goto('/wallet');

      const withdrawBtn = page.locator('button:has-text("Retirer")').first();
      await withdrawBtn.click();

      await expect(page.locator('text=/Retirer des fonds|Mode de retrait/i')).toBeVisible({ timeout: 5000 });
    });

    test('should show available balance in withdrawal modal', async ({ page }) => {
      await page.goto('/wallet');

      const withdrawBtn = page.locator('button:has-text("Retirer")').first();
      await withdrawBtn.click();

      // Check for balance display in withdrawal modal
      await expect(page.getByText(/Solde disponible|100[,\s]?000/)).toBeVisible();
    });

    test('should show KYC limit information', async ({ page }) => {
      await page.goto('/wallet');

      const withdrawBtn = page.locator('button:has-text("Retirer")').first();
      await withdrawBtn.click();

      await expect(page.locator('text=/Limite|XOF/i')).toBeVisible();
    });

    test('should execute withdrawal', async ({ page }) => {
      // Mock withdrawal endpoint
      await mockApiResponse(page, '**/api/v1/wallet/withdraw', {
        success: true,
        data: {
          withdrawalId: 'wd-1',
          amount: 50000,
          paymentMethod: 'orange_money',
          status: 'PENDING',
          estimatedTime: '24-48h',
        },
        requestId: 'test',
      });

      await page.goto('/wallet');

      const withdrawBtn = page.locator('button:has-text("Retirer")').first();
      await withdrawBtn.click();

      const amountInput = page.locator('input[type="number"]').first();
      await amountInput.fill('50000');

      const phoneInput = page.locator('input[type="tel"]');
      await phoneInput.fill('70000000');

      const submitBtn = page.locator('button:has-text("Retirer 50")').last();
      await submitBtn.click();

      await expect(
        page.locator('text=/demande|succes|traite/i').first()
      ).toBeVisible({ timeout: 10000 });
    });

    test('should prevent withdrawal exceeding balance', async ({ page }) => {
      await page.goto('/wallet');

      const withdrawBtn = page.locator('button:has-text("Retirer")').first();
      await withdrawBtn.click();

      const amountInput = page.locator('input[type="number"]').first();
      await amountInput.fill('500000'); // More than available balance

      const phoneInput = page.locator('input[type="tel"]');
      await phoneInput.fill('70000000');

      const submitBtn = page.locator('button:has-text("Retirer")').last();
      await submitBtn.click();

      await expect(page.locator('text=/insuffisant/i')).toBeVisible({ timeout: 5000 });
    });

    test('should have withdraw all button', async ({ page }) => {
      await page.goto('/wallet');

      const withdrawBtn = page.locator('button:has-text("Retirer")').first();
      await withdrawBtn.click();

      const withdrawAllBtn = page.locator('button:has-text("Retirer tout"), a:has-text("Retirer tout")');
      await expect(withdrawAllBtn).toBeVisible();
    });
  });

  test.describe('Certificate', () => {
    test('should have certificate button', async ({ page }) => {
      await page.goto('/wallet');

      const certBtn = page.locator('button:has-text("Certificat")');
      await expect(certBtn).toBeVisible();
    });

    test('should be disabled when no gold balance', async ({ page }) => {
      // Override wallet mock with zero balance
      await mockApiResponse(page, '**/api/v1/wallet', {
        success: true,
        data: {
          id: 'wallet-1',
          userId: 'user-1',
          tokenBalance: 0,
          cashBalance: 100000,
          estimatedValue: 0,
          averageBuyPrice: 0,
          profitLoss: 0,
          profitLossPercent: 0,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: new Date().toISOString(),
        },
        requestId: 'test',
      });

      await page.goto('/wallet');

      const certBtn = page.locator('button:has-text("Certificat")');
      await expect(certBtn).toBeDisabled();
    });
  });

  test.describe('Actions Section', () => {
    test('should display all action buttons', async ({ page }) => {
      await page.goto('/wallet');

      await expect(page.locator('button:has-text("Deposer")')).toBeVisible();
      await expect(page.locator('button:has-text("Retirer")')).toBeVisible();
      await expect(page.locator('button:has-text("Certificat")')).toBeVisible();
    });
  });
});
