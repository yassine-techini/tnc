import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types/env';
import { authMiddleware } from '../middleware/auth';
import { WalletService } from '../services/wallet.service';
import { MarketService } from '../services/market.service';
import { CertificateService } from '../services/certificate.service';
import { PaymentService } from '../services/payment.service';
import { ConfigService } from '../services/config.service';

const wallet = new Hono<AppEnv>();

// Default withdrawal limits by KYC level (XOF/day) — overridden by config
const DEFAULT_WITHDRAWAL_LIMITS = {
  BASIC: 0,
  STANDARD: 500_000,
  VERIFIED: 5_000_000,
};

async function getWithdrawalLimits(configService: ConfigService) {
  const [basic, standard, verified] = await Promise.all([
    configService.getNumber('kyc_basic_daily_withdraw', DEFAULT_WITHDRAWAL_LIMITS.BASIC),
    configService.getNumber('kyc_standard_daily_withdraw', DEFAULT_WITHDRAWAL_LIMITS.STANDARD),
    configService.getNumber('kyc_verified_daily_withdraw', DEFAULT_WITHDRAWAL_LIMITS.VERIFIED),
  ]);
  return { BASIC: basic, STANDARD: standard, VERIFIED: verified };
}

// All routes require authentication
wallet.use('/*', authMiddleware);

// GET /wallet
wallet.get('/', async (c) => {
  const userId = c.get('userId');
  const requestId = crypto.randomUUID();

  const walletService = new WalletService(c.env.DB);
  const marketService = new MarketService(c.env.DB, c.env.CACHE, c.env.ENVIRONMENT);

  let walletData = await walletService.findByUserId(userId);

  // Create wallet if doesn't exist
  if (!walletData) {
    const walletId = crypto.randomUUID();
    walletData = await walletService.create(userId, walletId);
  }

  // Get current price for estimated value calculation
  const currentPrice = await marketService.getCurrentPrice();
  const estimatedValue = currentPrice
    ? walletData.token_balance * currentPrice.price_xof
    : 0;

  // Calculate average buy price via SQL aggregate (no N+1)
  const { totalTokensBought, totalCashSpent } = await walletService.getAverageBuyPrice(userId);
  const averageBuyPrice = totalTokensBought > 0
    ? totalCashSpent / totalTokensBought
    : 0;

  const currentValue = currentPrice
    ? walletData.token_balance * currentPrice.price_xof
    : 0;
  const costBasis = walletData.token_balance * averageBuyPrice;
  const profitLoss = currentValue - costBasis;
  const profitLossPercent = costBasis > 0
    ? ((currentValue - costBasis) / costBasis) * 100
    : 0;

  return c.json({
    success: true,
    data: {
      id: walletData.id,
      userId: walletData.user_id,
      tokenBalance: walletData.token_balance,
      cashBalance: walletData.cash_balance,
      estimatedValue: Math.round(estimatedValue),
      averageBuyPrice: Math.round(averageBuyPrice),
      profitLoss: Math.round(profitLoss),
      profitLossPercent: Math.round(profitLossPercent * 100) / 100,
      createdAt: walletData.created_at,
      updatedAt: walletData.updated_at,
    },
    requestId,
  });
});

// GET /wallet/transactions
wallet.get('/transactions', async (c) => {
  const userId = c.get('userId');
  const requestId = crypto.randomUUID();

  const { type, status, page = '1', limit = '20' } = c.req.query();
  const pageNum = parseInt(page);
  const configService = new ConfigService(c.env.DB, c.env.CACHE);
  const paginationMaxLimit = await configService.getNumber('pagination_max_limit', 100);
  const limitNum = Math.min(parseInt(limit), paginationMaxLimit);
  const offset = (pageNum - 1) * limitNum;

  const walletService = new WalletService(c.env.DB);
  const { transactions, total } = await walletService.findTransactionsFiltered(
    userId,
    limitNum,
    offset,
    type,
    status
  );

  return c.json({
    success: true,
    data: {
      items: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        status: t.status,
        tokenAmount: t.token_amount,
        cashAmount: t.cash_amount,
        pricePerGram: t.price_per_gram,
        fees: t.fees,
        paymentMethod: t.payment_method,
        createdAt: t.created_at,
        completedAt: t.completed_at,
      })),
      total,
      page: pageNum,
      limit: limitNum,
      hasMore: offset + transactions.length < total,
    },
    requestId,
  });
});

