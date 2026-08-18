/**
 * Notification Service
 * Handles Email, SMS, and Push notifications
 *
 * Providers:
 * - Email: Resend (primary), SendGrid (fallback)
 * - SMS: Twilio (primary), Orange SMS API (fallback)
 * - Push: Firebase Cloud Messaging
 */

import {
  ACCROCHE, PIED, BIENVENUE, CODE_VERIFICATION, KYC_APPROUVE, KYC_REFUSE,
  TRANSACTION_TERMINEE, ALERTE_SECURITE, RETRAIT_APPROUVE, SMS,
  type Langue, type TexteCourriel,
} from '../lib/textes-notification';

export interface NotificationConfig {
  resendApiKey?: string;
  sendgridApiKey?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioPhoneNumber?: string;
  /**
   * Service account JSON for FCM HTTP v1. Replaces the former `fcmServerKey`:
   * the legacy server-key endpoint was shut down by Google in June 2024.
   */
  fcmServiceAccount?: string;
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

/** Matches the CHECK constraint on notifications.type (migration 0001). */
export type NotificationType = 'TRANSACTION' | 'KYC' | 'SECURITY' | 'MARKETING' | 'SYSTEM';

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
  /** Set when the provider says this device token will never work again. */
  invalidToken?: boolean;
  error?: string;
}

/**
 * UNE coquille, un texte par langue (ADR 020).
 *
 * Les gabarits melaient texte et mise en page sur des centaines de lignes ; les
 * dupliquer par langue aurait double ce fichier. Le texte vit desormais dans
 * `lib/textes-notification`, et cette fonction l'habille.
 */
function habiller(t: TexteCourriel, langue: Langue): { subject: string; html: string } {
  const puces = t.puces?.length
    ? `<ul>${t.puces.map((p) => `<li>${p}</li>`).join('')}</ul>`
    : '';
  const bouton = t.bouton
    ? `<p style="text-align:center;"><a href="${t.bouton.lien}" class="button">${t.bouton.libelle}</a></p>`
    : '';

  return {
    subject: t.sujet,
    html: `
      <!DOCTYPE html>
      <html lang="${langue}">
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center; }
          .header h1 { color: #d4a373; margin: 0; }
          .content { padding: 30px; background: #f9f9f9; }
          .button { display: inline-block; padding: 12px 30px; background: #d4a373; color: white; text-decoration: none; border-radius: 5px; }
          .footer { padding: 20px; text-align: center; color: #888; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>TNC Trading</h1>
            <p style="color:#ccc;">${ACCROCHE[langue]}</p>
          </div>
          <div class="content">
            <h2>${t.titre}</h2>
            ${t.paragraphes.map((par) => `<p>${par}</p>`).join('')}
            ${puces}
            ${bouton}
          </div>
          <div class="footer"><p>${PIED[langue]}</p></div>
        </div>
      </body>
      </html>
    `,
  };
}



export interface NotificationQueueMessage {
  type: 'email' | 'sms' | 'push';
  payload: EmailOptions | SmsOptions | PushOptions;
}

