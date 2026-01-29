/**
 * Notification Service
 * Handles Email, SMS, and Push notifications
 *
 * Providers:
 * - Email: Resend (primary), SendGrid (fallback)
 * - SMS: Twilio (primary), Orange SMS API (fallback)
 * - Push: Firebase Cloud Messaging
 */

export interface NotificationConfig {
  resendApiKey?: string;
  sendgridApiKey?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioPhoneNumber?: string;
  fcmServerKey?: string;
}

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export interface SmsOptions {
  to: string;
  message: string;
}

export interface PushOptions {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface NotificationResult {
  success: boolean;
  provider: string;
  messageId?: string;
  error?: string;
}

// Email templates
const EMAIL_TEMPLATES = {
  WELCOME: (name: string) => ({
    subject: 'Bienvenue sur TNC Trading',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center; }
          .header h1 { color: #d4a373; margin: 0; }
          .content { padding: 30px; background: #f9f9f9; }
          .button { display: inline-block; padding: 12px 30px; background: #d4a373; color: white; text-decoration: none; border-radius: 5px; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>TNC Trading</h1>
            <p style="color: #ccc;">Plateforme de Tokenisation d'Or</p>
          </div>
          <div class="content">
            <h2>Bienvenue ${name} !</h2>
            <p>Merci de rejoindre TNC Trading, la plateforme souveraine de tokenisation d'or du Burkina Faso.</p>
            <p>Avec TNC Trading, vous pouvez :</p>
            <ul>
              <li>Acheter des tokens adossés à l'or physique</li>
              <li>Suivre la valeur de votre portefeuille en temps réel</li>
              <li>Vendre vos tokens à tout moment</li>
              <li>Obtenir un certificat de propriété</li>
            </ul>
            <p>Pour commencer, complétez votre vérification KYC :</p>
            <p style="text-align: center;">
              <a href="https://app.tnc-trading.com/kyc" class="button">Compléter mon KYC</a>
            </p>
          </div>
          <div class="footer">
            <p>TNC Trading - Investissez dans l'or du Burkina Faso</p>
            <p>© 2024 TNC Trading. Tous droits réservés.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  }),

  VERIFICATION_CODE: (code: string, type: 'email' | 'phone') => ({
    subject: `Code de vérification TNC Trading: ${code}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center; }
          .header h1 { color: #d4a373; margin: 0; }
          .content { padding: 30px; background: #f9f9f9; text-align: center; }
          .code { font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #1a1a2e; padding: 20px; background: white; border-radius: 10px; display: inline-block; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>TNC Trading</h1>
          </div>
          <div class="content">
            <h2>Code de vérification</h2>
            <p>Votre code de vérification ${type === 'email' ? 'email' : 'téléphone'} est :</p>
            <div class="code">${code}</div>
            <p style="margin-top: 20px; color: #666;">Ce code expire dans 10 minutes.</p>
            <p style="color: #999; font-size: 12px;">Si vous n'avez pas demandé ce code, ignorez cet email.</p>
          </div>
          <div class="footer">
            <p>© 2024 TNC Trading. Tous droits réservés.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  }),

  KYC_APPROVED: (name: string, level: string) => ({
    subject: 'Votre KYC a été approuvé - TNC Trading',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center; }
          .header h1 { color: #d4a373; margin: 0; }
          .content { padding: 30px; background: #f9f9f9; }
          .success { background: #d4edda; border: 1px solid #c3e6cb; padding: 20px; border-radius: 5px; text-align: center; }
          .button { display: inline-block; padding: 12px 30px; background: #d4a373; color: white; text-decoration: none; border-radius: 5px; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>TNC Trading</h1>
          </div>
          <div class="content">
            <div class="success">
              <h2 style="color: #155724;">✓ KYC Approuvé</h2>
            </div>
            <p>Félicitations ${name} !</p>
            <p>Votre vérification d'identité a été approuvée. Votre niveau est maintenant : <strong>${level}</strong></p>
            <p>Vous pouvez désormais :</p>
            <ul>
              <li>Acheter et vendre des tokens d'or</li>
              <li>Effectuer des dépôts et retraits</li>
              <li>Obtenir des certificats de propriété</li>
            </ul>
            <p style="text-align: center;">
              <a href="https://app.tnc-trading.com/market" class="button">Commencer à investir</a>
            </p>
          </div>
          <div class="footer">
            <p>© 2024 TNC Trading. Tous droits réservés.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  }),

  KYC_REJECTED: (name: string, reason: string) => ({
    subject: 'Action requise: Vérification KYC - TNC Trading',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center; }
          .header h1 { color: #d4a373; margin: 0; }
          .content { padding: 30px; background: #f9f9f9; }
          .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 20px; border-radius: 5px; }
          .button { display: inline-block; padding: 12px 30px; background: #d4a373; color: white; text-decoration: none; border-radius: 5px; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>TNC Trading</h1>
          </div>
          <div class="content">
            <h2>Vérification KYC incomplète</h2>
            <p>Bonjour ${name},</p>
            <p>Votre vérification d'identité n'a pas pu être validée.</p>
            <div class="warning">
              <strong>Raison :</strong> ${reason}
            </div>
            <p>Veuillez soumettre à nouveau vos documents en vous assurant que :</p>
            <ul>
              <li>Les photos sont claires et lisibles</li>
              <li>Tous les coins du document sont visibles</li>
              <li>Le selfie montre clairement votre visage</li>
            </ul>
            <p style="text-align: center;">
              <a href="https://app.tnc-trading.com/kyc" class="button">Soumettre à nouveau</a>
            </p>
          </div>
          <div class="footer">
            <p>© 2024 TNC Trading. Tous droits réservés.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  }),

  TRANSACTION_COMPLETED: (type: string, amount: number, tokenAmount: number) => ({
    subject: `Transaction ${type} complétée - TNC Trading`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center; }
          .header h1 { color: #d4a373; margin: 0; }
          .content { padding: 30px; background: #f9f9f9; }
          .transaction { background: white; padding: 20px; border-radius: 10px; border-left: 4px solid #d4a373; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>TNC Trading</h1>
          </div>
          <div class="content">
            <h2>Transaction ${type === 'BUY' ? 'd\'achat' : 'de vente'} complétée</h2>
            <div class="transaction">
              <p><strong>Type :</strong> ${type === 'BUY' ? 'Achat' : 'Vente'}</p>
              <p><strong>Montant :</strong> ${amount.toLocaleString('fr-FR')} XOF</p>
              <p><strong>Tokens :</strong> ${tokenAmount.toFixed(3)} g d'or</p>
            </div>
            <p>Consultez votre portefeuille pour voir votre nouveau solde.</p>
          </div>
          <div class="footer">
            <p>© 2024 TNC Trading. Tous droits réservés.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  }),

  SECURITY_ALERT: (action: string, details: string) => ({
    subject: 'Alerte de sécurité - TNC Trading',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center; }
          .header h1 { color: #d4a373; margin: 0; }
          .content { padding: 30px; background: #f9f9f9; }
          .alert { background: #f8d7da; border: 1px solid #f5c6cb; padding: 20px; border-radius: 5px; }
          .button { display: inline-block; padding: 12px 30px; background: #dc3545; color: white; text-decoration: none; border-radius: 5px; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>TNC Trading</h1>
          </div>
          <div class="content">
            <div class="alert">
              <h2 style="color: #721c24;">⚠️ Alerte de sécurité</h2>
            </div>
            <p><strong>Action détectée :</strong> ${action}</p>
            <p>${details}</p>
            <p>Si ce n'était pas vous, sécurisez immédiatement votre compte :</p>
            <p style="text-align: center;">
              <a href="https://app.tnc-trading.com/security" class="button">Sécuriser mon compte</a>
            </p>
          </div>
          <div class="footer">
            <p>© 2024 TNC Trading. Tous droits réservés.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  }),

  WITHDRAWAL_APPROVED: (amount: number, method: string) => ({
    subject: 'Retrait approuvé - TNC Trading',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center; }
          .header h1 { color: #d4a373; margin: 0; }
          .content { padding: 30px; background: #f9f9f9; }
          .success { background: #d4edda; border: 1px solid #c3e6cb; padding: 20px; border-radius: 5px; text-align: center; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>TNC Trading</h1>
          </div>
          <div class="content">
            <div class="success">
              <h2 style="color: #155724;">✓ Retrait approuvé</h2>
            </div>
            <p>Votre demande de retrait a été approuvée.</p>
            <p><strong>Montant :</strong> ${amount.toLocaleString('fr-FR')} XOF</p>
            <p><strong>Méthode :</strong> ${method}</p>
            <p>Les fonds seront transférés dans les prochaines 24-48h.</p>
          </div>
          <div class="footer">
            <p>© 2024 TNC Trading. Tous droits réservés.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  }),
};

// SMS templates
const SMS_TEMPLATES = {
  VERIFICATION_CODE: (code: string) =>
    `TNC Trading: Votre code de vérification est ${code}. Valide 10 min.`,

  LOGIN_ALERT: (ip: string) =>
    `TNC Trading: Nouvelle connexion detectee depuis ${ip}. Si ce n'etait pas vous, securisez votre compte.`,

  TRANSACTION_COMPLETED: (type: string, amount: number) =>
    `TNC Trading: ${type === 'BUY' ? 'Achat' : 'Vente'} de ${amount.toLocaleString('fr-FR')} XOF complete.`,

  WITHDRAWAL_APPROVED: (amount: number) =>
    `TNC Trading: Retrait de ${amount.toLocaleString('fr-FR')} XOF approuve. Transfert en cours.`,

  TWO_FACTOR_CODE: (code: string) =>
    `TNC Trading: Code 2FA: ${code}. Ne partagez jamais ce code.`,
};

export interface NotificationQueueMessage {
  type: 'email' | 'sms' | 'push';
  payload: EmailOptions | SmsOptions | PushOptions;
}

import { ConfigService } from './config.service';

interface PlatformBranding {
  appName: string;
  appTagline: string;
  appUrl: string;
  fromEmail: string;
  fromName: string;
  copyrightYear: string;
}

export class NotificationService {
  private queue: Queue<NotificationQueueMessage> | null;
  private configService: ConfigService | null;
  private _cachedConfig: NotificationConfig | null = null;

  constructor(
    private db: D1Database,
    private config: NotificationConfig,
    queue?: Queue<NotificationQueueMessage>,
    configService?: ConfigService
  ) {
    this.queue = queue || null;
    this.configService = configService || null;
  }

  /**
   * Get notification config - loads from ConfigService if available, falls back to constructor config
   */
  private async getConfig(): Promise<NotificationConfig> {
    if (this._cachedConfig) return this._cachedConfig;

    if (this.configService) {
      const twilioConfig = await this.configService.getTwilioConfig({
        accountSid: this.config.twilioAccountSid,
        authToken: this.config.twilioAuthToken,
        phoneNumber: this.config.twilioPhoneNumber,
      });
      const resendApiKey = await this.configService.getResendApiKey(this.config.resendApiKey);
      const sendgridApiKey = await this.configService.getSendGridApiKey(this.config.sendgridApiKey);
      const fcmServerKey = await this.configService.getFcmServerKey(this.config.fcmServerKey);

      this._cachedConfig = {
        resendApiKey: resendApiKey || undefined,
        sendgridApiKey: sendgridApiKey || undefined,
        twilioAccountSid: twilioConfig.accountSid || undefined,
        twilioAuthToken: twilioConfig.authToken || undefined,
        twilioPhoneNumber: twilioConfig.phoneNumber || undefined,
        fcmServerKey: fcmServerKey || undefined,
      };
      return this._cachedConfig;
    }

    return this.config;
  }

  /**
   * Replace hardcoded branding in email content with dynamic config values
   */
  private applyBranding(content: string, branding: PlatformBranding): string {
    return content
      .replace(/TNC Trading/g, branding.appName)
      .replace(/Plateforme de Tokenisation d'Or/g, branding.appTagline)
      .replace(/https:\/\/app\.tnc-trading\.com/g, branding.appUrl)
      .replace(/noreply@tnc-trading\.com/g, branding.fromEmail)
      .replace(/© 2024/g, `\u00A9 ${branding.copyrightYear}`);
  }

  /**
   * Load platform branding from config
   */
  private async getBranding(): Promise<PlatformBranding> {
    if (!this.configService) {
      return {
        appName: 'TNC Trading',
        appTagline: 'Plateforme de Tokenisation d\'Or',
        appUrl: 'https://app.tnc-trading.com',
        fromEmail: 'noreply@tnc-trading.com',
        fromName: 'TNC Trading',
        copyrightYear: '2024',
      };
    }
    return {
      appName: await this.configService.get('app_name', 'TNC Trading') || 'TNC Trading',
      appTagline: await this.configService.get('app_tagline', 'Plateforme de Tokenisation d\'Or') || 'Plateforme de Tokenisation d\'Or',
      appUrl: await this.configService.get('app_url', 'https://app.tnc-trading.com') || 'https://app.tnc-trading.com',
      fromEmail: await this.configService.get('email_from_address', 'noreply@tnc-trading.com') || 'noreply@tnc-trading.com',
      fromName: await this.configService.get('email_from_name', 'TNC Trading') || 'TNC Trading',
      copyrightYear: await this.configService.get('copyright_year', '2024') || '2024',
    };
  }

  /**
   * Check if a provider is enabled in the integrations table
   */
  private async isProviderEnabled(provider: string): Promise<boolean> {
    try {
      const row = await this.db
        .prepare('SELECT enabled FROM integrations WHERE provider = ?')
        .bind(provider)
        .first<{ enabled: number }>();
      return row?.enabled === 1;
    } catch {
      return true;
    }
  }

  /**
   * Enqueue a notification for async delivery. Falls back to sync if queue unavailable.
   */
  async enqueueNotification(message: NotificationQueueMessage): Promise<void> {
    if (this.queue) {
      try {
        await this.queue.send(message);
        return;
      } catch (error) {
        console.error('Queue send failed, falling back to sync:', error);
      }
    }
    // Fallback: send synchronously
    await this.processNotification(message);
  }

  /**
   * Process a single notification message (used by queue consumer and sync fallback).
   */
  async processNotification(message: NotificationQueueMessage): Promise<void> {
    switch (message.type) {
      case 'email':
        await this.sendEmail(message.payload as EmailOptions);
        break;
      case 'sms':
        await this.sendSms(message.payload as SmsOptions);
        break;
      case 'push':
        await this.sendPush(message.payload as PushOptions);
        break;
    }
  }

  /**
   * Send email via Resend
   */
  private async sendViaResend(options: EmailOptions): Promise<NotificationResult> {
    const config = await this.getConfig();
    if (!config.resendApiKey) {
      return { success: false, provider: 'resend', error: 'API key not configured' };
    }

    try {
      const branding = await this.getBranding();
      const resendApiUrl = this.configService
        ? await this.configService.get('resend_api_url', 'https://api.resend.com/emails')
        : 'https://api.resend.com/emails';
      const response = await fetch(resendApiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: options.from || `${branding.fromName} <${branding.fromEmail}>`,
          to: options.to,
          subject: options.subject,
          html: options.html,
          text: options.text,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, provider: 'resend', error };
      }

      const data = await response.json() as { id: string };
      return { success: true, provider: 'resend', messageId: data.id };
    } catch (error) {
      return { success: false, provider: 'resend', error: String(error) };
    }
  }

  /**
   * Send email via SendGrid (fallback)
   */
  private async sendViaSendGrid(options: EmailOptions): Promise<NotificationResult> {
    const config = await this.getConfig();
    if (!config.sendgridApiKey) {
      return { success: false, provider: 'sendgrid', error: 'API key not configured' };
    }

    try {
      const branding = await this.getBranding();
      const sendgridApiUrl = this.configService
        ? await this.configService.get('sendgrid_api_url', 'https://api.sendgrid.com/v3/mail/send')
        : 'https://api.sendgrid.com/v3/mail/send';
      const response = await fetch(sendgridApiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.sendgridApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: options.to }] }],
          from: { email: branding.fromEmail, name: branding.fromName },
          subject: options.subject,
          content: [
            { type: 'text/html', value: options.html },
          ],
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, provider: 'sendgrid', error };
      }

      return { success: true, provider: 'sendgrid' };
    } catch (error) {
      return { success: false, provider: 'sendgrid', error: String(error) };
    }
  }