// GET /wallet/transactions/:id
wallet.get('/transactions/:id', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const requestId = crypto.randomUUID();

  const walletService = new WalletService(c.env.DB);
  const transaction = await walletService.findTransactionById(id);

  if (!transaction) {
    return c.json({
      success: false,
      error: {
        code: 'TRANSACTION_NOT_FOUND',
        message: 'Transaction non trouvée',
      },
      requestId,
    }, 404);
  }

  // Verify transaction belongs to user
  if (transaction.user_id !== userId) {
    return c.json({
      success: false,
      error: {
        code: 'TRANSACTION_ACCESS_DENIED',
        message: 'Accès refusé',
      },
      requestId,
    }, 403);
  }

  return c.json({
    success: true,
    data: {
      id: transaction.id,
      type: transaction.type,
      status: transaction.status,
      tokenAmount: transaction.token_amount,
      cashAmount: transaction.cash_amount,
      pricePerGram: transaction.price_per_gram,
      fees: transaction.fees,
      paymentMethod: transaction.payment_method,
      paymentReference: transaction.payment_reference,
      failureReason: transaction.failure_reason,
      createdAt: transaction.created_at,
      completedAt: transaction.completed_at,
    },
    requestId,
  });
});

const depositSchema = z.object({
  amount: z.number().positive(),
  paymentMethod: z.enum(['orange_money', 'moov_money', 'card', 'bank']),
  phoneNumber: z.string().optional(), // Required for mobile money
});

