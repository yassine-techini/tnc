/**
 * Webhook Routes
 * Handle payment provider callbacks
 */

import { Hono } from 'hono';
import type { Env, AppEnv } from '../types/env';
import { PaymentService, WebhookPayload } from '../services/payment.service';
import { NotificationService } from '../services/notification.service';
import { KycService } from '../services/kyc.service';
import { ConfigService } from '../services/config.service';

const webhooks = new Hono<AppEnv>();

/**
 * SECURITY: Sanitize and validate amount from webhook payload
 * Rejects NaN, Infinity, negative values, and excessive amounts
 */
/**
 * Constant-time string comparison to avoid leaking the webhook secret via timing.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function sanitizeAmount(value: unknown, maxAmount = 100_000_000): number {
  const num = parseFloat(String(value ?? 0));

  // Reject invalid numbers
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`Invalid webhook amount: ${value}`);
  }

  // Reject amounts exceeding reasonable limits
  if (num > maxAmount) {
    throw new Error(`Webhook amount exceeds maximum: ${num} > ${maxAmount}`);
  }

  return num;
}

/**
 * Get payment and notification services
 */
function getServices(env: Env) {
  const paymentService = new PaymentService(env.DB, env.CACHE, {
    orangeMoneyApiKey: env.ORANGE_MONEY_API_KEY,
    orangeMoneyMerchantId: env.ORANGE_MONEY_MERCHANT_ID,
    moovApiKey: env.MOOV_API_KEY,
    moovMerchantId: env.MOOV_MERCHANT_ID,
    cinetpayApiKey: env.CINETPAY_API_KEY,
    cinetpaySiteId: env.CINETPAY_SITE_ID,
    webhookSecret: env.WEBHOOK_SECRET,
    stripeSecretKey: env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
  });

  const notificationService = new NotificationService(env.DB, {
    resendApiKey: env.RESEND_API_KEY,
    twilioAccountSid: env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: env.TWILIO_AUTH_TOKEN,
    twilioPhoneNumber: env.TWILIO_PHONE_NUMBER,
  });

  return { paymentService, notificationService };
}

/**
 * Orange Money Webhook
 * POST /webhooks/payment/orange
 */
webhooks.post('/payment/orange', async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const rawBody = await c.req.text();
    const signature = c.req.header('X-OM-Signature') || '';

    const { paymentService, notificationService } = getServices(c.env);

    // Verify signature
    if (!(await paymentService.verifyWebhookSignature('orange_money', rawBody, signature))) {
      console.error('Invalid Orange Money webhook signature');
      return c.json({ success: false, error: 'Invalid signature' }, 401);
    }

    const body = JSON.parse(rawBody);

    // Map Orange Money status to our status
    let status: WebhookPayload['status'] = 'PENDING';
    if (body.status === 'SUCCESS' || body.status === 'SUCCESSFUL') {
      status = 'SUCCESS';
    } else if (body.status === 'FAILED' || body.status === 'FAILURE') {
      status = 'FAILED';
    } else if (body.status === 'CANCELLED') {
      status = 'CANCELLED';
    }

    const webhook: WebhookPayload = {
      provider: 'orange_money',
      transactionId: body.txnid || body.pay_token,
      status,
      amount: sanitizeAmount(body.amount),
      currency: body.currency || 'XOF',
      reference: body.order_id,
      timestamp: new Date().toISOString(),
      signature,
      raw: body,
    };

    const result = await paymentService.processWebhook(webhook);

    if (result.success && status === 'SUCCESS') {
      // Get user info for notification
      const transaction = await c.env.DB
        .prepare('SELECT t.*, u.email, u.phone FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.id = ?')
        .bind(result.transactionId)
        .first<any>();

      if (transaction) {
        // Send notification
        await notificationService.sendTransactionCompleted(
          transaction.email,
          'DEPOSIT',
          webhook.amount,
          0
        );
      }
    }

    return c.json({ success: result.success, requestId });
  } catch (error) {
    console.error('Orange Money webhook error:', error);
    return c.json({ success: false, error: 'Processing error', requestId }, 500);
  }
});

/**
 * Moov Money Webhook
 * POST /webhooks/payment/moov
 */