  /**
   * Send email with fallback
   */
  async sendEmail(options: EmailOptions): Promise<NotificationResult> {
    // Apply dynamic branding to email content
    const branding = await this.getBranding();
    const brandedOptions = {
      ...options,
      subject: this.applyBranding(options.subject, branding),
      html: this.applyBranding(options.html, branding),
      text: options.text ? this.applyBranding(options.text, branding) : undefined,
    };

    // Try Resend first (if enabled)
    let result: NotificationResult = { success: false, provider: 'none', error: 'No email provider enabled' };

    if (await this.isProviderEnabled('resend')) {
      result = await this.sendViaResend(brandedOptions);
    }

    // Fallback to SendGrid if Resend fails or disabled (if SendGrid enabled)
    const config = await this.getConfig();
    if (!result.success && config.sendgridApiKey && await this.isProviderEnabled('sendgrid')) {
      result = await this.sendViaSendGrid(brandedOptions);
    }

    // Log notification
    await this.logNotification('email', options.to, options.subject, result.success);

    return result;
  }

  /**
   * Send SMS via Twilio
   */
  async sendSms(options: SmsOptions): Promise<NotificationResult> {
    if (!await this.isProviderEnabled('twilio')) {
      return { success: false, provider: 'twilio', error: 'Twilio is currently disabled' };
    }

    const config = await this.getConfig();
    if (!config.twilioAccountSid || !config.twilioAuthToken) {
      return { success: false, provider: 'twilio', error: 'Twilio not configured' };
    }

    try {
      const auth = btoa(`${config.twilioAccountSid}:${config.twilioAuthToken}`);

      const twilioApiUrl = this.configService
        ? await this.configService.get('twilio_api_url', 'https://api.twilio.com/2010-04-01')
        : 'https://api.twilio.com/2010-04-01';
      const response = await fetch(
        `${twilioApiUrl}/Accounts/${config.twilioAccountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            From: config.twilioPhoneNumber || '',
            To: options.to,
            Body: this.applyBranding(options.message, await this.getBranding()),
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        return { success: false, provider: 'twilio', error };
      }

      const data = await response.json() as { sid: string };
      await this.logNotification('sms', options.to, 'SMS', true);
      return { success: true, provider: 'twilio', messageId: data.sid };
    } catch (error) {
      await this.logNotification('sms', options.to, 'SMS', false);
      return { success: false, provider: 'twilio', error: String(error) };
    }
  }

  /**
   * Send push notification via FCM
   */
  async sendPush(options: PushOptions): Promise<NotificationResult> {
    if (!await this.isProviderEnabled('fcm')) {
      return { success: false, provider: 'fcm', error: 'FCM is currently disabled' };
    }

    const config = await this.getConfig();
    if (!config.fcmServerKey) {
      return { success: false, provider: 'fcm', error: 'FCM not configured' };
    }

    try {
      const fcmApiUrl = this.configService
        ? await this.configService.get('fcm_api_url', 'https://fcm.googleapis.com/fcm/send')
        : 'https://fcm.googleapis.com/fcm/send';
      const response = await fetch(fcmApiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `key=${config.fcmServerKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: options.token,
          notification: {
            title: options.title,
            body: options.body,
          },
          data: options.data,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, provider: 'fcm', error };
      }

      const data = await response.json() as { message_id: string };
      return { success: true, provider: 'fcm', messageId: data.message_id };
    } catch (error) {
      return { success: false, provider: 'fcm', error: String(error) };
    }
  }