// POST /wallet/deposit
wallet.post('/deposit', zValidator('json', depositSchema), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const requestId = crypto.randomUUID();

  const walletService = new WalletService(c.env.DB);
  const configService = new ConfigService(c.env.DB, c.env.CACHE);

  // Validate minimum deposit amount (configurable)
  const minDeposit = await configService.getNumber('min_deposit_xof', 1000);
  if (body.amount < minDeposit) {
    return c.json({
      success: false,
      error: {
        code: 'AMOUNT_TOO_LOW',
        message: `Montant minimum de dépôt: ${minDeposit} XOF`,
      },
      requestId,
    }, 400);
  }

  // Validate phone number for mobile money
  if ((body.paymentMethod === 'orange_money' || body.paymentMethod === 'moov_money') && !body.phoneNumber) {
    return c.json({
      success: false,
      error: {
        code: 'PHONE_REQUIRED',
        message: 'Numéro de téléphone requis pour le paiement mobile',
      },
      requestId,
    }, 400);
  }

  // Get or create wallet
  let walletData = await walletService.findByUserId(userId);
  if (!walletData) {
    const walletId = crypto.randomUUID();
    walletData = await walletService.create(userId, walletId);
  }

  // Create pending deposit transaction
  const transactionId = crypto.randomUUID();
  await walletService.createTransaction({
    id: transactionId,
    userId,
    walletId: walletData.id,
    type: 'DEPOSIT',
    cashAmount: body.amount,
    fees: 0,
    paymentMethod: body.paymentMethod,
    paymentReference: body.phoneNumber,
  });

  // Initialize payment service
  const paymentService = new PaymentService(c.env.DB, c.env.CACHE, {
    orangeMoneyApiKey: c.env.ORANGE_MONEY_API_KEY,
    orangeMoneyMerchantId: c.env.ORANGE_MONEY_MERCHANT_ID,
    orangeMoneyClientId: c.env.ORANGE_MONEY_CLIENT_ID,
    orangeMoneyClientSecret: c.env.ORANGE_MONEY_CLIENT_SECRET,
    moovApiKey: c.env.MOOV_MONEY_API_KEY,
    moovMerchantId: c.env.MOOV_MERCHANT_ID,
    cinetpayApiKey: c.env.CINETPAY_API_KEY,
    cinetpaySiteId: c.env.CINETPAY_SITE_ID,
    webhookSecret: c.env.WEBHOOK_SECRET,
  });

  // Get user email for payment notification
  const user = await c.env.DB
    .prepare('SELECT email FROM users WHERE id = ?')
    .bind(userId)
    .first<{ email: string }>();

  try {
    // Initiate payment with the selected provider
    const paymentResult = await paymentService.initiatePayment(body.paymentMethod, {
      amount: body.amount,
      currency: 'XOF',
      reference: transactionId,
      description: `Dépôt TNC Trading - ${body.amount.toLocaleString('fr-FR')} XOF`,
      customerEmail: user?.email,
      customerPhone: body.phoneNumber,
      returnUrl: `${await configService.get('app_url', 'https://app.tnc-trading.com')}/wallet/deposit/callback?ref=${transactionId}`,
      cancelUrl: `${await configService.get('app_url', 'https://app.tnc-trading.com')}/wallet/deposit/cancel?ref=${transactionId}`,
      notifyUrl: `${await configService.get('api_url', 'https://api.tnc-trading.com')}/api/v1/webhooks/payment/${body.paymentMethod === 'card' ? 'cinetpay' : body.paymentMethod.replace('_money', '')}`,
    });

    if (!paymentResult.success) {
      // Update transaction status to failed
      await c.env.DB
        .prepare('UPDATE transactions SET status = ?, failure_reason = ? WHERE id = ?')
        .bind('FAILED', paymentResult.error || 'Erreur d\'initialisation du paiement', transactionId)
        .run();

      return c.json({
        success: false,
        error: {
          code: 'PAYMENT_INIT_FAILED',
          message: paymentResult.error || 'Impossible d\'initialiser le paiement',
        },
        requestId,
      }, 400);
    }

    // Update transaction with payment provider reference
    await c.env.DB
      .prepare('UPDATE transactions SET payment_reference = ?, external_reference = ? WHERE id = ?')
      .bind(paymentResult.transactionId, paymentResult.transactionId, transactionId)
      .run();

    return c.json({
      success: true,
      data: {
        transactionId,
        amount: body.amount,
        paymentMethod: body.paymentMethod,
        paymentUrl: paymentResult.paymentUrl,
        paymentToken: paymentResult.transactionId,
        ussdCode: paymentResult.ussdCode,
        status: 'PENDING',
        expiresIn: await configService.getNumber('payment_expiry_seconds', 1800),
      },
      requestId,
    });
  } catch (error) {
    console.error('Payment initiation error:', error);

    // Update transaction status to failed
    await c.env.DB
      .prepare('UPDATE transactions SET status = ?, failure_reason = ? WHERE id = ?')
      .bind('FAILED', 'Erreur technique lors du paiement', transactionId)
      .run();

    return c.json({
      success: false,
      error: {
        code: 'PAYMENT_ERROR',
        message: 'Une erreur est survenue lors de l\'initialisation du paiement',
      },
      requestId,
    }, 500);
  }
});

const withdrawSchema = z.object({
  amount: z.number().positive(),
  paymentMethod: z.enum(['orange_money', 'moov_money', 'bank']),
  phoneNumber: z.string().optional(), // Required for mobile money
  bankAccount: z.string().optional(), // Required for bank
  bankName: z.string().optional(),    // Required for bank
});

