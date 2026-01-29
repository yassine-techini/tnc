/**
 * Alert Service
 * Manages alert rules, triggers alerts, and sends notifications
 */

import type { D1Database } from '@cloudflare/workers-types';

export interface AlertRule {
  id: string;
  name: string;
  description?: string;
  metric: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  threshold: number;
  severity: 'info' | 'warning' | 'critical';
  cooldownMinutes: number;
  notifyEmail: boolean;
  notifySms: boolean;
  notifyWebhook?: string;
  enabled: boolean;
  lastTriggeredAt?: string;
}

export interface AlertQueueMessage {
  type: 'ALERT_TRIGGER';
  ruleId: string;
  ruleName: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  currentValue: number;
  threshold: number;
  notifyEmail: boolean;
  notifySms: boolean;
  notifyWebhook?: string;
}

export interface NotificationConfig {
  resendApiKey?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioPhoneNumber?: string;
  alertEmailRecipients?: string; // Comma-separated
  alertSmsRecipients?: string; // Comma-separated
}

/**
 * Check if a value triggers an alert based on the rule
 */
function evaluateCondition(
  value: number,
  operator: AlertRule['operator'],
  threshold: number
): boolean {
  switch (operator) {
    case '>': return value > threshold;
    case '<': return value < threshold;
    case '>=': return value >= threshold;
    case '<=': return value <= threshold;
    case '==': return value === threshold;
    case '!=': return value !== threshold;
    default: return false;
  }
}

/**
 * Alert Service for managing and processing alerts
 */
export class AlertService {
  constructor(
    private db: D1Database,
    private alertQueue: Queue | undefined,
    private notificationConfig: NotificationConfig
  ) {}

  /**
   * Get all enabled alert rules
   */
  async getEnabledRules(): Promise<AlertRule[]> {
    const result = await this.db
      .prepare(`
        SELECT id, name, description, metric, operator, threshold, severity,
               cooldown_minutes, notify_email, notify_sms, notify_webhook,
               enabled, last_triggered_at
        FROM alert_rules
        WHERE enabled = 1
      `)
      .all<{
        id: string;
        name: string;
        description: string | null;
        metric: string;
        operator: string;
        threshold: number;
        severity: string;
        cooldown_minutes: number;
        notify_email: number;
        notify_sms: number;
        notify_webhook: string | null;
        enabled: number;
        last_triggered_at: string | null;
      }>();

    return (result.results || []).map(row => ({
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      metric: row.metric,
      operator: row.operator as AlertRule['operator'],
      threshold: row.threshold,
      severity: row.severity as AlertRule['severity'],
      cooldownMinutes: row.cooldown_minutes,
      notifyEmail: row.notify_email === 1,
      notifySms: row.notify_sms === 1,
      notifyWebhook: row.notify_webhook || undefined,
      enabled: row.enabled === 1,
      lastTriggeredAt: row.last_triggered_at || undefined,
    }));
  }

  /**
   * Evaluate metrics against all enabled rules
   */
  async evaluateRules(metrics: Record<string, number>): Promise<void> {
    const rules = await this.getEnabledRules();
    const now = new Date();

    for (const rule of rules) {
      const metricValue = metrics[rule.metric];
      if (metricValue === undefined) continue;

      // Check if condition is met
      if (!evaluateCondition(metricValue, rule.operator, rule.threshold)) {
        continue;
      }

      // Check cooldown
      if (rule.lastTriggeredAt) {
        const lastTriggered = new Date(rule.lastTriggeredAt);
        const cooldownMs = rule.cooldownMinutes * 60 * 1000;
        if (now.getTime() - lastTriggered.getTime() < cooldownMs) {
          continue; // Still in cooldown
        }
      }

      // Trigger alert
      await this.triggerAlert(rule, metricValue);
    }
  }

