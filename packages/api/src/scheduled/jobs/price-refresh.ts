/**
 * Price Refresh Job
 * Fetches latest gold prices and triggers price alerts
 */

import type { Env } from '../../types/env';
import { ConfigService } from '../../services/config.service';

// Defaults used when ConfigService is unavailable
const DEFAULT_GOLD_API_BASE = 'https://www.goldapi.io/api';
const DEFAULT_CACHE_KEY = 'gold_price_latest';
const DEFAULT_CACHE_TTL = 300; // 5 minutes
const DEFAULT_EXCHANGE_RATE_API_URL = 'https://v6.exchangerate-api.com/v6';
const DEFAULT_FALLBACK_EXCHANGE_RATE = 615;

interface GoldApiResponse {
  price: number;
  price_gram_24k: number;
  currency: string;
  timestamp: number;
}

export async function refreshGoldPrice(env: Env, ctx: ExecutionContext): Promise<void> {
  console.log('[PriceRefresh] Starting gold price refresh');

  const configService = new ConfigService(env.DB, env.CACHE);

  try {
    // Load config values
    const [goldApiBase, cacheTtl, exchangeRateApiUrl, fallbackRate] = await Promise.all([
      configService.get('gold_api_base_url', DEFAULT_GOLD_API_BASE),
      configService.getNumber('gold_price_cache_ttl', DEFAULT_CACHE_TTL),
      configService.get('exchange_rate_api_url', DEFAULT_EXCHANGE_RATE_API_URL),
      configService.getNumber('fallback_exchange_rate', DEFAULT_FALLBACK_EXCHANGE_RATE),
    ]);

    // Fetch USD price
    const usdPrice = await fetchGoldPrice(env, 'USD', goldApiBase);
    if (!usdPrice) {
      throw new Error('Failed to fetch USD gold price');
    }

    // Fetch exchange rate USD/XOF
    const exchangeRate = await fetchExchangeRate(env, exchangeRateApiUrl, fallbackRate);
    if (!exchangeRate) {
      throw new Error('Failed to fetch exchange rate');
    }

    // Calculate XOF price
    const priceXof = usdPrice * exchangeRate;

    // Get spreads from config
    const spreadBuy = parseFloat(await getConfig(env, 'spread_buy') || '0.02');
    const spreadSell = parseFloat(await getConfig(env, 'spread_sell') || '0.02');

    // Calculate buy/sell prices
    const buyPrice = priceXof * (1 + spreadBuy);
    const sellPrice = priceXof * (1 - spreadSell);

    // Store in database
    const priceId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO gold_prices (id, price_usd, price_xof, exchange_rate, spread_buy, spread_sell, buy_price, sell_price, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      priceId,
      usdPrice,
      priceXof,
      exchangeRate,
      spreadBuy,
      spreadSell,
      buyPrice,
      sellPrice,
      'goldapi.io'
    ).run();

    // Cache the latest price
    const priceData = {
      id: priceId,
      priceUsd: usdPrice,
      priceXof: priceXof,
      exchangeRate: exchangeRate,
      buyPrice: buyPrice,
      sellPrice: sellPrice,
      updatedAt: new Date().toISOString(),
    };

    await env.CACHE.put(DEFAULT_CACHE_KEY, JSON.stringify(priceData), {
      expirationTtl: cacheTtl,
    });

    console.log(`[PriceRefresh] Updated price: ${usdPrice} USD, ${priceXof.toFixed(2)} XOF`);

    // Check and trigger price alerts
    ctx.waitUntil(checkAndTriggerAlerts(env, priceXof, usdPrice));

  } catch (error) {
    console.error('[PriceRefresh] Error:', error);
    throw error;
  }
}