// POST /wallet/withdraw
wallet.post('/withdraw', zValidator('json', withdrawSchema), async (c) => {
  const userId = c.get('userId');
  const kycLevel = c.get('kycLevel') as 'BASIC' | 'STANDARD' | 'VERIFIED';
  const body = c.req.valid('json');
  const requestId = crypto.randomUUID();

  const walletService = new WalletService(c.env.DB);
  const configService = new ConfigService(c.env.DB, c.env.CACHE);

  // Check KYC withdrawal limit (from config)
  const withdrawalLimits = await getWithdrawalLimits(configService);
  const dailyLimit = withdrawalLimits[kycLevel];
  if (dailyLimit === 0) {
    return c.json({
      success: false,
      error: {
        code: 'KYC_LEVEL_INSUFFICIENT',
        message: 'Niveau KYC insuffisant pour effectuer un retrait',
      },
      requestId,
    }, 403);
  }

  // Check daily withdrawal amount
  const todayWithdrawals = await c.env.DB
    .prepare(
      `SELECT COALESCE(SUM(cash_amount), 0) as total
       FROM transactions
       WHERE user_id = ? AND type = 'WITHDRAWAL'
       AND status IN ('PENDING', 'PROCESSING', 'COMPLETED')
       AND created_at >= date('now')`
    )
    .bind(userId)
    .first<{ total: number }>();

  const todayTotal = todayWithdrawals?.total || 0;
  if (todayTotal + body.amount > dailyLimit) {
    return c.json({
      success: false,
      error: {
        code: 'WITHDRAWAL_LIMIT_EXCEEDED',
        message: `Limite de retrait journalière dépassée. Max: ${dailyLimit.toLocaleString('fr-FR')} XOF/jour`,
      },
      requestId,
    }, 400);
  }

  // Get wallet and check balance
  const walletData = await walletService.findByUserId(userId);
  if (!walletData) {
    return c.json({
      success: false,
      error: {
        code: 'WALLET_NOT_FOUND',
        message: 'Portefeuille non trouvé',
      },
      requestId,
    }, 404);
  }

  if (walletData.cash_balance < body.amount) {
    return c.json({
      success: false,
      error: {
        code: 'INSUFFICIENT_BALANCE',
        message: 'Solde insuffisant',
      },
      requestId,
    }, 400);
  }

  // Check for pending withdrawals
  const pendingWithdrawal = await c.env.DB
    .prepare(
      `SELECT id FROM transactions
       WHERE user_id = ? AND type = 'WITHDRAWAL' AND status = 'PENDING'
       LIMIT 1`
    )
    .bind(userId)
    .first();

  if (pendingWithdrawal) {
    return c.json({
      success: false,
      error: {
        code: 'WITHDRAWAL_PENDING',
        message: 'Un retrait est déjà en cours de traitement',
      },
      requestId,
    }, 400);
  }

  // Calculate withdrawal fees based on payment method (configurable)
  const [feeRateMobile, feeRateBank] = await Promise.all([
    configService.getNumber('withdrawal_fee_mobile', 0.01),
    configService.getNumber('withdrawal_fee_bank', 0.005),
  ]);
  const feeRates: Record<string, number> = {
    orange_money: feeRateMobile,
    moov_money: feeRateMobile,
    bank: feeRateBank,
  };
  const feeRate = feeRates[body.paymentMethod] || feeRateMobile;
  const fees = Math.round(body.amount * feeRate);
  const netAmount = body.amount - fees;

  // Create withdrawal transaction
  const transactionId = crypto.randomUUID();
  await walletService.createTransaction({
    id: transactionId,
    userId,
    walletId: walletData.id,
    type: 'WITHDRAWAL',
    cashAmount: body.amount,
    fees,
    paymentMethod: body.paymentMethod,
    paymentReference: body.phoneNumber || body.bankAccount,
  });

  // Create withdrawal record
  const withdrawalId = crypto.randomUUID();
  await c.env.DB
    .prepare(`
      INSERT INTO withdrawals (id, transaction_id, method, amount, fees, net_amount, phone_number, bank_account, bank_name, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', datetime('now'))
    `)
    .bind(
      withdrawalId,
      transactionId,
      body.paymentMethod,
      body.amount,
      fees,
      netAmount,
      body.phoneNumber || null,
      body.bankAccount || null,
      body.bankName || null
    )
    .run();

  // Deduct from cash balance immediately (pending state)
  await walletService.updateCashBalance(walletData.id, -body.amount);

  return c.json({
    success: true,
    data: {
      withdrawalId,
      transactionId,
      amount: body.amount,
      fees,
      netAmount,
      paymentMethod: body.paymentMethod,
      status: 'PENDING',
      estimatedTime: body.paymentMethod === 'bank'
        ? await configService.get('withdrawal_time_bank', '2-3 jours ouvrables')
        : await configService.get('withdrawal_time_mobile', '24-48h'),
    },
    requestId,
  });
});

