import { NotificationService } from './notification.service';

interface PriceAlert {
  id: string;
  user_id: string;
  alert_type: 'ABOVE' | 'BELOW';
  target_price: number;
  currency: 'XOF' | 'USD';
  notification_method: 'PUSH' | 'EMAIL' | 'SMS' | 'ALL';
  note: string | null;
}

interface UserInfo {
  email: string;
  phone: string;
}

interface TriggerResult {
  alertId: string;
  userId: string;
  triggered: boolean;
  notified: boolean;
}

export class PriceAlertService {
  constructor(
    private db: D1Database,
    private notificationService: NotificationService
  ) {}

  /**
   * Check all active alerts against the current price and trigger notifications
   */
  async checkAndTriggerAlerts(
    currentPriceXof: number,
    currentPriceUsd: number
  ): Promise<{ triggered: number; notified: number; errors: number }> {
    const results = {
      triggered: 0,
      notified: 0,
      errors: 0,
    };

    try {
      // Get all active, non-triggered alerts
      const alerts = await this.db
        .prepare(`
          SELECT pa.*, u.email, u.phone
          FROM price_alerts pa
          JOIN users u ON pa.user_id = u.id
          WHERE pa.is_active = 1 AND pa.triggered = 0
        `)
        .all<PriceAlert & UserInfo>();

      if (!alerts.results || alerts.results.length === 0) {
        return results;
      }

      for (const alert of alerts.results) {
        try {
          const currentPrice = alert.currency === 'XOF' ? currentPriceXof : currentPriceUsd;
          const shouldTrigger = this.shouldTrigger(alert, currentPrice);

          if (shouldTrigger) {
            // Mark alert as triggered
            await this.db
              .prepare(`
                UPDATE price_alerts
                SET triggered = 1, triggered_at = datetime('now'), triggered_price = ?, updated_at = datetime('now')
                WHERE id = ?
              `)
              .bind(currentPrice, alert.id)
              .run();

            results.triggered++;

            // Send notification
            const notified = await this.sendAlertNotification(
              alert,
              { email: alert.email, phone: alert.phone },
              currentPrice
            );

            if (notified) {
              results.notified++;
            }

            // Create in-app notification
            await this.createInAppNotification(alert, currentPrice);
          }
        } catch (alertError) {
          console.error(`Error processing alert ${alert.id}:`, alertError);
          results.errors++;
        }
      }
    } catch (error) {
      console.error('Error checking price alerts:', error);
      throw error;
    }

    return results;
  }

  private shouldTrigger(alert: PriceAlert, currentPrice: number): boolean {
    if (alert.alert_type === 'ABOVE') {
      return currentPrice >= alert.target_price;
    } else {
      return currentPrice <= alert.target_price;
    }
  }

  private async sendAlertNotification(
    alert: PriceAlert,
    user: UserInfo,
    currentPrice: number
  ): Promise<boolean> {
    const direction = alert.alert_type === 'ABOVE' ? 'au-dessus de' : 'en-dessous de';
    const currencySymbol = alert.currency === 'XOF' ? 'XOF' : 'USD';
    const formattedTarget = alert.target_price.toLocaleString('fr-FR');
    const formattedCurrent = currentPrice.toLocaleString('fr-FR');

    const subject = `🔔 Alerte Prix Or - ${alert.alert_type === 'ABOVE' ? '📈' : '📉'} TNC Trading`;
    const message = `Le prix de l'or est passé ${direction} ${formattedTarget} ${currencySymbol}. Prix actuel: ${formattedCurrent} ${currencySymbol}${alert.note ? `. Note: ${alert.note}` : ''}`;

    let notified = false;

    try {
      const method = alert.notification_method;

      if (method === 'EMAIL' || method === 'ALL') {
        await this.notificationService.sendEmail({
          to: user.email,
          subject,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: ${alert.alert_type === 'ABOVE' ? '#22c55e' : '#ef4444'};">
                ${alert.alert_type === 'ABOVE' ? '📈' : '📉'} Alerte Prix Déclenchée
              </h2>
              <p>${message}</p>
              <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
                <p style="margin: 0;"><strong>Prix cible:</strong> ${formattedTarget} ${currencySymbol}</p>
                <p style="margin: 8px 0 0;"><strong>Prix actuel:</strong> ${formattedCurrent} ${currencySymbol}</p>
              </div>
              <p style="color: #6b7280; font-size: 14px;">
                Connectez-vous à votre compte TNC Trading pour acheter ou vendre de l'or.
              </p>
            </div>
          `,
        });
        notified = true;
      }

      if (method === 'SMS' || method === 'ALL') {
        if (user.phone) {
          await this.notificationService.sendSms({
            to: user.phone,
            body: `TNC Trading: ${message}`,
          });
          notified = true;
        }
      }

      if (method === 'PUSH' || method === 'ALL') {
        await this.notificationService.sendPushToUser(alert.user_id, {
          title: subject,
          body: message,
          data: {
            type: 'PRICE_ALERT',
            alertId: alert.id,
            currentPrice: currentPrice.toString(),
          },
        });
        notified = true;
      }
    } catch (error) {
      console.error('Failed to send alert notification:', error);
    }

    return notified;
  }

  private async createInAppNotification(alert: PriceAlert, currentPrice: number): Promise<void> {
    const direction = alert.alert_type === 'ABOVE' ? 'au-dessus de' : 'en-dessous de';
    const currencySymbol = alert.currency === 'XOF' ? 'XOF' : 'USD';

    await this.db
      .prepare(`
        INSERT INTO notifications (id, user_id, type, title, body, data, created_at)
        VALUES (?, ?, 'SYSTEM', ?, ?, ?, datetime('now'))
      `)
      .bind(
        crypto.randomUUID(),
        alert.user_id,
        'Alerte Prix Déclenchée',
        `Le prix de l'or est passé ${direction} ${alert.target_price.toLocaleString('fr-FR')} ${currencySymbol}. Prix actuel: ${currentPrice.toLocaleString('fr-FR')} ${currencySymbol}`,
        JSON.stringify({
          alertId: alert.id,
          alertType: alert.alert_type,
          targetPrice: alert.target_price,
          triggeredPrice: currentPrice,
          currency: alert.currency,
        })
      )
      .run();
  }

  /**
   * Get alerts that are close to being triggered (within 5%)
   */
  async getAlertsNearTrigger(
    currentPriceXof: number,
    currentPriceUsd: number,
    threshold: number = 0.05
  ): Promise<any[]> {
    const xofLower = currentPriceXof * (1 - threshold);
    const xofUpper = currentPriceXof * (1 + threshold);
    const usdLower = currentPriceUsd * (1 - threshold);
    const usdUpper = currentPriceUsd * (1 + threshold);

    const nearAlerts = await this.db
      .prepare(`
        SELECT pa.*, u.email
        FROM price_alerts pa
        JOIN users u ON pa.user_id = u.id
        WHERE pa.is_active = 1 AND pa.triggered = 0
          AND (
            (pa.currency = 'XOF' AND pa.target_price BETWEEN ? AND ?)
            OR (pa.currency = 'USD' AND pa.target_price BETWEEN ? AND ?)
          )
      `)
      .bind(xofLower, xofUpper, usdLower, usdUpper)
      .all<any>();

    return nearAlerts.results || [];
  }
}