webhooks.post('/payment/moov', async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const rawBody = await c.req.text();
    const signature = c.req.header('X-Moov-Signature') || '';

    const { paymentService, notificationService } = getServices(c.env);

    // Verify signature
    if (!(await paymentService.verifyWebhookSignature('moov_money', rawBody, signature))) {
      console.error('Invalid Moov Money webhook signature');
      return c.json({ success: false, error: 'Invalid signature' }, 401);
    }

    const body = JSON.parse(rawBody);

    // Map Moov status
    let status: WebhookPayload['status'] = 'PENDING';
    if (body.status === 'SUCCESSFUL' || body.status === 'SUCCESS') {
      status = 'SUCCESS';
    } else if (body.status === 'FAILED') {
      status = 'FAILED';
    } else if (body.status === 'CANCELLED') {
      status = 'CANCELLED';
    }

    const webhook: WebhookPayload = {
      provider: 'moov_money',
      transactionId: body.transaction_id,
      status,
      amount: sanitizeAmount(body.amount),
      currency: body.currency || 'XOF',
      reference: body.reference,
      timestamp: new Date().toISOString(),
      signature,
      raw: body,
    };

    const result = await paymentService.processWebhook(webhook);

    if (result.success && status === 'SUCCESS') {
      const transaction = await c.env.DB
        .prepare('SELECT t.*, u.email, u.phone FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.id = ?')
        .bind(result.transactionId)
        .first<any>();

      if (transaction) {
        await notificationService.sendTransactionCompleted(
          transaction.email,
          'DEPOSIT',
          webhook.amount,
          0
        );
      }
    }

    return c.json({ success: result.success, requestId });
  } catch (error) {
    console.error('Moov Money webhook error:', error);
    return c.json({ success: false, error: 'Processing error', requestId }, 500);
  }
});

/**
 * CinetPay Webhook
 * POST /webhooks/payment/cinetpay
 */
webhooks.post('/payment/cinetpay', async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const rawBody = await c.req.text();
    const signature = c.req.header('X-CinetPay-Signature') || c.req.header('X-Token') || '';

    const { paymentService, notificationService } = getServices(c.env);

    // Verify CinetPay signature
    if (!(await paymentService.verifyWebhookSignature('cinetpay', rawBody, signature))) {
      console.error('Invalid CinetPay webhook signature');
      return c.json({ success: false, error: 'Invalid signature' }, 401);
    }

    const body = JSON.parse(rawBody);

    // CinetPay sends status in different format
    let status: WebhookPayload['status'] = 'PENDING';
    const cinetStatus = body.cpm_result || body.status;
    if (cinetStatus === '00' || cinetStatus === 'ACCEPTED') {
      status = 'SUCCESS';
    } else if (cinetStatus === 'REFUSED' || cinetStatus === 'ERROR') {
      status = 'FAILED';
    } else if (cinetStatus === 'CANCELLED') {
      status = 'CANCELLED';
    }

    const webhook: WebhookPayload = {
      provider: 'cinetpay',
      transactionId: body.cpm_trans_id || body.transaction_id,
      status,
      amount: sanitizeAmount(body.cpm_amount || body.amount),
      currency: body.cpm_currency || 'XOF',
      reference: body.cpm_custom || body.transaction_id,
      timestamp: new Date().toISOString(),
      raw: body,
    };

    const result = await paymentService.processWebhook(webhook);

    if (result.success && status === 'SUCCESS') {
      const transaction = await c.env.DB
        .prepare('SELECT t.*, u.email, u.phone FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.id = ?')
        .bind(result.transactionId)
        .first<any>();

      if (transaction) {
        await notificationService.sendTransactionCompleted(
          transaction.email,
          'DEPOSIT',
          webhook.amount,
          0
        );
      }
    }

    return c.json({ success: result.success, requestId });
  } catch (error) {
    console.error('CinetPay webhook error:', error);
    return c.json({ success: false, error: 'Processing error', requestId }, 500);
  }
});

/**
 * Stripe Webhook
 * POST /webhooks/payment/stripe
 */