// GET /wallet/certificate
wallet.get('/certificate', async (c) => {
  const userId = c.get('userId');
  const requestId = crypto.randomUUID();

  const walletService = new WalletService(c.env.DB);
  const certificateService = new CertificateService(c.env.DB, c.env.STORAGE, c.env.CACHE);

  const walletData = await walletService.findByUserId(userId);
  if (!walletData || walletData.token_balance === 0) {
    return c.json({
      success: false,
      error: {
        code: 'NO_TOKENS',
        message: 'Vous n\'avez pas de tokens à certifier',
      },
      requestId,
    }, 400);
  }

  // Get user info
  const user = await c.env.DB
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(userId)
    .first<any>();

  // Get KYC info for user name
  const kyc = await c.env.DB
    .prepare('SELECT first_name, last_name FROM kyc_documents WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
    .bind(userId)
    .first<any>();

  const userName = kyc ? `${kyc.first_name} ${kyc.last_name}` : user?.email || 'Utilisateur';

  // Issue certificate with verification code (persisted to D1)
  const certData = await certificateService.issueCertificate({
    userName,
    userEmail: user?.email || '',
    userId,
    kycLevel: user?.kyc_level || 'BASIC',
    tokenBalance: walletData.token_balance,
    equivalentGrams: walletData.token_balance,
  });

  return c.json({
    success: true,
    data: {
      certificateId: certData.certificateId,
      verificationCode: certData.verificationCode,
      downloadUrl: `/api/v1/wallet/certificate/${certData.certificateId}`,
      userName: certData.userName,
      tokenBalance: certData.tokenBalance,
      issuedAt: certData.issuedAt,
    },
    requestId,
  });
});

// GET /wallet/certificate/:id - Download certificate HTML
wallet.get('/certificate/:id', async (c) => {
  const { id } = c.req.param();

  const certificateService = new CertificateService(c.env.DB, c.env.STORAGE, c.env.CACHE);
  const html = await certificateService.getCertificateHtml(id);

  if (!html) {
    return c.json({
      success: false,
      error: {
        code: 'CERTIFICATE_NOT_FOUND',
        message: 'Certificat non trouvé ou expiré',
      },
      requestId: crypto.randomUUID(),
    }, 404);
  }

  return c.html(html);
});

// GET /wallet/deposits/pending - List pending deposits
wallet.get('/deposits/pending', async (c) => {
  const userId = c.get('userId');
  const requestId = crypto.randomUUID();

  try {
    const pendingDeposits = await c.env.DB
      .prepare(`
        SELECT id, type, status, cash_amount, payment_method, payment_reference,
               created_at, updated_at
        FROM transactions
        WHERE user_id = ? AND type = 'DEPOSIT' AND status IN ('PENDING', 'PROCESSING')
        ORDER BY created_at DESC
      `)
      .bind(userId)
      .all<any>();

    return c.json({
      success: true,
      data: {
        items: pendingDeposits.results?.map(d => ({
          id: d.id,
          amount: d.cash_amount,
          status: d.status,
          paymentMethod: d.payment_method,
          paymentReference: d.payment_reference,
          createdAt: d.created_at,
          updatedAt: d.updated_at,
        })) || [],
        total: pendingDeposits.results?.length || 0,
      },
      requestId,
    });
  } catch (error) {
    console.error('Get pending deposits error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur interne' },
      requestId,
    }, 500);
  }
});

