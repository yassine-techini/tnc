/**
 * Price Alerts Job
 * Standalone job for checking price alerts (called from price-refresh)
 */

import type { Env } from '../../types/env';

export async function checkPriceAlerts(env: Env, ctx: ExecutionContext): Promise<void> {
  console.log('[PriceAlerts] Checking price alerts');

  try {
    // Get current price from cache
    const cachedPrice = await env.CACHE.get('gold_price_latest');
    if (!cachedPrice) {
      console.log('[PriceAlerts] No cached price available');
      return;
    }

    const price = JSON.parse(cachedPrice);
    const priceXof = price.priceXof;
    const priceUsd = price.priceUsd;

    // Check XOF alerts
    const xofAboveAlerts = await env.DB.prepare(`
      SELECT pa.*, u.email, u.phone
      FROM price_alerts pa
      JOIN users u ON pa.user_id = u.id
      WHERE pa.is_active = 1
        AND pa.triggered = 0
        AND pa.currency = 'XOF'
        AND pa.alert_type = 'ABOVE'
        AND ? >= pa.target_price
    `).bind(priceXof).all();

    const xofBelowAlerts = await env.DB.prepare(`
      SELECT pa.*, u.email, u.phone
      FROM price_alerts pa
      JOIN users u ON pa.user_id = u.id
      WHERE pa.is_active = 1
        AND pa.triggered = 0
        AND pa.currency = 'XOF'
        AND pa.alert_type = 'BELOW'
        AND ? <= pa.target_price
    `).bind(priceXof).all();

    // Check USD alerts
    const usdAboveAlerts = await env.DB.prepare(`
      SELECT pa.*, u.email, u.phone
      FROM price_alerts pa
      JOIN users u ON pa.user_id = u.id
      WHERE pa.is_active = 1
        AND pa.triggered = 0
        AND pa.currency = 'USD'
        AND pa.alert_type = 'ABOVE'
        AND ? >= pa.target_price
    `).bind(priceUsd).all();

    const usdBelowAlerts = await env.DB.prepare(`
      SELECT pa.*, u.email, u.phone
      FROM price_alerts pa
      JOIN users u ON pa.user_id = u.id
      WHERE pa.is_active = 1
        AND pa.triggered = 0
        AND pa.currency = 'USD'
        AND pa.alert_type = 'BELOW'
        AND ? <= pa.target_price
    `).bind(priceUsd).all();

    const allAlerts = [
      ...(xofAboveAlerts.results || []),
      ...(xofBelowAlerts.results || []),
      ...(usdAboveAlerts.results || []),
      ...(usdBelowAlerts.results || []),
    ] as any[];

    if (allAlerts.length === 0) {
      console.log('[PriceAlerts] No alerts to trigger');
      return;
    }

    console.log(`[PriceAlerts] Triggering ${allAlerts.length} alerts`);

    // Process each alert
    for (const alert of allAlerts) {
      await triggerAlert(env, alert, alert.currency === 'XOF' ? priceXof : priceUsd);
    }

    console.log(`[PriceAlerts] Completed triggering ${allAlerts.length} alerts`);

  } catch (error) {
    console.error('[PriceAlerts] Error:', error);
    throw error;
  }
}

async function triggerAlert(env: Env, alert: any, currentPrice: number): Promise<void> {
  const direction = alert.alert_type === 'ABOVE' ? 'au-dessus de' : 'en dessous de';
  const directionEn = alert.alert_type === 'ABOVE' ? 'above' : 'below';

  try {
    // Mark as triggered
    await env.DB.prepare(`
      UPDATE price_alerts
      SET triggered = 1,
          triggered_at = datetime('now'),
          triggered_price = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(currentPrice, alert.id).run();

    // Create in-app notification
    await env.DB.prepare(`
      INSERT INTO notifications (id, user_id, type, title, body, data, created_at)
      VALUES (?, ?, 'TRANSACTION', ?, ?, ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      alert.user_id,
      'Alerte de prix declenchee',
      `Le prix de l'or est maintenant ${direction} votre seuil de ${alert.target_price.toLocaleString('fr-FR')} ${alert.currency}. Prix actuel: ${currentPrice.toLocaleString('fr-FR')} ${alert.currency}/g`,
      JSON.stringify({
        alertId: alert.id,
        targetPrice: alert.target_price,
        currentPrice: currentPrice,
        currency: alert.currency,
        alertType: alert.alert_type,
        note: alert.note,
      })
    ).run();

    // Queue external notifications based on notification_method
    if (alert.notification_method === 'ALL' || alert.notification_method === 'EMAIL') {
      // Queue email notification
      try {
        await env.NOTIFICATION_QUEUE?.send({
          type: 'PRICE_ALERT_EMAIL',
          userId: alert.user_id,
          email: alert.email,
          data: {
            alertType: alert.alert_type,
            targetPrice: alert.target_price,
            currentPrice: currentPrice,
            currency: alert.currency,
            note: alert.note,
          },
        });
      } catch (e) {
        console.warn('[PriceAlerts] Queue not available for email');
      }
    }

    if (alert.notification_method === 'ALL' || alert.notification_method === 'SMS') {
      // Queue SMS notification
      try {
        await env.NOTIFICATION_QUEUE?.send({
          type: 'PRICE_ALERT_SMS',
          userId: alert.user_id,
          phone: alert.phone,
          data: {
            alertType: alert.alert_type,
            targetPrice: alert.target_price,
            currentPrice: currentPrice,
            currency: alert.currency,
          },
        });
      } catch (e) {
        console.warn('[PriceAlerts] Queue not available for SMS');
      }
    }

    if (alert.notification_method === 'ALL' || alert.notification_method === 'PUSH') {
      // Queue push notification
      try {
        await env.NOTIFICATION_QUEUE?.send({
          type: 'PRICE_ALERT_PUSH',
          userId: alert.user_id,
          data: {
            title: 'Alerte de prix',
            body: `Or ${directionEn} ${alert.target_price} ${alert.currency}`,
            alertId: alert.id,
          },
        });
      } catch (e) {
        console.warn('[PriceAlerts] Queue not available for push');
      }
    }

  } catch (error) {
    console.error(`[PriceAlerts] Error triggering alert ${alert.id}:`, error);
  }
}