webhooks.post('/payment/stripe', async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const rawBody = await c.req.text();
    const signatureHeader = c.req.header('Stripe-Signature') || '';

    const { paymentService, notificationService } = getServices(c.env);

    // Verify Stripe signature
    if (!(await paymentService.verifyWebhookSignature('stripe', rawBody, signatureHeader))) {
      console.error('Invalid Stripe webhook signature');
      return c.json({ success: false, error: 'Invalid signature' }, 401);
    }

    const event = JSON.parse(rawBody) as {
      type: string;
      data: {
        object: {
          id: string;
          client_reference_id?: string;
          amount_total?: number;
          currency?: string;
          payment_status?: string;
          metadata?: Record<string, string>;
        };
      };
    };

    // Only process checkout.session.completed and checkout.session.expired
    let status: WebhookPayload['status'] = 'PENDING';
    if (event.type === 'checkout.session.completed') {
      status = event.data.object.payment_status === 'paid' ? 'SUCCESS' : 'PENDING';
    } else if (event.type === 'checkout.session.expired') {
      status = 'CANCELLED';
    } else {
      // Acknowledge other events without processing
      return c.json({ success: true, requestId });
    }

    const session = event.data.object;
    const reference = session.client_reference_id || session.metadata?.reference || session.id;

    const webhook: WebhookPayload = {
      provider: 'stripe',
      transactionId: session.id,
      status,
      amount: session.amount_total || 0,
      currency: (session.currency || 'xof').toUpperCase(),
      reference,
      timestamp: new Date().toISOString(),
      signature: signatureHeader,
      raw: event,
    };

    const result = await paymentService.processWebhook(webhook);

    if (result.success && status === 'SUCCESS') {
      const transaction = await c.env.DB
        .prepare('SELECT t.*, u.email, u.phone FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.id = ?')
        .bind(result.transactionId)
        .first<any>();

      if (transaction) {
        await notificationService.sendTransactionCompleted(
          transaction.email,
          'DEPOSIT',
          webhook.amount,
          0
        );
      }
    }

    return c.json({ success: result.success, requestId });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    return c.json({ success: false, error: 'Processing error', requestId }, 500);
  }
});

/**
 * Bank Transfer Webhook
 * POST /webhooks/payment/bank
 *
 * This handles bank transfer confirmations, which can come from:
 * - Bank partner APIs (automated)
 * - Manual admin verification
 * - SWIFT/BCEAO notifications
 */