// GET /wallet/deposit/status/:id - Poll deposit status
wallet.get('/deposit/status/:id', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const requestId = crypto.randomUUID();

  try {
    // Get the transaction
    const transaction = await c.env.DB
      .prepare(`
        SELECT id, type, status, cash_amount, fees, payment_method, payment_reference,
               external_reference, failure_reason, created_at, completed_at, updated_at
        FROM transactions
        WHERE id = ? AND user_id = ? AND type = 'DEPOSIT'
      `)
      .bind(id, userId)
      .first<any>();

    if (!transaction) {
      return c.json({
        success: false,
        error: { code: 'DEPOSIT_NOT_FOUND', message: 'Dépôt non trouvé' },
        requestId,
      }, 404);
    }

    // If still processing, try to check with payment provider
    let providerStatus = null;
    if (transaction.status === 'PROCESSING' && transaction.payment_reference) {
      try {
        const paymentService = new PaymentService(c.env.DB, c.env.CACHE, {
          orangeMoneyApiKey: c.env.ORANGE_MONEY_API_KEY,
          orangeMoneyMerchantId: c.env.ORANGE_MONEY_MERCHANT_ID,
          moovApiKey: c.env.MOOV_API_KEY,
          moovMerchantId: c.env.MOOV_MERCHANT_ID,
          cinetpayApiKey: c.env.CINETPAY_API_KEY,
          cinetpaySiteId: c.env.CINETPAY_SITE_ID,
          webhookSecret: c.env.WEBHOOK_SECRET,
        });

        providerStatus = await paymentService.checkPaymentStatus(
          transaction.payment_method,
          transaction.payment_reference
        );
      } catch (e) {
        console.warn('Failed to check provider status:', e);
      }
    }

    // Calculate time since creation
    const createdAt = new Date(transaction.created_at).getTime();
    const now = Date.now();
    const minutesSinceCreation = Math.floor((now - createdAt) / 60000);

    return c.json({
      success: true,
      data: {
        id: transaction.id,
        status: transaction.status,
        amount: transaction.cash_amount,
        fees: transaction.fees,
        netAmount: transaction.cash_amount - (transaction.fees || 0),
        paymentMethod: transaction.payment_method,
        paymentReference: transaction.payment_reference,
        externalReference: transaction.external_reference,
        failureReason: transaction.failure_reason,
        createdAt: transaction.created_at,
        completedAt: transaction.completed_at,
        updatedAt: transaction.updated_at,
        minutesSinceCreation,
        providerStatus,
        // Helpful status messages (thresholds from config)
        statusMessage: getDepositStatusMessage(
          transaction.status,
          minutesSinceCreation,
          await new ConfigService(c.env.DB, c.env.CACHE).getNumber('deposit_processing_fast_minutes', 5),
          await new ConfigService(c.env.DB, c.env.CACHE).getNumber('deposit_processing_slow_minutes', 30)
        ),
      },
      requestId,
    });
  } catch (error) {
    console.error('Get deposit status error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur interne' },
      requestId,
    }, 500);
  }
});

// Helper function for deposit status messages (thresholds configurable)
function getDepositStatusMessage(
  status: string,
  minutesSinceCreation: number,
  processingFastMinutes: number = 5,
  processingSlowMinutes: number = 30
): string {
  switch (status) {
    case 'PENDING':
      return 'En attente de confirmation du paiement';
    case 'PROCESSING':
      if (minutesSinceCreation < processingFastMinutes) {
        return 'Paiement en cours de traitement';
      } else if (minutesSinceCreation < processingSlowMinutes) {
        return 'Traitement en cours, cela peut prendre quelques minutes';
      } else {
        return 'Le traitement prend plus de temps que prévu. Contactez le support si le problème persiste.';
      }
    case 'COMPLETED':
      return 'Dépôt effectué avec succès';
    case 'FAILED':
      return 'Le dépôt a échoué';
    case 'CANCELLED':
      return 'Le dépôt a été annulé';
    default:
      return 'Statut inconnu';
  }
}

// POST /wallet/deposit/:id/cancel - Cancel a pending deposit
wallet.post('/deposit/:id/cancel', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const requestId = crypto.randomUUID();

  try {
    // Get the transaction
    const transaction = await c.env.DB
      .prepare(`
        SELECT * FROM transactions
        WHERE id = ? AND user_id = ? AND type = 'DEPOSIT' AND status = 'PENDING'
      `)
      .bind(id, userId)
      .first<any>();

    if (!transaction) {
      return c.json({
        success: false,
        error: {
          code: 'DEPOSIT_NOT_FOUND',
          message: 'Dépôt non trouvé ou ne peut pas être annulé',
        },
        requestId,
      }, 404);
    }

    // Can only cancel pending deposits (not processing ones)
    if (transaction.status !== 'PENDING') {
      return c.json({
        success: false,
        error: {
          code: 'CANNOT_CANCEL',
          message: 'Ce dépôt est déjà en cours de traitement et ne peut pas être annulé',
        },
        requestId,
      }, 400);
    }

    // Update transaction status
    await c.env.DB
      .prepare(`
        UPDATE transactions
        SET status = 'CANCELLED',
            failure_reason = 'Annulé par l''utilisateur',
            completed_at = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
      `)
      .bind(id)
      .run();

    return c.json({
      success: true,
      data: {
        message: 'Dépôt annulé avec succès',
        transactionId: id,
      },
      requestId,
    });
  } catch (error) {
    console.error('Cancel deposit error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur interne' },
      requestId,
    }, 500);
  }
});

export const walletRoutes = wallet;