async function fetchGoldPrice(env: Env, currency: string, goldApiBase: string): Promise<number | null> {
  try {
    const response = await fetch(`${goldApiBase}/XAU/${currency}`, {
      headers: {
        'x-access-token': env.GOLD_API_KEY,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[PriceRefresh] Gold API error: ${response.status}`);
      return null;
    }

    const data = await response.json() as GoldApiResponse;
    return data.price_gram_24k;
  } catch (error) {
    console.error('[PriceRefresh] Failed to fetch gold price:', error);
    return null;
  }
}

async function fetchExchangeRate(env: Env, exchangeRateApiUrl: string, fallbackRate: number): Promise<number | null> {
  try {
    // Try primary source
    const response = await fetch(
      `${exchangeRateApiUrl}/${env.EXCHANGE_RATE_API_KEY}/latest/USD`
    );

    if (response.ok) {
      const data = await response.json() as { conversion_rates: { XOF: number } };
      return data.conversion_rates?.XOF || null;
    }

    // Fallback: Use configured fallback rate
    console.warn('[PriceRefresh] Using fallback exchange rate');
    return fallbackRate;
  } catch (error) {
    console.error('[PriceRefresh] Failed to fetch exchange rate:', error);
    return fallbackRate;
  }
}

async function getConfig(env: Env, key: string): Promise<string | null> {
  const result = await env.DB.prepare(
    'SELECT value FROM config WHERE key = ?'
  ).bind(key).first<{ value: string }>();
  return result?.value || null;
}

async function checkAndTriggerAlerts(env: Env, priceXof: number, priceUsd: number): Promise<void> {
  try {
    // Find triggered alerts (XOF)
    const xofAlerts = await env.DB.prepare(`
      SELECT pa.*, u.email, u.phone
      FROM price_alerts pa
      JOIN users u ON pa.user_id = u.id
      WHERE pa.is_active = 1
        AND pa.triggered = 0
        AND pa.currency = 'XOF'
        AND (
          (pa.alert_type = 'ABOVE' AND ? >= pa.target_price)
          OR (pa.alert_type = 'BELOW' AND ? <= pa.target_price)
        )
    `).bind(priceXof, priceXof).all();

    // Find triggered alerts (USD)
    const usdAlerts = await env.DB.prepare(`
      SELECT pa.*, u.email, u.phone
      FROM price_alerts pa
      JOIN users u ON pa.user_id = u.id
      WHERE pa.is_active = 1
        AND pa.triggered = 0
        AND pa.currency = 'USD'
        AND (
          (pa.alert_type = 'ABOVE' AND ? >= pa.target_price)
          OR (pa.alert_type = 'BELOW' AND ? <= pa.target_price)
        )
    `).bind(priceUsd, priceUsd).all();

    const allAlerts = [...(xofAlerts.results || []), ...(usdAlerts.results || [])];

    if (allAlerts.length === 0) {
      return;
    }

    console.log(`[PriceRefresh] Triggering ${allAlerts.length} price alerts`);

    // Mark alerts as triggered and create notifications
    for (const alert of allAlerts) {
      const currentPrice = alert.currency === 'XOF' ? priceXof : priceUsd;
      const direction = alert.alert_type === 'ABOVE' ? 'above' : 'below';

      // Mark as triggered
      await env.DB.prepare(`
        UPDATE price_alerts
        SET triggered = 1, triggered_at = datetime('now'), triggered_price = ?
        WHERE id = ?
      `).bind(currentPrice, alert.id).run();

      // Create notification
      await env.DB.prepare(`
        INSERT INTO notifications (id, user_id, type, title, body, data)
        VALUES (?, ?, 'TRANSACTION', ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        alert.user_id,
        'Price Alert Triggered',
        `Gold price is now ${direction} your target of ${alert.target_price} ${alert.currency}. Current price: ${currentPrice.toFixed(2)} ${alert.currency}`,
        JSON.stringify({
          alertId: alert.id,
          targetPrice: alert.target_price,
          currentPrice: currentPrice,
          currency: alert.currency,
          alertType: alert.alert_type,
        })
      ).run();
    }

  } catch (error) {
    console.error('[PriceRefresh] Error checking price alerts:', error);
  }
}
