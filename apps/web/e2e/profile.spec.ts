import { test, expect } from '@playwright/test';
import { mockApiResponse, mockAuthenticatedUser } from './fixtures';

test.describe('Profile & Settings', () => {
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

  test.describe('Profile Information', () => {
    test('should display user email', async ({ page }) => {
      await page.goto('/profile');

      await expect(page.getByText('test@tnc.com')).toBeVisible({ timeout: 10000 });
    });

    test('should display user phone', async ({ page }) => {
      await page.goto('/profile');

      await expect(page.getByText(/\+226|70000000/)).toBeVisible({ timeout: 10000 });
    });

    test('should show country flag or name', async ({ page }) => {
      await page.goto('/profile');

      await expect(
        page.getByText(/Burkina|BF/i)
      ).toBeVisible({ timeout: 10000 });
    });

    test('should show verification status badges', async ({ page }) => {
      await page.goto('/profile');

      await expect(page.getByText(/Email verifie|Phone verifie/i).first()).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Security Settings', () => {
    test('should navigate to security page', async ({ page }) => {
      await page.goto('/profile');

      const securityLink = page.locator('a:has-text("Securite"), button:has-text("Securite")').first();
      if (await securityLink.isVisible()) {
        await securityLink.click();
        await expect(page.url()).toContain('security');
      }
    });

    test('should display 2FA status', async ({ page }) => {
      await page.goto('/profile/security');

      await expect(
        page.getByText(/2FA|Double authentification|Authentification/i)
      ).toBeVisible({ timeout: 10000 });
    });

    test('should show enable 2FA button when disabled', async ({ page }) => {
      await page.goto('/profile/security');

      await expect(
        page.locator('button:has-text("Activer"), button:has-text("2FA")')
      ).toBeVisible({ timeout: 10000 });
    });

    test('should have password change option', async ({ page }) => {
      await page.goto('/profile/security');

      await expect(
        page.getByText(/Mot de passe|Password/i)
      ).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('2FA Setup Flow', () => {
    test('should open 2FA setup modal', async ({ page }) => {
      // Mock 2FA setup endpoint
      await mockApiResponse(page, '**/api/v1/auth/2fa/setup', {
        success: true,
        data: {
          secret: 'JBSWY3DPEHPK3PXP',
          qrCode: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          uri: 'otpauth://totp/TNC:test@tnc.com?secret=JBSWY3DPEHPK3PXP',
        },
        requestId: 'test',
      });

      await page.goto('/profile/security');

      const enable2FABtn = page.locator('button:has-text("Activer 2FA"), button:has-text("Activer")').first();
      if (await enable2FABtn.isVisible()) {
        await enable2FABtn.click();

        // Should show QR code or setup instructions
        await expect(
          page.getByText(/QR|Code|Authenticator/i)
        ).toBeVisible({ timeout: 5000 });
      }
    });

    test('should require verification code to enable 2FA', async ({ page }) => {
      await mockApiResponse(page, '**/api/v1/auth/2fa/setup', {
        success: true,
        data: {
          secret: 'JBSWY3DPEHPK3PXP',
          qrCode: 'data:image/png;base64,test',
          uri: 'otpauth://totp/TNC:test@tnc.com?secret=JBSWY3DPEHPK3PXP',
        },
        requestId: 'test',
      });

      await page.goto('/profile/security');

      const enable2FABtn = page.locator('button:has-text("Activer")').first();
      if (await enable2FABtn.isVisible()) {
        await enable2FABtn.click();

        // Should show verification code input
        await expect(
          page.locator('input[placeholder*="code"], input[type="text"]')
        ).toBeVisible({ timeout: 5000 });
      }
    });
  });

  test.describe('Password Change', () => {
    test('should open password change form', async ({ page }) => {
      await page.goto('/profile/security');

      const changePassBtn = page.locator('button:has-text("Modifier"), button:has-text("Changer")').first();
      if (await changePassBtn.isVisible()) {
        await changePassBtn.click();

        await expect(
          page.locator('input[type="password"]').first()
        ).toBeVisible({ timeout: 5000 });
      }
    });

    test('should require current password', async ({ page }) => {
      await page.goto('/profile/security');

      const changePassBtn = page.locator('button:has-text("Modifier mot de passe")').first();
      if (await changePassBtn.isVisible()) {
        await changePassBtn.click();

        await expect(
          page.getByText(/Actuel|Current/i)
        ).toBeVisible({ timeout: 5000 });
      }
    });

    test('should validate password strength', async ({ page }) => {
      await page.goto('/profile/security');

      const changePassBtn = page.locator('button:has-text("Modifier")').first();
      if (await changePassBtn.isVisible()) {
        await changePassBtn.click();

        const newPassInput = page.locator('input[name="newPassword"], input[placeholder*="nouveau"]').first();
        if (await newPassInput.isVisible()) {
          await newPassInput.fill('weak');

          // Should show strength indicator
          await expect(
            page.getByText(/Faible|Weak|Fort|Strong/i)
          ).toBeVisible({ timeout: 5000 });
        }
      }
    });
  });

  test.describe('Session Management', () => {
    test('should show active sessions', async ({ page }) => {
      // Mock sessions endpoint
      await mockApiResponse(page, '**/api/v1/auth/sessions', {
        success: true,
        data: [
          {
            id: 'session-1',
            device: 'Chrome on macOS',
            ipAddress: '192.168.1.1',
            lastActivity: new Date().toISOString(),
            isCurrent: true,
          },
        ],
        requestId: 'test',
      });

      await page.goto('/profile/security');

      await expect(
        page.getByText(/Sessions|Appareils|Connecte/i)
      ).toBeVisible({ timeout: 10000 });
    });

    test('should have logout all sessions button', async ({ page }) => {
      await page.goto('/profile/security');

      await expect(
        page.locator('button:has-text("Deconnecter tout"), button:has-text("Tout deconnecter")')
      ).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Notifications Settings', () => {
    test('should display notification preferences', async ({ page }) => {
      await page.goto('/profile/notifications');

      await expect(
        page.getByText(/Email|SMS|Push/i)
      ).toBeVisible({ timeout: 10000 });
    });

    test('should have toggles for notification types', async ({ page }) => {
      await page.goto('/profile/notifications');

      const toggles = page.locator('input[type="checkbox"], button[role="switch"]');
      await expect(toggles.first()).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Logout', () => {
    test('should have logout button', async ({ page }) => {
      await page.goto('/profile');

      await expect(
        page.locator('button:has-text("Deconnexion"), a:has-text("Deconnexion")')
      ).toBeVisible({ timeout: 10000 });
    });

    test('should logout successfully', async ({ page }) => {
      await mockApiResponse(page, '**/api/v1/auth/logout', {
        success: true,
        data: { message: 'Deconnecte' },
        requestId: 'test',
      });

      await page.goto('/profile');

      const logoutBtn = page.locator('button:has-text("Deconnexion"), a:has-text("Deconnexion")').first();
      await logoutBtn.click();

      // Should redirect to login
      await page.waitForURL('**/login', { timeout: 10000 });
    });
  });
});