  /**
   * Log notification to database
   */
  private async logNotification(
    type: string,
    recipient: string,
    subject: string,
    success: boolean
  ): Promise<void> {
    try {
      await this.db
        .prepare(`
          INSERT INTO notifications (id, user_id, type, title, message, read, created_at)
          VALUES (?, NULL, ?, ?, ?, 0, datetime('now'))
        `)
        .bind(crypto.randomUUID(), type, subject, recipient)
        .run();
    } catch (error) {
      console.error('Failed to log notification:', error);
    }
  }

  /**
   * Store user notification in database
   */
  async createUserNotification(
    userId: string,
    type: string,
    title: string,
    message: string
  ): Promise<string> {
    const id = crypto.randomUUID();
    await this.db
      .prepare(`
        INSERT INTO notifications (id, user_id, type, title, message, read, created_at)
        VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
      `)
      .bind(id, userId, type, title, message)
      .run();
    return id;
  }

  /**
   * Get user notifications
   */
  async getUserNotifications(
    userId: string,
    limit: number = 50,
    unreadOnly: boolean = false
  ): Promise<any[]> {
    const query = unreadOnly
      ? 'SELECT * FROM notifications WHERE user_id = ? AND read = 0 ORDER BY created_at DESC LIMIT ?'
      : 'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?';

    const result = await this.db.prepare(query).bind(userId, limit).all();
    return result.results || [];
  }