import { ConfigService } from './config.service';
import { PushTokenService, isTokenPermanentlyInvalid } from './push-token.service';
import {
  parseServiceAccount,
  getAccessToken,
  messagingEndpoint,
  buildMessage,
} from '../lib/fcm-oauth';

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
      const fcmServiceAccount = await this.configService.getFcmServiceAccount(this.config.fcmServiceAccount);

      this._cachedConfig = {
        resendApiKey: resendApiKey || undefined,
        sendgridApiKey: sendgridApiKey || undefined,
        twilioAccountSid: twilioConfig.accountSid || undefined,
        twilioAuthToken: twilioConfig.authToken || undefined,
        twilioPhoneNumber: twilioConfig.phoneNumber || undefined,
        fcmServiceAccount: fcmServiceAccount || undefined,
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
      return { success: true, provider: 'twilio', messageId: data.sid };
    } catch (error) {
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

    // HTTP v1. The legacy `fcm/send` endpoint with a server key was shut down by
    // Google in June 2024 — this path had been dead, not merely deprecated.
    const rawAccount = this.configService
      ? await this.configService.get('fcm_service_account', this.config.fcmServiceAccount)
      : this.config.fcmServiceAccount;
    const account = parseServiceAccount(rawAccount || undefined);
    if (!account) {
      return { success: false, provider: 'fcm', error: 'FCM not configured' };
    }

    try {
      const accessToken = await getAccessToken(account, this.configService?.cache ?? null);
      if (!accessToken) {
        return { success: false, provider: 'fcm', error: 'FCM authentication failed' };
      }

      const response = await fetch(messagingEndpoint(account.project_id), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildMessage(options)),
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          provider: 'fcm',
          error,
          // Lets the caller prune the device instead of retrying it forever.
          invalidToken: isTokenPermanentlyInvalid(response.status, error),
        };
      }

      // v1 returns the message name, not message_id.
      const data = await response.json() as { name?: string };
      return { success: true, provider: 'fcm', messageId: data.name };
    } catch (error) {
      return { success: false, provider: 'fcm', error: String(error) };
    }
  }

  /**
   * Send one notification to every active device of a user.
   *
   * Tokens the provider rejects as unknown are deactivated: without pruning,
   * `push_tokens` fills with dead installations and every later notification
   * pays for calls that cannot land. Only permanent rejections deactivate —
   * a quota error or a 5xx must not unsubscribe a working device.
   */
  async sendPushToUser(
    userId: string,
    options: Omit<PushOptions, 'token'>
  ): Promise<{ sent: number; failed: number; deactivated: number }> {
    const pushTokens = new PushTokenService(this.db);
    const tokens = await pushTokens.listActive(userId);

    let sent = 0;
    let failed = 0;
    let deactivated = 0;

    for (const row of tokens) {
      const result = await this.sendPush({ ...options, token: row.token });
      if (result.success) {
        sent++;
        continue;
      }
      failed++;
      if (result.invalidToken && (await pushTokens.deactivate(row.token))) {
        deactivated++;
      }
    }

    return { sent, failed, deactivated };
  }

  /**
   * Record an in-app notification and push it to the user's devices.
   *
   * Replaces two writers that could never have worked: both inserted into a
   * `message` column, while the table (0001) has `body`. logNotification also
   * bound user_id = NULL against a NOT NULL column and a type outside the CHECK
   * list — it was wrapped in try/catch, so every email and SMS "logged" nothing
   * at all. Delivery logs never belonged in this table anyway: `notifications`
   * is the feed the user reads in the app.
   *
   * Push failures never propagate: the in-app record is the durable one, and a
   * device that cannot be reached must not fail the business operation that
   * triggered the notification.
   */
  async notifyUser(p: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, string>;
  }): Promise<string> {
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO notifications (id, user_id, type, title, body, data, read, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))`
      )
      .bind(id, p.userId, p.type, p.title, p.body, p.data ? JSON.stringify(p.data) : null)
      .run();

    try {
      await this.sendPushToUser(p.userId, { title: p.title, body: p.body, data: p.data });
    } catch (error) {
      console.error('Push delivery failed for notification', id, String(error));
    }

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

  async sendWelcomeEmail(email: string, name: string, langue: Langue = 'fr'): Promise<NotificationResult> {
    const template = habiller(BIENVENUE[langue](name), langue);
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
  ,
    langue: Langue = 'fr'
  ): Promise<NotificationResult> {
    const template = habiller(CODE_VERIFICATION[langue](code, type), langue);
    return this.sendEmail({
      to: email,
      subject: template.subject,
      html: template.html,
    });
  }

  async sendVerificationCodeSms(phone: string, code: string, langue: Langue = 'fr'): Promise<NotificationResult> {
    return this.sendSms({
      to: phone,
      message: (SMS.CODE_VERIFICATION[langue] as (c: string) => string)(code),
    });
  }

  async sendKycApproved(email: string, name: string, level: string,
    langue: Langue = 'fr'
  ): Promise<NotificationResult> {
    const template = habiller(KYC_APPROUVE[langue](name, level), langue);
    return this.sendEmail({
      to: email,
      subject: template.subject,
      html: template.html,
    });
  }

  async sendKycRejected(email: string, name: string, reason: string,
    langue: Langue = 'fr'
  ): Promise<NotificationResult> {
    const template = habiller(KYC_REFUSE[langue](name, reason), langue);
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
  ,
    langue: Langue = 'fr'
  ): Promise<NotificationResult> {
    const template = habiller(TRANSACTION_TERMINEE[langue](type, String(amount), tokenAmount), langue);
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
  ,
    langue: Langue = 'fr'
  ): Promise<NotificationResult> {
    const template = habiller(ALERTE_SECURITE[langue](action, details), langue);
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
  ,
    langue: Langue = 'fr'
  ): Promise<NotificationResult> {
    const template = habiller(RETRAIT_APPROUVE[langue](String(amount), method), langue);
    return this.sendEmail({
      to: email,
      subject: template.subject,
      html: template.html,
    });
  }

  async sendWithdrawalApprovedSms(phone: string, amount: number, langue: Langue = 'fr'): Promise<NotificationResult> {
    return this.sendSms({
      to: phone,
      message: (SMS.RETRAIT_APPROUVE[langue] as (m: string) => string)(String(amount)),
    });
  }

  async send2FaCodeSms(phone: string, code: string, langue: Langue = 'fr'): Promise<NotificationResult> {
    return this.sendSms({
      to: phone,
      message: (SMS.CODE_2FA[langue] as (c: string) => string)(code),
    });
  }
}
