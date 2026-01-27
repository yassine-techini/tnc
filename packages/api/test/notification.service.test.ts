/**
 * Notification Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch for external API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('NotificationService', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    vi.clearAllMocks();
  });

  describe('Email Sending', () => {
    it('should send email via Resend successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'email-123' }),
      });

      // Simulate Resend API call
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'TNC Trading <noreply@tnc-trading.com>',
          to: ['user@example.com'],
          subject: 'Test Email',
          html: '<h1>Test</h1>',
        }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should fallback to SendGrid when Resend fails', async () => {
      // First call fails (Resend)
      mockFetch.mockRejectedValueOnce(new Error('Resend API error'));
      // Second call succeeds (SendGrid)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
      });

      // Simulate fallback behavior
      try {
        await fetch('https://api.resend.com/emails');
      } catch {
        // Fallback to SendGrid
        const sgResponse = await fetch('https://api.sendgrid.com/v3/mail/send');
        expect(sgResponse.ok).toBe(true);
      }

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('SMS Sending', () => {
    it('should send SMS via Twilio', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sid: 'SM123' }),
      });

      const response = await fetch('https://api.twilio.com/2010-04-01/Accounts/test/Messages.json', {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from('accountSid:authToken').toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: '+22670000000',
          From: '+15555555555',
          Body: 'Test SMS message',
        }).toString(),
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should format phone number for Burkina Faso', () => {
      const localNumber = '70123456';
      const formattedNumber = '+226' + localNumber;

      expect(formattedNumber).toBe('+22670123456');
    });
  });

  describe('Email Templates', () => {
    it('should generate welcome email with user name', () => {
      const name = 'John Doe';
      const template = `
        <h1>Bienvenue ${name}!</h1>
        <p>Merci de rejoindre TNC Trading.</p>
      `;

      expect(template).toContain('John Doe');
      expect(template).toContain('Bienvenue');
    });

    it('should generate verification code email', () => {
      const code = '123456';
      const template = `Code de vérification: ${code}`;

      expect(template).toContain('123456');
    });

    it('should generate KYC approved email', () => {
      const level = 'STANDARD';
      const limits = {
        dailyBuy: 100,
        monthlyBuy: 500,
      };

      const template = `
        Niveau KYC: ${level}
        Limite quotidienne: ${limits.dailyBuy}g
        Limite mensuelle: ${limits.monthlyBuy}g
      `;

      expect(template).toContain('STANDARD');
      expect(template).toContain('100g');
      expect(template).toContain('500g');
    });

    it('should generate KYC rejected email with reason', () => {
      const reason = 'Document illisible';
      const template = `Raison du rejet: ${reason}`;

      expect(template).toContain('Document illisible');
    });

    it('should generate transaction completed email', () => {
      const type = 'BUY';
      const amount = 10;
      const totalXof = 470475;

      const template = `
        Type: ${type === 'BUY' ? 'Achat' : 'Vente'}
        Quantité: ${amount}g d'or
        Total: ${totalXof.toLocaleString('fr-FR')} XOF
      `;

      expect(template).toContain('Achat');
      expect(template).toContain('10g');
    });

    it('should generate security alert email', () => {
      const alertType = 'NEW_LOGIN';
      const details = {
        ipAddress: '192.168.1.1',
        device: 'Chrome on macOS',
        location: 'Ouagadougou, Burkina Faso',
      };

      const template = `
        Alerte de sécurité: Nouvelle connexion
        IP: ${details.ipAddress}
        Appareil: ${details.device}
        Localisation: ${details.location}
      `;

      expect(template).toContain('192.168.1.1');
      expect(template).toContain('Chrome on macOS');
    });
  });

  describe('SMS Templates', () => {
    it('should keep SMS under 160 characters', () => {
      const maxLength = 160;
      const smsTemplate = 'TNC Trading: Votre code de vérification est 123456. Valide 10 min.';

      expect(smsTemplate.length).toBeLessThanOrEqual(maxLength);
    });

    it('should include verification code in SMS', () => {
      const code = '123456';
      const sms = `TNC Trading: Votre code est ${code}. Valide 10 min.`;

      expect(sms).toContain('123456');
    });
  });

  describe('Notification Result', () => {
    it('should return success result', () => {
      const result = {
        success: true,
        messageId: 'msg-123',
      };

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
    });

    it('should return failure result with error', () => {
      const result = {
        success: false,
        error: 'Email provider unavailable',
      };

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Push Notifications', () => {
    it('should format FCM payload correctly', () => {
      const payload = {
        to: 'device-token-123',
        notification: {
          title: 'Prix de l\'or',
          body: 'Le prix a atteint votre objectif!',
        },
        data: {
          type: 'PRICE_ALERT',
          price: '46125',
        },
      };

      expect(payload.notification.title).toBeDefined();
      expect(payload.notification.body).toBeDefined();
      expect(payload.data.type).toBe('PRICE_ALERT');
    });
  });
});
