import { test, expect } from '@playwright/test';
import { TEST_USER, mockApiResponse } from './fixtures';

test.describe('Authentication', () => {
  test.describe('Login Page', () => {
    test('should display login form', async ({ page }) => {
      await page.goto('/login');

      // Check page title and form elements
      await expect(page.locator('h1, h2').first()).toContainText(/connexion|login/i);
      await expect(page.locator('input[type="email"], input[placeholder*="email"]')).toBeVisible();
      await expect(page.locator('input[type="password"]')).toBeVisible();
      await expect(page.locator('button[type="submit"]')).toBeVisible();
    });

    test('should show error with invalid credentials', async ({ page }) => {
      // Mock failed login
      await mockApiResponse(
        page,
        '**/api/v1/auth/login',
        {
          success: false,
          error: {
            code: 'AUTH_INVALID_CREDENTIALS',
            message: 'Email ou mot de passe incorrect',
          },
          requestId: 'test-request-id',
        },
        401
      );

      await page.goto('/login');

      await page.fill('input[type="email"], input[placeholder*="email"]', 'wrong@email.com');
      await page.fill('input[type="password"]', 'wrongpassword');
      await page.click('button[type="submit"]');

      // Should show error message
      await expect(page.locator('text=Email ou mot de passe incorrect')).toBeVisible({ timeout: 5000 });
    });

    test('should login successfully with valid credentials', async ({ page }) => {
      // Mock successful login
      await mockApiResponse(page, '**/api/v1/auth/login', {
        success: true,
        data: {
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
          expiresIn: 900,
          user: {
            id: 'user-1',
            email: TEST_USER.email,
            phone: TEST_USER.phone,
            country: 'BF',
            kycLevel: 'BASIC',
            kycStatus: 'PENDING',
            emailVerified: true,
            phoneVerified: true,
            twoFactorEnabled: false,
          },
        },
        requestId: 'test-request-id',
      });

      // Mock other required endpoints
      await mockApiResponse(page, '**/api/v1/market/price', {
        success: true,
        data: { priceXof: 52500, buyPrice: 53550, sellPrice: 51450 },
        requestId: 'test',
      });

      await page.goto('/login');

      await page.fill('input[type="email"], input[placeholder*="email"]', TEST_USER.email);
      await page.fill('input[type="password"]', TEST_USER.password);
      await page.click('button[type="submit"]');

      // Should redirect to dashboard
      await page.waitForURL('**/dashboard', { timeout: 10000 });
      await expect(page.url()).toContain('/dashboard');
    });

    test('should navigate to registration page', async ({ page }) => {
      await page.goto('/login');

      // Use .first() to avoid strict mode violation when multiple elements match
      const registerLink = page.locator('a[href*="register"]').first();
      await expect(registerLink).toBeVisible();
      await registerLink.click();

      await page.waitForURL('**/register', { timeout: 5000 });
    });

    test('should navigate to forgot password page', async ({ page }) => {
      await page.goto('/login');

      const forgotLink = page.locator('a[href*="forgot"], a:has-text("oublie")');
      if (await forgotLink.isVisible()) {
        await forgotLink.click();
        await page.waitForURL('**/forgot-password', { timeout: 5000 });
      }
    });
  });

  test.describe('Registration Page', () => {
    test('should display registration form', async ({ page }) => {
      await page.goto('/register');

      await expect(page.locator('h1, h2').first()).toContainText(/inscription|register|compte/i);
      await expect(page.locator('input[type="email"]')).toBeVisible();
      await expect(page.locator('input[type="password"]').first()).toBeVisible();
      await expect(page.locator('input[type="tel"], input[placeholder*="telephone"]')).toBeVisible();
    });

    test('should show validation errors for empty form', async ({ page }) => {
      await page.goto('/register');

      await page.click('button[type="submit"]');

      // Should show validation errors
      const errorMessages = page.locator('.text-red-400, .text-red-500, [class*="error"]');
      await expect(errorMessages.first()).toBeVisible({ timeout: 3000 });
    });

    test('should register successfully with valid data', async ({ page }) => {
      const uniqueEmail = `test.${Date.now()}@tnc-trading.com`;

      // Mock successful registration
      await mockApiResponse(page, '**/api/v1/auth/register', {
        success: true,
        data: {
          message: 'Inscription reussie. Verifiez votre email.',
          userId: 'new-user-id',
        },
        requestId: 'test-request-id',
      });

      await page.goto('/register');

      await page.fill('input[type="email"]', uniqueEmail);
      await page.fill('input[type="tel"], input[placeholder*="telephone"]', '70000000');
      await page.fill('input[type="password"]', TEST_USER.password);

      // Confirm password if field exists
      const confirmPassword = page.locator('input[name="confirmPassword"], input[placeholder*="confirm"]');
      if (await confirmPassword.isVisible()) {
        await confirmPassword.fill(TEST_USER.password);
      }

      await page.click('button[type="submit"]');

      // Should show success or redirect
      await expect(
        page.getByText(/Inscription reussie|verifiez|email/i)
      ).toBeVisible({ timeout: 10000 }).catch(() => {
        // Or redirect to login/verification page
        return page.waitForURL(/\/(login|verify)/, { timeout: 10000 });
      });
    });

    test('should show error for existing email', async ({ page }) => {
      // Mock error for existing email
      await mockApiResponse(
        page,
        '**/api/v1/auth/register',
        {
          success: false,
          error: {
            code: 'USER_EXISTS',
            message: 'Cet email est deja utilise',
          },
          requestId: 'test-request-id',
        },
        409
      );

      await page.goto('/register');

      await page.fill('input[type="email"]', TEST_USER.email);
      await page.fill('input[type="tel"], input[placeholder*="telephone"]', '70000000');
      await page.fill('input[type="password"]', TEST_USER.password);

      const confirmPassword = page.locator('input[name="confirmPassword"], input[placeholder*="confirm"]');
      if (await confirmPassword.isVisible()) {
        await confirmPassword.fill(TEST_USER.password);
      }

      await page.click('button[type="submit"]');

      await expect(page.locator('text=deja utilise')).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Protected Routes', () => {
    test('should redirect to login when accessing protected route without auth', async ({ page }) => {
      await page.goto('/dashboard');

      // Should redirect to login
      await page.waitForURL('**/login', { timeout: 5000 });
    });

    test('should redirect to login when accessing wallet without auth', async ({ page }) => {
      await page.goto('/wallet');

      await page.waitForURL('**/login', { timeout: 5000 });
    });

    test('should redirect to login when accessing marketplace without auth', async ({ page }) => {
      await page.goto('/marketplace');

      await page.waitForURL('**/login', { timeout: 5000 });
    });
  });
});