webhooks.post('/payment/bank', async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const rawBody = await c.req.text();
    const signature = c.req.header('X-Bank-Signature') || c.req.header('Authorization');

    const { paymentService, notificationService } = getServices(c.env);

    // Authenticate the shared secret with a constant-time comparison.
    // A merely-present signature header is NOT accepted (it was previously
    // trusted without any cryptographic verification, allowing forged
    // confirmations). Outside development the secret is mandatory.
    const apiKey = c.req.header('X-API-Key') || '';
    const secretOk = !!c.env.WEBHOOK_SECRET && timingSafeEqual(apiKey, c.env.WEBHOOK_SECRET);
    if (c.env.ENVIRONMENT !== 'development' && !secretOk) {
      console.error('Unauthorized bank webhook attempt');
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const body = JSON.parse(rawBody);

    // Support multiple bank transfer formats
    // Standard format: { reference, amount, status, bankReference, accountNumber }
    // BCEAO format: { ref_operation, montant, statut, numero_compte }
    // SWIFT format: { transaction_ref, amount, status_code, iban }

    const reference = body.reference || body.ref_operation || body.transaction_ref || body.order_id;
    const amount = sanitizeAmount(body.amount || body.montant);
    const bankReference = body.bankReference || body.bank_ref || body.numero_operation;

    // Map bank status to our status
    let status: WebhookPayload['status'] = 'PENDING';
    const bankStatus = (body.status || body.statut || body.status_code || '').toUpperCase();

    if (['SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'ACCEPTED', 'CONFIRMED', 'VALIDE', 'EFFECTUE'].includes(bankStatus)) {
      status = 'SUCCESS';
    } else if (['FAILED', 'REJECTED', 'REFUSED', 'ERROR', 'ECHEC', 'REJETE'].includes(bankStatus)) {
      status = 'FAILED';
    } else if (['CANCELLED', 'CANCELED', 'ANNULE'].includes(bankStatus)) {
      status = 'CANCELLED';
    } else if (['PENDING', 'PROCESSING', 'EN_COURS', 'EN_ATTENTE'].includes(bankStatus)) {
      status = 'PENDING';
    }

    const webhook: WebhookPayload = {
      provider: 'bank',
      transactionId: bankReference || reference,
      status,
      amount,
      currency: body.currency || body.devise || 'XOF',
      reference,
      timestamp: body.timestamp || body.date_operation || new Date().toISOString(),
      signature: signature || '',
      raw: body,
    };

    // Find the transaction by reference
    const existingTransaction = await c.env.DB
      .prepare(`
        SELECT t.*, u.email, u.phone
        FROM transactions t
        JOIN users u ON t.user_id = u.id
        WHERE t.payment_reference = ? OR t.id = ?
      `)
      .bind(reference, reference)
      .first<any>();

    if (!existingTransaction) {
      console.warn('Bank webhook: Transaction not found for reference:', reference);

      // Log the incoming webhook for manual processing
      await c.env.DB
        .prepare(`
          INSERT INTO audit_logs (id, action, entity_type, entity_id, new_value, ip_address, created_at)
          VALUES (?, 'BANK_WEBHOOK_UNMATCHED', 'webhook', ?, ?, ?, datetime('now'))
        `)
        .bind(
          crypto.randomUUID(),
          reference,
          JSON.stringify(body),
          c.req.header('CF-Connecting-IP') || 'unknown'
        )
        .run();

      return c.json({
        success: false,
        error: 'Transaction not found',
        message: 'Webhook logged for manual processing',
        requestId,
      }, 404);
    }

    // Update transaction based on webhook status
    if (status === 'SUCCESS') {
      // Complete the transaction
      await c.env.DB
        .prepare(`
          UPDATE transactions
          SET status = 'COMPLETED',
              external_reference = ?,
              completed_at = datetime('now'),
              updated_at = datetime('now')
          WHERE id = ?
        `)
        .bind(bankReference, existingTransaction.id)
        .run();

      // Credit wallet for deposits. Validate the webhook amount against the
      // amount we expected for this transaction, and credit the DB-derived net
      // amount (never the attacker-controllable webhook value).
      if (existingTransaction.type === 'DEPOSIT') {
        const expected = Number(existingTransaction.cash_amount) || 0;
        if (Math.abs(amount - expected) > 1) {
          await c.env.DB
            .prepare(`
              INSERT INTO audit_logs (id, action, entity_type, entity_id, new_value, ip_address, created_at)
              VALUES (?, 'BANK_WEBHOOK_AMOUNT_MISMATCH', 'transaction', ?, ?, ?, datetime('now'))
            `)
            .bind(
              crypto.randomUUID(),
              existingTransaction.id,
              JSON.stringify({ expected, received: amount }),
              c.req.header('CF-Connecting-IP') || 'unknown'
            )
            .run();
          return c.json({ success: false, error: 'Amount mismatch', requestId }, 400);
        }
        const netAmount = expected - (Number(existingTransaction.fees) || 0);
        await c.env.DB
          .prepare(`
            UPDATE wallets
            SET cash_balance = cash_balance + ?, updated_at = datetime('now')
            WHERE user_id = ?
          `)
          .bind(netAmount, existingTransaction.user_id)
          .run();
      }

      // Send success notification
      await notificationService.sendTransactionCompleted(
        existingTransaction.email,
        existingTransaction.type,
        amount,
        existingTransaction.token_amount || 0
      );

    } else if (status === 'FAILED') {
      await c.env.DB
        .prepare(`
          UPDATE transactions
          SET status = 'FAILED',
              failure_reason = ?,
              external_reference = ?,
              completed_at = datetime('now'),
              updated_at = datetime('now')
          WHERE id = ?
        `)
        .bind(body.failure_reason || body.motif_rejet || 'Virement rejeté', bankReference, existingTransaction.id)
        .run();

      // Notify user of failure
      notificationService.sendEmail({
        to: existingTransaction.email,
        subject: `${existingTransaction.type === 'DEPOSIT' ? 'Dépôt' : 'Retrait'} échoué - TNC Trading`,
        html: `
          <p>Votre ${existingTransaction.type === 'DEPOSIT' ? 'dépôt' : 'retrait'} de ${amount.toLocaleString('fr-FR')} XOF a échoué.</p>
          <p><strong>Raison:</strong> ${body.failure_reason || body.motif_rejet || 'Virement bancaire rejeté'}</p>
          <p>Veuillez contacter votre banque ou notre support pour plus d'informations.</p>
        `,
      }).catch(err => console.error('Failed to send bank failure email:', err));

    } else if (status === 'CANCELLED') {
      await c.env.DB
        .prepare(`
          UPDATE transactions
          SET status = 'CANCELLED',
              failure_reason = 'Virement annulé',
              external_reference = ?,
              completed_at = datetime('now'),
              updated_at = datetime('now')
          WHERE id = ?
        `)
        .bind(bankReference, existingTransaction.id)
        .run();
    }

    // Log the webhook processing
    await c.env.DB
      .prepare(`
        INSERT INTO audit_logs (id, action, entity_type, entity_id, new_value, ip_address, created_at)
        VALUES (?, 'BANK_WEBHOOK_PROCESSED', 'transaction', ?, ?, ?, datetime('now'))
      `)
      .bind(
        crypto.randomUUID(),
        existingTransaction.id,
        JSON.stringify({ status, bankReference, amount }),
        c.req.header('CF-Connecting-IP') || 'unknown'
      )
      .run();

    return c.json({
      success: true,
      data: {
        transactionId: existingTransaction.id,
        status,
        processed: true,
      },
      requestId,
    });
  } catch (error) {
    console.error('Bank webhook error:', error);
    return c.json({ success: false, error: 'Processing error', requestId }, 500);
  }
});