  /**
   * Mark notifications as read
   */
  async markAsRead(notificationIds: string[], userId: string): Promise<void> {
    for (const id of notificationIds) {
      await this.db
        .prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?')
        .bind(id, userId)
        .run();
    }
  }

  // Convenience methods using templates

  async sendWelcomeEmail(email: string, name: string): Promise<NotificationResult> {
    const template = EMAIL_TEMPLATES.WELCOME(name);
    return this.sendEmail({
      to: email,
      subject: template.subject,
      html: template.html,
    });
  }

  async sendVerificationCode(
    email: string,
    code: string,
    type: 'email' | 'phone'
  ): Promise<NotificationResult> {
    const template = EMAIL_TEMPLATES.VERIFICATION_CODE(code, type);
    return this.sendEmail({
      to: email,
      subject: template.subject,
      html: template.html,
    });
  }

  async sendVerificationCodeSms(phone: string, code: string): Promise<NotificationResult> {
    return this.sendSms({
      to: phone,
      message: SMS_TEMPLATES.VERIFICATION_CODE(code),
    });
  }

  async sendKycApproved(email: string, name: string, level: string): Promise<NotificationResult> {
    const template = EMAIL_TEMPLATES.KYC_APPROVED(name, level);
    return this.sendEmail({
      to: email,
      subject: template.subject,
      html: template.html,
    });
  }

