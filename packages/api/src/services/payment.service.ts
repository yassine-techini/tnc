/**
 * Payment Service
 * Handles payment provider integrations
 *
 * Supported providers:
 * - Orange Money Burkina Faso
 * - Moov Money
 * - CinetPay (card payments)
 * - Bank transfers
 */

export interface PaymentConfig {
  orangeMoneyApiKey?: string;
  orangeMoneyMerchantId?: string;
  orangeMoneyClientId?: string;
  orangeMoneyClientSecret?: string;
  moovApiKey?: string;
  moovMerchantId?: string;
  cinetpayApiKey?: string;
  cinetpaySiteId?: string;
  webhookSecret?: string;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
}

export interface PaymentRequest {
  amount: number;
  currency: string;
  reference: string;
  description: string;
  customerPhone?: string;
  customerEmail?: string;
  returnUrl?: string;
  cancelUrl?: string;
  notifyUrl?: string;
}

export interface PaymentResponse {
  success: boolean;
  provider: string;
  transactionId?: string;
  paymentUrl?: string;
  ussdCode?: string;
  status?: string;
  error?: string;
}

export interface WebhookPayload {
  provider: string;
  transactionId: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'CANCELLED';
  amount: number;
  currency: string;
  reference: string;
  timestamp: string;
  signature?: string;
  raw?: any;
}

import { ConfigService } from './config.service';

export class PaymentService {
  private configService: ConfigService;