  /**
   * Trigger an alert
   */
  private async triggerAlert(rule: AlertRule, currentValue: number): Promise<void> {
    const alertId = crypto.randomUUID();
    const now = new Date().toISOString();
    const message = `${rule.name}: ${rule.metric} = ${currentValue} (seuil: ${rule.operator} ${rule.threshold})`;

    // Insert alert record
    await this.db
      .prepare(`
        INSERT INTO alerts (
          id, rule_id, rule_name, severity, message,
          current_value, threshold, triggered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        alertId,
        rule.id,
        rule.name,
        rule.severity,
        message,
        currentValue,
        rule.threshold,
        now
      )
      .run();

    // Update rule's last triggered timestamp
    await this.db
      .prepare('UPDATE alert_rules SET last_triggered_at = ? WHERE id = ?')
      .bind(now, rule.id)
      .run();

    // Queue notification
    if (this.alertQueue) {
      const queueMessage: AlertQueueMessage = {
        type: 'ALERT_TRIGGER',
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        message,
        currentValue,
        threshold: rule.threshold,
        notifyEmail: rule.notifyEmail,
        notifySms: rule.notifySms,
        notifyWebhook: rule.notifyWebhook,
      };

      await this.alertQueue.send(queueMessage);
    } else {
      // If no queue, send notifications directly
      await this.sendNotifications(rule, message);
    }

    console.log(`[Alert] Triggered: ${message}`);
  }

  /**
   * Send alert notifications
   */
  async sendNotifications(rule: AlertRule, message: string): Promise<void> {
    const promises: Promise<void>[] = [];

    // Email notification
    if (rule.notifyEmail && this.notificationConfig.resendApiKey) {
      const recipients = this.notificationConfig.alertEmailRecipients?.split(',').map(e => e.trim()) || [];
      for (const email of recipients) {
        promises.push(this.sendEmailNotification(email, rule, message));
      }
    }

    // SMS notification
    if (rule.notifySms && this.notificationConfig.twilioAccountSid) {
      const recipients = this.notificationConfig.alertSmsRecipients?.split(',').map(e => e.trim()) || [];
      for (const phone of recipients) {
        promises.push(this.sendSmsNotification(phone, rule, message));
      }
    }

    // Webhook notification
    if (rule.notifyWebhook) {
      promises.push(this.sendWebhookNotification(rule.notifyWebhook, rule, message));
    }

    await Promise.allSettled(promises);
  }

  /**
   * Send email notification via Resend
   */
  private async sendEmailNotification(
    to: string,
    rule: AlertRule,
    message: string
  ): Promise<void> {
    if (!this.notificationConfig.resendApiKey) return;

    const severityColors: Record<string, string> = {
      info: '#3B82F6',
      warning: '#F59E0B',
      critical: '#EF4444',
    };

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.notificationConfig.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'TNC Trading <alerts@tnc.trading>',
          to: [to],
          subject: `[${rule.severity.toUpperCase()}] ${rule.name}`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: ${severityColors[rule.severity]}; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0;">
                <h1 style="margin: 0; font-size: 20px;">Alerte TNC Trading</h1>
                <p style="margin: 4px 0 0; opacity: 0.9; font-size: 14px;">${rule.severity.toUpperCase()}</p>
              </div>
              <div style="border: 1px solid #e5e7eb; border-top: 0; padding: 24px; border-radius: 0 0 8px 8px;">
                <h2 style="margin: 0 0 16px; font-size: 18px; color: #1f2937;">${rule.name}</h2>
                <p style="margin: 0 0 16px; color: #4b5563;">${message}</p>
                <p style="margin: 0; font-size: 12px; color: #9ca3af;">
                  ${new Date().toLocaleString('fr-FR')}
                </p>
              </div>
            </div>
          `,
        }),
      });
    } catch (error) {
      console.error('[Alert] Email notification failed:', error);
    }
  }

  /**
   * Send SMS notification via Twilio
   */
  private async sendSmsNotification(
    to: string,
    rule: AlertRule,
    message: string
  ): Promise<void> {
    if (!this.notificationConfig.twilioAccountSid ||
        !this.notificationConfig.twilioAuthToken ||
        !this.notificationConfig.twilioPhoneNumber) {
      return;
    }

    try {
      const auth = btoa(`${this.notificationConfig.twilioAccountSid}:${this.notificationConfig.twilioAuthToken}`);

      await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.notificationConfig.twilioAccountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            From: this.notificationConfig.twilioPhoneNumber,
            To: to,
            Body: `[TNC ${rule.severity.toUpperCase()}] ${message}`,
          }),
        }
      );
    } catch (error) {
      console.error('[Alert] SMS notification failed:', error);
    }
  }

  /**
   * Send webhook notification
   */
  private async sendWebhookNotification(
    webhookUrl: string,
    rule: AlertRule,
    message: string
  ): Promise<void> {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'ALERT',
          severity: rule.severity,
          ruleName: rule.name,
          message,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch (error) {
      console.error('[Alert] Webhook notification failed:', error);
    }
  }

  /**
   * Process alert queue message
   */
  async processQueueMessage(message: AlertQueueMessage): Promise<void> {
    const rule: AlertRule = {
      id: message.ruleId,
      name: message.ruleName,
      metric: '',
      operator: '>',
      threshold: message.threshold,
      severity: message.severity,
      cooldownMinutes: 0,
      notifyEmail: message.notifyEmail,
      notifySms: message.notifySms,
      notifyWebhook: message.notifyWebhook,
      enabled: true,
    };

    await this.sendNotifications(rule, message.message);
  }
}
