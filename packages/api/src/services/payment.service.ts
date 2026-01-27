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

export class PaymentService {
  constructor(
    private db: D1Database,
    private kv: KVNamespace,
    private config: PaymentConfig
  ) {}

  /**
   * Initialize Orange Money payment
   */
  async initOrangeMoneyPayment(request: PaymentRequest): Promise<PaymentResponse> {
    if (!this.config.orangeMoneyApiKey || !this.config.orangeMoneyMerchantId) {
      return { success: false, provider: 'orange_money', error: 'Orange Money not configured' };
    }

    try {
      // Orange Money API - Burkina Faso
      const response = await fetch('https://api.orange.com/orange-money-webpay/bf/v1/webpayment', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.orangeMoneyApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          merchant_key: this.config.orangeMoneyMerchantId,
          currency: 'XOF',
          order_id: request.reference,
          amount: request.amount,
          return_url: request.returnUrl || 'https://app.tnc-trading.com/payment/callback',
          cancel_url: request.returnUrl || 'https://app.tnc-trading.com/payment/cancel',
          notif_url: request.notifyUrl || 'https://api.tnc-trading.com/api/v1/webhooks/orange-money',
          lang: 'fr',
          reference: request.description,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Orange Money error:', error);
        return { success: false, provider: 'orange_money', error };
      }

      const data = await response.json();

      // Store payment intent in KV for webhook validation
      await this.kv.put(
        `payment:om:${request.reference}`,
        JSON.stringify({
          amount: request.amount,
          transactionId: data.pay_token,
          createdAt: new Date().toISOString(),
        }),
        { expirationTtl: 3600 } // 1 hour
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
      const response = await fetch('https://api.moov-africa.com/bfa/payment/initiate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.moovApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          merchant_id: this.config.moovMerchantId,
          amount: request.amount,
          currency: 'XOF',
          reference: request.reference,
          description: request.description,
          phone: request.customerPhone,
          callback_url: request.notifyUrl || 'https://api.tnc-trading.com/api/v1/webhooks/moov-money',
          return_url: request.returnUrl || 'https://app.tnc-trading.com/payment/callback',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Moov Money error:', error);
        return { success: false, provider: 'moov_money', error };
      }

      const data = await response.json();

      // Store payment intent
      await this.kv.put(
        `payment:moov:${request.reference}`,
        JSON.stringify({
          amount: request.amount,
          transactionId: data.transaction_id,
          createdAt: new Date().toISOString(),
        }),
        { expirationTtl: 3600 }
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
      const response = await fetch('https://api-checkout.cinetpay.com/v2/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          apikey: this.config.cinetpayApiKey,
          site_id: this.config.cinetpaySiteId,
          transaction_id: request.reference,
          amount: request.amount,
          currency: 'XOF',
          description: request.description,
          return_url: request.returnUrl || 'https://app.tnc-trading.com/payment/callback',
          notify_url: request.notifyUrl || 'https://api.tnc-trading.com/api/v1/webhooks/cinetpay',
          channels: 'ALL',
          customer_email: request.customerEmail,
          customer_phone_number: request.customerPhone,
          customer_name: 'TNC User',
          customer_surname: '',
          customer_country: 'BF',
          customer_city: 'Ouagadougou',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('CinetPay error:', error);
        return { success: false, provider: 'cinetpay', error };
      }

      const data = await response.json();

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
        { expirationTtl: 3600 }
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
   * Initialize payment based on method
   */
  async initiatePayment(
    method: 'orange_money' | 'moov_money' | 'card' | 'bank',
    request: PaymentRequest
  ): Promise<PaymentResponse> {
    switch (method) {
      case 'orange_money':
        return this.initOrangeMoneyPayment(request);
      case 'moov_money':
        return this.initMoovMoneyPayment(request);
      case 'card':
        return this.initCinetPayPayment(request);
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

      default:
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
      default:
        return { status: 'UNKNOWN' };
    }
  }

  private async checkOrangeMoneyStatus(transactionId: string): Promise<{ status: string; details?: any }> {
    if (!this.config.orangeMoneyApiKey) {
      return { status: 'ERROR', details: { error: 'Orange Money not configured' } };
    }

    try {
      const response = await fetch(
        `https://api.orange.com/orange-money-webpay/bf/v1/transactionstatus/${transactionId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.orangeMoneyApiKey}`,
          },
        }
      );

      if (!response.ok) {
        return { status: 'ERROR', details: { error: await response.text() } };
      }

      const data = await response.json();
      return { status: data.status, details: data };
    } catch (error) {
      return { status: 'ERROR', details: { error: String(error) } };
    }
  }

  private async checkMoovMoneyStatus(transactionId: string): Promise<{ status: string; details?: any }> {
    if (!this.config.moovApiKey) {
      return { status: 'ERROR', details: { error: 'Moov Money not configured' } };
    }

    try {
      const response = await fetch(
        `https://api.moov-africa.com/bfa/payment/status/${transactionId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.moovApiKey}`,
          },
        }
      );

      if (!response.ok) {
        return { status: 'ERROR', details: { error: await response.text() } };
      }

      const data = await response.json();
      return { status: data.status, details: data };
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

      const data = await response.json();
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
      const response = await fetch('https://api.orange.com/orange-money-webpay/bf/v1/cashin', {
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

      const data = await response.json();
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

  private async payoutMoovMoney(
    amount: number,
    phoneNumber: string,
    reference: string
  ): Promise<PaymentResponse> {
    if (!this.config.moovApiKey) {
      return { success: false, provider: 'moov_money', error: 'Not configured' };
    }

    try {
      const response = await fetch('https://api.moov-africa.com/bfa/payout/initiate', {
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

      const data = await response.json();
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