  async sendKycRejected(email: string, name: string, reason: string): Promise<NotificationResult> {
    const template = EMAIL_TEMPLATES.KYC_REJECTED(name, reason);
    return this.sendEmail({
      to: email,
      subject: template.subject,
      html: template.html,
    });
  }

  async sendTransactionCompleted(
    email: string,
    type: string,
    amount: number,
    tokenAmount: number
  ): Promise<NotificationResult> {
    const template = EMAIL_TEMPLATES.TRANSACTION_COMPLETED(type, amount, tokenAmount);
    return this.sendEmail({
      to: email,
      subject: template.subject,
      html: template.html,
    });
  }

  async sendSecurityAlert(
    email: string,
    action: string,
    details: string
  ): Promise<NotificationResult> {
    const template = EMAIL_TEMPLATES.SECURITY_ALERT(action, details);
    return this.sendEmail({
      to: email,
      subject: template.subject,
      html: template.html,
    });
  }

  async sendWithdrawalApproved(
    email: string,
    amount: number,
    method: string
  ): Promise<NotificationResult> {
    const template = EMAIL_TEMPLATES.WITHDRAWAL_APPROVED(amount, method);
    return this.sendEmail({
      to: email,
      subject: template.subject,
      html: template.html,
    });
  }

  async sendWithdrawalApprovedSms(phone: string, amount: number): Promise<NotificationResult> {
    return this.sendSms({
      to: phone,
      message: SMS_TEMPLATES.WITHDRAWAL_APPROVED(amount),
    });
  }

  async send2FaCodeSms(phone: string, code: string): Promise<NotificationResult> {
    return this.sendSms({
      to: phone,
      message: SMS_TEMPLATES.TWO_FACTOR_CODE(code),
    });
  }
}
