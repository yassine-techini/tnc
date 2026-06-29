import { test, expect } from '@playwright/test';
import { mockApiResponse, mockAdminLogin } from './fixtures';

test.describe('Admin Login', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing auth state
    await page.addInitScript(() => {
      localStorage.clear();
    });
  });

  test.describe('Login Page', () => {
    test('should display login form', async ({ page }) => {
      await page.goto('/login');

      await expect(page.getByText('TNC Admin')).toBeVisible({ timeout: 10000 });
      await expect(page.getByPlaceholder(/admin@tnc-trading.bf/i)).toBeVisible();
      await expect(page.getByPlaceholder('********')).toBeVisible();
      await expect(page.getByRole('button', { name: /se connecter/i })).toBeVisible();
    });

    test('should show demo account button in staging', async ({ page }) => {
      await page.goto('/login');

      // In dev/staging, demo account should be visible
      await expect(page.getByText(/Compte de démonstration/i)).toBeVisible({ timeout: 10000 });
    });

    test('should fill demo credentials when clicked', async ({ page }) => {
      await page.goto('/login');

      const demoButton = page.getByText(/Admin Demo/i);
      if (await demoButton.isVisible()) {
        await demoButton.click();

        await expect(page.getByPlaceholder(/admin@tnc-trading.bf/i)).toHaveValue('admin@tnc.trading');
      }
    });
  });

  test.describe('Login Flow', () => {
    test('should handle successful login', async ({ page }) => {
      await mockAdminLogin(page);

      await page.goto('/login');

      await page.getByPlaceholder(/admin@tnc-trading.bf/i).fill('admin@tnc.trading');
      await page.getByPlaceholder('********').fill('AdminDemo2024!');
      await page.getByRole('button', { name: /se connecter/i }).click();

      // Should redirect to dashboard
      await page.waitForURL('**/', { timeout: 10000 });
    });

    test('should show error for invalid credentials', async ({ page }) => {
      await mockApiResponse(page, '**/api/v1/admin/login', {
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Email ou mot de passe incorrect',
        },
      });

      await page.goto('/login');

      await page.getByPlaceholder(/admin@tnc-trading.bf/i).fill('wrong@email.com');
      await page.getByPlaceholder('********').fill('wrongpassword');
      await page.getByRole('button', { name: /se connecter/i }).click();

      await expect(page.getByText(/incorrect|invalide/i)).toBeVisible({ timeout: 5000 });
    });

    test('should handle 2FA required', async ({ page }) => {
      await mockApiResponse(page, '**/api/v1/admin/login', {
        success: false,
        error: {
          code: '2FA_REQUIRED',
          message: 'Code 2FA requis',
        },
      });

      await page.goto('/login');

      await page.getByPlaceholder(/admin@tnc-trading.bf/i).fill('admin@tnc.trading');
      await page.getByPlaceholder('********').fill('AdminDemo2024!');
      await page.getByRole('button', { name: /se connecter/i }).click();

      // Should show 2FA input
      await expect(page.getByText(/Code 2FA|6 chiffres/i)).toBeVisible({ timeout: 5000 });
    });

    test('should handle 2FA setup required', async ({ page }) => {
      await mockApiResponse(page, '**/api/v1/admin/login', {
        success: false,
        error: {
          code: '2FA_SETUP_REQUIRED',
          message: 'Configuration 2FA obligatoire',
        },
        data: {
          setupToken: 'setup-token-123',
        },
      });

      await mockApiResponse(page, '**/api/v1/admin/2fa/setup', {
        success: true,
        data: {
          secret: 'JBSWY3DPEHPK3PXP',
          uri: 'otpauth://totp/TNC:admin@tnc.trading?secret=JBSWY3DPEHPK3PXP',
          issuer: 'TNC Trading Admin',
          message: 'Scannez le QR code',
        },
        requestId: 'test',
      });

      await page.goto('/login');

      await page.getByPlaceholder(/admin@tnc-trading.bf/i).fill('admin@tnc.trading');
      await page.getByPlaceholder('********').fill('AdminDemo2024!');
      await page.getByRole('button', { name: /se connecter/i }).click();

      // Should show 2FA setup instructions
      await expect(page.getByText(/QR|Configuration 2FA/i)).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('2FA Verification', () => {
    test('should accept 6-digit code', async ({ page }) => {
      // First trigger 2FA required
      await mockApiResponse(page, '**/api/v1/admin/login', {
        success: false,
        error: {
          code: '2FA_REQUIRED',
          message: 'Code 2FA requis',
        },
      });

      await page.goto('/login');

      await page.getByPlaceholder(/admin@tnc-trading.bf/i).fill('admin@tnc.trading');
      await page.getByPlaceholder('********').fill('AdminDemo2024!');
      await page.getByRole('button', { name: /se connecter/i }).click();

      // Wait for 2FA step
      await expect(page.getByText(/Code 2FA|6 chiffres/i)).toBeVisible({ timeout: 5000 });

      // Find the 6-digit input
      const codeInput = page.locator('input[maxlength="6"]');
      if (await codeInput.isVisible()) {
        await codeInput.fill('123456');
        expect(await codeInput.inputValue()).toBe('123456');
      }
    });

    test('should have back button in 2FA step', async ({ page }) => {
      await mockApiResponse(page, '**/api/v1/admin/login', {
        success: false,
        error: {
          code: '2FA_REQUIRED',
          message: 'Code 2FA requis',
        },
      });

      await page.goto('/login');

      await page.getByPlaceholder(/admin@tnc-trading.bf/i).fill('admin@tnc.trading');
      await page.getByPlaceholder('********').fill('AdminDemo2024!');
      await page.getByRole('button', { name: /se connecter/i }).click();

      // Should show back button
      await expect(page.getByText(/Retour/i)).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Protected Routes', () => {
    test('should redirect to login when not authenticated', async ({ page }) => {
      await page.goto('/');

      // Should redirect to login
      await page.waitForURL('**/login', { timeout: 10000 });
    });

    test('should redirect to login for users page', async ({ page }) => {
      await page.goto('/users');

      await page.waitForURL('**/login', { timeout: 10000 });
    });

    test('should redirect to login for stock page', async ({ page }) => {
      await page.goto('/stock');

      await page.waitForURL('**/login', { timeout: 10000 });
    });
  });
});