/**
 * KYC Webhook (Smile Identity)
 * POST /webhooks/kyc
 */
webhooks.post('/kyc', async (c) => {
  const requestId = crypto.randomUUID();

  try {
    const rawBody = await c.req.text();
    const signature = c.req.header('X-SmileIdentity-Signature') || c.req.header('X-Signature') || '';
    const { notificationService } = getServices(c.env);

    // Initialize KYC service
    const kycService = new KycService(c.env.DB, c.env.STORAGE, {
      apiKey: c.env.SMILE_IDENTITY_API_KEY,
      partnerId: c.env.SMILE_IDENTITY_PARTNER_ID,
      environment: c.env.ENVIRONMENT === 'production' ? 'production' : 'sandbox',
      callbackUrl: `https://api.tnc-trading.com/api/v1/webhooks/kyc`,
    });

    // Verify Smile Identity webhook signature
    if (!(await kycService.verifyWebhookSignature(rawBody, signature))) {
      console.error('Invalid Smile Identity webhook signature');
      return c.json({ success: false, error: 'Invalid signature', requestId }, 401);
    }

    const body = JSON.parse(rawBody);

    // Process the callback using KycService
    const result = await kycService.processCallback(body);

    if (!result.success) {
      console.error('KYC callback processing failed:', result.error);
      return c.json({ success: false, error: result.error || 'Processing failed' }, 400);
    }

    // Send notifications based on result
    if (result.userId) {
      const user = await c.env.DB
        .prepare('SELECT email, kyc_level FROM users WHERE id = ?')
        .bind(result.userId)
        .first<any>();

      const kycDoc = await c.env.DB
        .prepare('SELECT first_name FROM kyc_documents WHERE verification_job_id = ?')
        .bind(body.job_id)
        .first<any>();

      if (user) {
        if (result.newKycLevel) {
          // KYC approved
          await notificationService.sendKycApproved(
            user.email,
            kycDoc?.first_name || user.email,
            result.newKycLevel
          );
        } else {
          // KYC rejected
          await notificationService.sendKycRejected(
            user.email,
            kycDoc?.first_name || user.email,
            body.result_text || 'Document non reconnu'
          );
        }
      }
    }

    return c.json({ success: true, requestId });
  } catch (error) {
    console.error('KYC webhook error:', error);
    return c.json({ success: false, error: 'Processing error', requestId }, 500);
  }
});

/**
 * Generic webhook status check endpoint
 * GET /webhooks/status/:provider/:transactionId
 */
webhooks.get('/status/:provider/:transactionId', async (c) => {
  const { provider, transactionId } = c.req.param();
  const requestId = crypto.randomUUID();

  const { paymentService } = getServices(c.env);
  const result = await paymentService.checkPaymentStatus(provider, transactionId);

  return c.json({
    success: true,
    data: result,
    requestId,
  });
});

/**
 * Test webhook endpoint (development only)
 * POST /webhooks/test
 */
webhooks.post('/test', async (c) => {
  // Only allow in development
  if (c.env.ENVIRONMENT !== 'development') {
    return c.json({ success: false, error: 'Not available in production' }, 403);
  }

  const body = await c.req.json();
  const { paymentService } = getServices(c.env);
  const configService = new ConfigService(c.env.DB, c.env.CACHE);
  const defaultTestAmount = await configService.getNumber('test_webhook_default_amount', 10000);

  const webhook: WebhookPayload = {
    provider: body.provider || 'test',
    transactionId: body.transactionId || crypto.randomUUID(),
    status: body.status || 'SUCCESS',
    amount: body.amount || defaultTestAmount,
    currency: 'XOF',
    reference: body.reference || crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    raw: body,
  };

  const result = await paymentService.processWebhook(webhook);

  return c.json({
    success: true,
    data: {
      webhook,
      result,
    },
  });
});

export const webhookRoutes = webhooks;