  constructor(
    private db: D1Database,
    private kv: KVNamespace,
    private config: PaymentConfig,
    configService?: ConfigService
  ) {
    this.configService = configService || new ConfigService(db, kv);
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
      // If table doesn't exist or query fails, allow (fail-open for backwards compat)
      return true;
    }
  }

  /**
   * Initialize Orange Money payment
   */
  async initOrangeMoneyPayment(request: PaymentRequest): Promise<PaymentResponse> {
    if (!this.config.orangeMoneyApiKey || !this.config.orangeMoneyMerchantId) {
      return { success: false, provider: 'orange_money', error: 'Orange Money not configured' };
    }

    try {
      // Orange Money API - Burkina Faso
      const [appUrl, apiUrl, omApiUrl, defaultCurrency, paymentIntentTtl] = await Promise.all([
        this.configService.get('app_url', 'https://app.tnc-trading.com'),
        this.configService.get('api_url', 'https://api.tnc-trading.com'),
        this.configService.get('orange_money_api_url', 'https://api.orange.com/orange-money-webpay/bf/v1/webpayment'),
        this.configService.get('default_currency', 'XOF'),
        this.configService.getNumber('payment_intent_ttl', 3600),
      ]);

      const response = await fetch(omApiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.orangeMoneyApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          merchant_key: this.config.orangeMoneyMerchantId,
          currency: defaultCurrency,
          order_id: request.reference,
          amount: request.amount,
          return_url: request.returnUrl || `${appUrl}/payment/callback`,
          cancel_url: request.returnUrl || `${appUrl}/payment/cancel`,
          notif_url: request.notifyUrl || `${apiUrl}/api/v1/webhooks/orange-money`,
          lang: 'fr',
          reference: request.description,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Orange Money error:', error);
        return { success: false, provider: 'orange_money', error };
      }

      const data = await response.json() as { pay_token: string; payment_url: string };

      // Store payment intent in KV for webhook validation
      await this.kv.put(
        `payment:om:${request.reference}`,
        JSON.stringify({
          amount: request.amount,
          transactionId: data.pay_token,
          createdAt: new Date().toISOString(),
        }),
        { expirationTtl: paymentIntentTtl }
      );

      return {
        success: true,
        provider: 'orange_money',
        transactionId: data.pay_token,
        paymentUrl: data.payment_url,
        status: 'PENDING',
      };
    } catch (error) {
      console.error('Orange Money payment error:', error);
      return { success: false, provider: 'orange_money', error: String(error) };
    }
  }

  /**
   * Initialize Moov Money payment
   */
  async initMoovMoneyPayment(request: PaymentRequest): Promise<PaymentResponse> {
    if (!this.config.moovApiKey || !this.config.moovMerchantId) {
      return { success: false, provider: 'moov_money', error: 'Moov Money not configured' };
    }

    try {
      // Moov Money API
      const [appUrl, apiUrl, moovApiUrl, defaultCurrency, paymentIntentTtl] = await Promise.all([
        this.configService.get('app_url', 'https://app.tnc-trading.com'),
        this.configService.get('api_url', 'https://api.tnc-trading.com'),
        this.configService.get('moov_money_api_url', 'https://api.moov-africa.com/bfa/payment/initiate'),
        this.configService.get('default_currency', 'XOF'),
        this.configService.getNumber('payment_intent_ttl', 3600),
      ]);

      const response = await fetch(moovApiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.moovApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          merchant_id: this.config.moovMerchantId,
          amount: request.amount,
          currency: defaultCurrency,
          reference: request.reference,
          description: request.description,
          phone: request.customerPhone,
          callback_url: request.notifyUrl || `${apiUrl}/api/v1/webhooks/moov-money`,
          return_url: request.returnUrl || `${appUrl}/payment/callback`,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Moov Money error:', error);
        return { success: false, provider: 'moov_money', error };
      }

      const data = await response.json() as { transaction_id: string; payment_url: string };

      // Store payment intent
      await this.kv.put(
        `payment:moov:${request.reference}`,
        JSON.stringify({
          amount: request.amount,
          transactionId: data.transaction_id,
          createdAt: new Date().toISOString(),
        }),
        { expirationTtl: paymentIntentTtl }
      );

      return {
        success: true,
        provider: 'moov_money',
        transactionId: data.transaction_id,
        paymentUrl: data.payment_url,
        status: 'PENDING',
      };
    } catch (error) {
      console.error('Moov Money payment error:', error);
      return { success: false, provider: 'moov_money', error: String(error) };
    }
  }

  /**
   * Initialize CinetPay card payment
   */
  async initCinetPayPayment(request: PaymentRequest): Promise<PaymentResponse> {
    if (!this.config.cinetpayApiKey || !this.config.cinetpaySiteId) {
      return { success: false, provider: 'cinetpay', error: 'CinetPay not configured' };
    }

    try {
      const [appUrl, apiUrl, cinetpayApiUrl, defaultCurrency, defaultCountry, defaultCity, paymentIntentTtl] = await Promise.all([
        this.configService.get('app_url', 'https://app.tnc-trading.com'),
        this.configService.get('api_url', 'https://api.tnc-trading.com'),
        this.configService.get('cinetpay_api_url', 'https://api-checkout.cinetpay.com/v2/payment'),
        this.configService.get('default_currency', 'XOF'),
        this.configService.get('default_country', 'BF'),
        this.configService.get('default_city', 'Ouagadougou'),
        this.configService.getNumber('payment_intent_ttl', 3600),
      ]);

      const response = await fetch(cinetpayApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          apikey: this.config.cinetpayApiKey,
          site_id: this.config.cinetpaySiteId,
          transaction_id: request.reference,
          amount: request.amount,
          currency: defaultCurrency,
          description: request.description,
          return_url: request.returnUrl || `${appUrl}/payment/callback`,
          notify_url: request.notifyUrl || `${apiUrl}/api/v1/webhooks/cinetpay`,
          channels: 'ALL',
          customer_email: request.customerEmail,
          customer_phone_number: request.customerPhone,
          customer_name: 'TNC User',
          customer_surname: '',
          customer_country: defaultCountry,
          customer_city: defaultCity,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('CinetPay error:', error);
        return { success: false, provider: 'cinetpay', error };
      }

      const data = await response.json() as { code: string; message: string; data: { payment_token: string; payment_url: string } };

      if (data.code !== '201') {
        return { success: false, provider: 'cinetpay', error: data.message };
      }

      // Store payment intent
      await this.kv.put(
        `payment:cinetpay:${request.reference}`,
        JSON.stringify({
          amount: request.amount,
          transactionId: data.data.payment_token,
          createdAt: new Date().toISOString(),
        }),
        { expirationTtl: paymentIntentTtl }
      );

      return {
        success: true,
        provider: 'cinetpay',
        transactionId: data.data.payment_token,
        paymentUrl: data.data.payment_url,
        status: 'PENDING',
      };
    } catch (error) {
      console.error('CinetPay payment error:', error);
      return { success: false, provider: 'cinetpay', error: String(error) };
    }
  }

  /**
   * Initialize Stripe Checkout payment (international cards)
   * Uses Stripe REST API directly (no SDK — Workers compatible)
   */
  async initStripePayment(request: PaymentRequest): Promise<PaymentResponse> {
    if (!this.config.stripeSecretKey) {
      return { success: false, provider: 'stripe', error: 'Stripe not configured' };
    }

    try {
      // XOF is a zero-decimal currency — amount is in whole units, no *100
      const [appUrl, appName, stripeApiUrl, defaultCurrency, paymentIntentTtl] = await Promise.all([
        this.configService.get('app_url', 'https://app.tnc-trading.com'),
        this.configService.get('app_name', 'TNC Trading'),
        this.configService.get('stripe_api_url', 'https://api.stripe.com/v1/checkout/sessions'),
        this.configService.get('default_currency', 'XOF'),
        this.configService.getNumber('payment_intent_ttl', 3600),
      ]);

      const params = new URLSearchParams();
      params.append('mode', 'payment');
      params.append('line_items[0][price_data][currency]', defaultCurrency.toLowerCase());
      params.append('line_items[0][price_data][product_data][name]', request.description || `Dépôt ${appName}`);
      params.append('line_items[0][price_data][unit_amount]', String(request.amount));
      params.append('line_items[0][quantity]', '1');
      params.append('success_url', request.returnUrl || `${appUrl}/payment/callback?session_id={CHECKOUT_SESSION_ID}`);
      params.append('cancel_url', request.cancelUrl || `${appUrl}/payment/cancel`);
      params.append('client_reference_id', request.reference);
      if (request.customerEmail) {
        params.append('customer_email', request.customerEmail);
      }
      params.append('metadata[reference]', request.reference);
      params.append('metadata[platform]', 'tnc-trading');

      const response = await fetch(stripeApiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.stripeSecretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Stripe error:', error);
        return { success: false, provider: 'stripe', error };
      }

      const session = await response.json() as { id: string; url: string };

      // Store payment intent in KV for webhook validation
      await this.kv.put(
        `payment:stripe:${request.reference}`,
        JSON.stringify({
          amount: request.amount,
          sessionId: session.id,
          createdAt: new Date().toISOString(),
        }),
        { expirationTtl: paymentIntentTtl }
      );

      return {
        success: true,
        provider: 'stripe',
        transactionId: session.id,
        paymentUrl: session.url,
        status: 'PENDING',
      };
    } catch (error) {
      console.error('Stripe payment error:', error);
      return { success: false, provider: 'stripe', error: String(error) };
    }
  }

  /**
   * Initialize payment based on method
   */
  async initiatePayment(
    method: 'orange_money' | 'moov_money' | 'card' | 'bank' | 'stripe',
    request: PaymentRequest
  ): Promise<PaymentResponse> {
    // Map method to provider name in integrations table
    const providerMap: Record<string, string> = {
      orange_money: 'orange_money',
      moov_money: 'moov_money',
      card: 'cinetpay',
      stripe: 'stripe',
    };

    const providerName = providerMap[method];
    if (providerName) {
      const enabled = await this.isProviderEnabled(providerName);
      if (!enabled) {
        return { success: false, provider: providerName, error: `${providerName} is currently disabled` };
      }
    }

    switch (method) {
      case 'orange_money':
        return this.initOrangeMoneyPayment(request);
      case 'moov_money':
        return this.initMoovMoneyPayment(request);
      case 'card':
        return this.initCinetPayPayment(request);
      case 'stripe':
        return this.initStripePayment(request);
      case 'bank':
        // Bank transfers are handled manually
        return {
          success: true,
          provider: 'bank',
          transactionId: request.reference,
          status: 'PENDING',
        };
      default:
        return { success: false, provider: method, error: 'Unsupported payment method' };
    }
  }

  /**
   * Verify webhook signature
   */
  async verifyWebhookSignature(
    provider: string,
    payload: string,
    signature: string
  ): Promise<boolean> {
    if (!this.config.webhookSecret) {
      console.warn('Webhook secret not configured — rejecting webhook');
      return false;
    }

    switch (provider) {
      case 'orange_money':
        return this.verifyHmacSignature(payload, signature, this.config.webhookSecret);

      case 'moov_money':
        return this.constantTimeEqual(signature, this.config.moovApiKey || '');

      case 'cinetpay':
        return this.verifyCinetPaySignature(payload, signature);

      case 'stripe':
        return this.verifyStripeSignature(payload, signature);

      default:
        return false;
    }
  }

  /**
   * Stripe webhook signature verification.
   * Stripe-Signature header format: t=timestamp,v1=signature
   */
  private async verifyStripeSignature(payload: string, signatureHeader: string): Promise<boolean> {
    if (!this.config.stripeWebhookSecret) return false;

    try {
      const elements = signatureHeader.split(',');
      const timestamp = elements.find(e => e.startsWith('t='))?.slice(2);
      const signature = elements.find(e => e.startsWith('v1='))?.slice(3);

      if (!timestamp || !signature) return false;

      // Stripe signs: timestamp + '.' + payload
      const signedPayload = `${timestamp}.${payload}`;
      return this.verifyHmacSignature(signedPayload, signature, this.config.stripeWebhookSecret);
    } catch {
      return false;
    }
  }

  /**
   * Constant-time string comparison to prevent timing attacks.
   */
  private constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    const encoder = new TextEncoder();
    const bufA = encoder.encode(a);
    const bufB = encoder.encode(b);
    let result = 0;
    for (let i = 0; i < bufA.length; i++) {
      result |= bufA[i] ^ bufB[i];
    }
    return result === 0;
  }

  /**
   * HMAC-SHA256 signature verification using Web Crypto API.
   */
  private async verifyHmacSignature(
    payload: string,
    signature: string,
    secret: string
  ): Promise<boolean> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const computed = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return this.constantTimeEqual(computed, signature.toLowerCase());
  }

  /**
   * CinetPay signature verification (HMAC-SHA256 with site_id + apikey).
   */
  private async verifyCinetPaySignature(payload: string, signature: string): Promise<boolean> {
    const secret = `${this.config.cinetpaySiteId}${this.config.cinetpayApiKey}`;
    if (!secret) return false;
    return this.verifyHmacSignature(payload, signature, secret);
  }

  /**
   * Process webhook payload
   */
  async processWebhook(webhook: WebhookPayload): Promise<{
    success: boolean;
    transactionId?: string;
    error?: string;
  }> {
    try {
      // Find the transaction by reference
      const transaction = await this.db
        .prepare('SELECT * FROM transactions WHERE id = ? OR payment_reference = ?')
        .bind(webhook.reference, webhook.reference)
        .first<any>();

      if (!transaction) {
        console.error('Transaction not found for webhook:', webhook.reference);
        return { success: false, error: 'Transaction not found' };
      }

      // Verify amount matches
      const storedPayment = await this.kv.get(`payment:${webhook.provider}:${webhook.reference}`, 'json');
      if (storedPayment) {
        const stored = storedPayment as { amount: number };
        if (stored.amount !== webhook.amount) {
          console.error('Amount mismatch in webhook');
          return { success: false, error: 'Amount mismatch' };
        }
      }

      // Update transaction status based on webhook status
      let newStatus: string;
      switch (webhook.status) {
        case 'SUCCESS':
          newStatus = 'COMPLETED';
          break;
        case 'FAILED':
          newStatus = 'FAILED';
          break;
        case 'CANCELLED':
          newStatus = 'CANCELLED';
          break;
        default:
          newStatus = 'PROCESSING';
      }

      // Update transaction
      await this.db
        .prepare(`
          UPDATE transactions
          SET status = ?,
              payment_reference = ?,
              completed_at = CASE WHEN ? = 'COMPLETED' THEN datetime('now') ELSE completed_at END,
              failure_reason = CASE WHEN ? = 'FAILED' THEN 'Payment failed' ELSE failure_reason END
          WHERE id = ?
        `)
        .bind(newStatus, webhook.transactionId, newStatus, newStatus, transaction.id)
        .run();

      // If payment successful, update wallet balance
      if (newStatus === 'COMPLETED' && transaction.type === 'DEPOSIT') {
        await this.db
          .prepare(`
            UPDATE wallets
            SET cash_balance = cash_balance + ?,
                updated_at = datetime('now')
            WHERE user_id = ?
          `)
          .bind(webhook.amount, transaction.user_id)
          .run();
      }

      // Log webhook processing
      await this.logWebhook(webhook, newStatus);

      // Clean up KV
      await this.kv.delete(`payment:${webhook.provider}:${webhook.reference}`);

      return { success: true, transactionId: transaction.id };
    } catch (error) {
      console.error('Webhook processing error:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Log webhook for audit
   */
  private async logWebhook(webhook: WebhookPayload, processedStatus: string): Promise<void> {
    try {
      await this.db
        .prepare(`
          INSERT INTO audit_logs (id, action, entity_type, entity_id, new_value, created_at)
          VALUES (?, 'PAYMENT_WEBHOOK', 'transaction', ?, ?, datetime('now'))
        `)
        .bind(
          crypto.randomUUID(),
          webhook.reference,
          JSON.stringify({
            provider: webhook.provider,
            status: webhook.status,
            processedStatus,
            amount: webhook.amount,
          })
        )
        .run();
    } catch (error) {
      console.error('Failed to log webhook:', error);
    }
  }

  /**
   * Check payment status from provider
   */
  async checkPaymentStatus(
    provider: string,
    transactionId: string
  ): Promise<{ status: string; details?: any }> {
    switch (provider) {
      case 'orange_money':
        return this.checkOrangeMoneyStatus(transactionId);
      case 'moov_money':
        return this.checkMoovMoneyStatus(transactionId);
      case 'cinetpay':
        return this.checkCinetPayStatus(transactionId);
      case 'stripe':
        return this.checkStripeStatus(transactionId);
      default:
        return { status: 'UNKNOWN' };
    }
  }

  private async checkOrangeMoneyStatus(transactionId: string): Promise<{ status: string; details?: any }> {
    if (!this.config.orangeMoneyApiKey) {
      return { status: 'ERROR', details: { error: 'Orange Money not configured' } };
    }

    try {
      const omBaseUrl = await this.configService.get('orange_money_api_url', 'https://api.orange.com/orange-money-webpay/bf/v1/webpayment');
      const omStatusUrl = omBaseUrl.replace('/webpayment', `/transactionstatus/${transactionId}`);
      const response = await fetch(omStatusUrl, {
        headers: {
          'Authorization': `Bearer ${this.config.orangeMoneyApiKey}`,
        },
      });

      if (!response.ok) {
        return { status: 'ERROR', details: { error: await response.text() } };
      }

      const data = await response.json() as Record<string, unknown>;
      return { status: data.status as string, details: data };
    } catch (error) {
      return { status: 'ERROR', details: { error: String(error) } };
    }
  }

  private async checkMoovMoneyStatus(transactionId: string): Promise<{ status: string; details?: any }> {
    if (!this.config.moovApiKey) {
      return { status: 'ERROR', details: { error: 'Moov Money not configured' } };
    }

    try {
      const moovBaseUrl = await this.configService.get('moov_money_api_url', 'https://api.moov-africa.com/bfa/payment/initiate');
      const moovStatusUrl = moovBaseUrl.replace('/initiate', `/status/${transactionId}`);
      const response = await fetch(moovStatusUrl, {
        headers: {
          'Authorization': `Bearer ${this.config.moovApiKey}`,
        },
      });

      if (!response.ok) {
        return { status: 'ERROR', details: { error: await response.text() } };
      }

      const data = await response.json() as Record<string, unknown>;
      return { status: data.status as string, details: data };
    } catch (error) {
      return { status: 'ERROR', details: { error: String(error) } };
    }
  }

  private async checkCinetPayStatus(transactionId: string): Promise<{ status: string; details?: any }> {
    if (!this.config.cinetpayApiKey || !this.config.cinetpaySiteId) {
      return { status: 'ERROR', details: { error: 'CinetPay not configured' } };
    }

    try {
      const response = await fetch('https://api-checkout.cinetpay.com/v2/payment/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          apikey: this.config.cinetpayApiKey,
          site_id: this.config.cinetpaySiteId,
          transaction_id: transactionId,
        }),
      });

      if (!response.ok) {
        return { status: 'ERROR', details: { error: await response.text() } };
      }

      const data = await response.json() as { data?: { status?: string } };
      return { status: data.data?.status || 'UNKNOWN', details: data };
    } catch (error) {
      return { status: 'ERROR', details: { error: String(error) } };
    }
  }

  /**
   * Initiate withdrawal payout
   */
  async initiateWithdrawalPayout(
    method: 'orange_money' | 'moov_money' | 'bank',
    amount: number,
    recipient: string,
    reference: string
  ): Promise<PaymentResponse> {
    switch (method) {
      case 'orange_money':
        return this.payoutOrangeMoney(amount, recipient, reference);
      case 'moov_money':
        return this.payoutMoovMoney(amount, recipient, reference);
      case 'bank':
        // Bank transfers are manual
        return { success: true, provider: 'bank', transactionId: reference, status: 'PENDING' };
      default:
        return { success: false, provider: method, error: 'Unsupported payout method' };
    }
  }

  private async payoutOrangeMoney(
    amount: number,
    phoneNumber: string,
    reference: string
  ): Promise<PaymentResponse> {
    if (!this.config.orangeMoneyApiKey) {
      return { success: false, provider: 'orange_money', error: 'Not configured' };
    }

    try {
      const omBaseUrl = await this.configService.get('orange_money_api_url', 'https://api.orange.com/orange-money-webpay/bf/v1/webpayment');
      const omCashinUrl = omBaseUrl.replace('/webpayment', '/cashin');
      const response = await fetch(omCashinUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.orangeMoneyApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          merchant_key: this.config.orangeMoneyMerchantId,
          subscriber_msisdn: phoneNumber,
          amount: amount,
          currency: 'XOF',
          order_id: reference,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, provider: 'orange_money', error };
      }

      const data = await response.json() as { transaction_id: string };
      return {
        success: true,
        provider: 'orange_money',
        transactionId: data.transaction_id,
        status: 'PROCESSING',
      };
    } catch (error) {
      return { success: false, provider: 'orange_money', error: String(error) };
    }
  }

  private async checkStripeStatus(sessionId: string): Promise<{ status: string; details?: any }> {
    if (!this.config.stripeSecretKey) {
      return { status: 'ERROR', details: { error: 'Stripe not configured' } };
    }

    try {
      const stripeBaseUrl = await this.configService.get('stripe_api_url', 'https://api.stripe.com/v1/checkout/sessions');
      const response = await fetch(
        `${stripeBaseUrl}/${sessionId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.stripeSecretKey}`,
          },
        }
      );

      if (!response.ok) {
        return { status: 'ERROR', details: { error: await response.text() } };
      }

      const session = await response.json() as { payment_status: string; status: string };
      // Map Stripe session status to our status
      let status = 'PENDING';
      if (session.payment_status === 'paid') status = 'SUCCESS';
      else if (session.status === 'expired') status = 'CANCELLED';

      return { status, details: session };
    } catch (error) {
      return { status: 'ERROR', details: { error: String(error) } };
    }
  }

  private async payoutMoovMoney(
    amount: number,
    phoneNumber: string,
    reference: string
  ): Promise<PaymentResponse> {
    if (!this.config.moovApiKey) {
      return { success: false, provider: 'moov_money', error: 'Not configured' };
    }

    try {
      const moovBaseUrl = await this.configService.get('moov_money_api_url', 'https://api.moov-africa.com/bfa/payment/initiate');
      const moovPayoutUrl = moovBaseUrl.replace('/payment/initiate', '/payout/initiate');
      const response = await fetch(moovPayoutUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.moovApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          merchant_id: this.config.moovMerchantId,
          phone: phoneNumber,
          amount: amount,
          currency: 'XOF',
          reference: reference,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, provider: 'moov_money', error };
      }

      const data = await response.json() as { transaction_id: string };
      return {
        success: true,
        provider: 'moov_money',
        transactionId: data.transaction_id,
        status: 'PROCESSING',
      };
    } catch (error) {
      return { success: false, provider: 'moov_money', error: String(error) };
    }
  }
}
