import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types/env';
import { authMiddleware } from '../middleware/auth';
import { MarketService } from '../services/market.service';
import { WalletService } from '../services/wallet.service';
import { UserService } from '../services/user.service';
import { GoldAPIService } from '../services/goldapi.service';
import { PriceAlertService } from '../services/price-alert.service';
import { NotificationService } from '../services/notification.service';

const market = new Hono<{ Bindings: Env }>();

// KYC limits for trading
const KYC_LIMITS = {
  BASIC: { dailyBuy: 0, monthlyBuy: 0, canSell: false },
  STANDARD: { dailyBuy: 100, monthlyBuy: 500, canSell: true },
  VERIFIED: { dailyBuy: 1000, monthlyBuy: 5000, canSell: true },
};

// GET /market/price - Public
market.get('/price', async (c) => {
  const requestId = crypto.randomUUID();
  const marketService = new MarketService(c.env.DB, c.env.CACHE, c.env.ENVIRONMENT);

  const price = await marketService.getFormattedPrice();

  if (!price) {
    return c.json({
      success: false,
      error: {
        code: 'MARKET_PRICE_UNAVAILABLE',
        message: 'Prix du marché temporairement indisponible',
      },
      requestId,
    }, 503);
  }

  return c.json({
    success: true,
    data: price,
    requestId,
  });
});

// GET /market/price/history - Public
market.get('/price/history', async (c) => {
  const requestId = crypto.randomUUID();
  const period = (c.req.query('period') || '24h') as '24h' | '7d' | '30d' | '1y';

  const marketService = new MarketService(c.env.DB, c.env.CACHE, c.env.ENVIRONMENT);
  const history = await marketService.getPriceHistory(period);

  return c.json({
    success: true,
    data: {
      items: history.map((p) => ({
        timestamp: p.timestamp,
        priceXof: p.price_xof,
      })),
      period,
    },
    requestId,
  });
});

// GET /market/stock - Public
market.get('/stock', async (c) => {
  const requestId = crypto.randomUUID();
  const marketService = new MarketService(c.env.DB, c.env.CACHE, c.env.ENVIRONMENT);

  const stock = await marketService.getGoldStock();

  if (!stock) {
    return c.json({
      success: true,
      data: {
        totalAllocated: 0,
        tokensIssued: 0,
        availableStock: 0,
        coverage: 0,
        lastAuditDate: null,
      },
      requestId,
    });
  }

  const availableStock = stock.total_allocated - stock.tokens_issued;
  const coverage = stock.tokens_issued > 0
    ? stock.total_allocated / stock.tokens_issued
    : stock.total_allocated > 0 ? Infinity : 0;

  return c.json({
    success: true,
    data: {
      totalAllocated: stock.total_allocated,
      tokensIssued: stock.tokens_issued,
      availableStock: availableStock,
      coverage: Math.round(coverage * 100) / 100,
      lastAuditDate: stock.last_audit_date,
    },
    requestId,
  });
});

// Protected routes
const quoteSchema = z.object({
  type: z.enum(['BUY', 'SELL']),
  amount: z.number().positive(),
  amountType: z.enum(['grams', 'xof']),
});

// POST /market/quote - Protected
market.post('/quote', authMiddleware, zValidator('json', quoteSchema), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId');
  const kycLevel = c.get('kycLevel') as 'BASIC' | 'STANDARD' | 'VERIFIED';
  const requestId = crypto.randomUUID();

  const marketService = new MarketService(c.env.DB, c.env.CACHE, c.env.ENVIRONMENT);

  // Check KYC level permissions
  const limits = KYC_LIMITS[kycLevel];
  if (body.type === 'BUY' && limits.dailyBuy === 0) {
    return c.json({
      success: false,
      error: {
        code: 'KYC_LEVEL_INSUFFICIENT',
        message: 'Niveau KYC insuffisant pour acheter. Veuillez compléter votre vérification.',
      },
      requestId,
    }, 403);
  }

  if (body.type === 'SELL' && !limits.canSell) {
    return c.json({
      success: false,
      error: {
        code: 'KYC_LEVEL_INSUFFICIENT',
        message: 'Niveau KYC insuffisant pour vendre. Veuillez compléter votre vérification.',
      },
      requestId,
    }, 403);
  }

  // Calculate token amount based on input type
  let tokenAmount: number;
  const price = await marketService.getCurrentPrice();
  if (!price) {
    return c.json({
      success: false,
      error: {
        code: 'MARKET_PRICE_UNAVAILABLE',
        message: 'Prix du marché temporairement indisponible',
      },
      requestId,
    }, 503);
  }

  if (body.amountType === 'grams') {
    tokenAmount = body.amount;
  } else {
    // Convert XOF to grams
    const pricePerGram = body.type === 'BUY' ? price.buy_price : price.sell_price;
    tokenAmount = body.amount / pricePerGram;
    tokenAmount = Math.floor(tokenAmount * 1000) / 1000; // Round to 3 decimals
  }

  // Check stock for buy orders
  if (body.type === 'BUY') {
    const canPurchase = await marketService.canPurchase(tokenAmount);
    if (!canPurchase) {
      return c.json({
        success: false,
        error: {
          code: 'TRADING_INSUFFICIENT_STOCK',
          message: 'Stock insuffisant pour cette transaction',
        },
        requestId,
      }, 400);
    }
  }

  // Generate quote
  const quote = await marketService.generateQuote(userId, body.type, tokenAmount);

  return c.json({
    success: true,
    data: {
      quoteId: quote.id,
      type: quote.type,
      tokenAmount: quote.token_amount,
      cashAmount: quote.cash_amount,
      pricePerGram: quote.price_per_gram,
      fees: quote.fees,
      total: quote.total,
      expiresAt: quote.expires_at,
    },
    requestId,
  });
});

const executeSchema = z.object({
  quoteId: z.string().uuid(),
  paymentMethod: z.enum(['orange_money', 'moov_money', 'card', 'bank']).optional(),
  idempotencyKey: z.string().max(64).optional(),
});

// POST /market/buy - Protected
market.post('/buy', authMiddleware, zValidator('json', executeSchema), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId');
  const kycLevel = c.get('kycLevel') as 'BASIC' | 'STANDARD' | 'VERIFIED';
  const requestId = crypto.randomUUID();

  // Idempotency check: return cached response if key was seen
  if (body.idempotencyKey) {
    const cacheKey = `idempotency:buy:${userId}:${body.idempotencyKey}`;
    const cached = await c.env.CACHE.get(cacheKey, 'json');
    if (cached) return c.json(cached as Record<string, unknown>);
  }

  const marketService = new MarketService(c.env.DB, c.env.CACHE, c.env.ENVIRONMENT);
  const walletService = new WalletService(c.env.DB);

  // Validate quote
  const quote = await marketService.useQuote(body.quoteId, userId);
  if (!quote) {
    return c.json({
      success: false,
      error: {
        code: 'TRADING_PRICE_EXPIRED',
        message: 'Devis expiré ou invalide. Veuillez demander un nouveau devis.',
      },
      requestId,
    }, 400);
  }

  if (quote.type !== 'BUY') {
    return c.json({
      success: false,
      error: {
        code: 'TRADING_INVALID_QUOTE_TYPE',
        message: 'Ce devis n\'est pas pour un achat',
      },
      requestId,
    }, 400);
  }

  // Check KYC limits
  const limits = KYC_LIMITS[kycLevel];
  const dailyVolume = await walletService.getDailyTransactionVolume(userId, 'BUY');
  const monthlyVolume = await walletService.getMonthlyTransactionVolume(userId, 'BUY');

  if (dailyVolume + quote.token_amount > limits.dailyBuy) {
    return c.json({
      success: false,
      error: {
        code: 'TRADING_LIMIT_EXCEEDED',
        message: `Limite journalière dépassée. Max: ${limits.dailyBuy}g/jour`,
      },
      requestId,
    }, 400);
  }

  if (monthlyVolume + quote.token_amount > limits.monthlyBuy) {
    return c.json({
      success: false,
      error: {
        code: 'TRADING_LIMIT_EXCEEDED',
        message: `Limite mensuelle dépassée. Max: ${limits.monthlyBuy}g/mois`,
      },
      requestId,
    }, 400);
  }

  // Step 1: Atomically reserve stock (prevents overselling race condition)
  const stockReserved = await marketService.atomicPurchaseStock(quote.token_amount);
  if (!stockReserved) {
    return c.json({
      success: false,
      error: {
        code: 'TRADING_INSUFFICIENT_STOCK',
        message: 'Stock insuffisant',
      },
      requestId,
    }, 400);
  }

  // Get or create wallet
  let wallet = await walletService.findByUserId(userId);
  if (!wallet) {
    const walletId = crypto.randomUUID();
    wallet = await walletService.create(userId, walletId);
  }

  // Create transaction
  const transactionId = crypto.randomUUID();
  await walletService.createTransaction({
    id: transactionId,
    userId,
    walletId: wallet.id,
    type: 'BUY',
    tokenAmount: quote.token_amount,
    cashAmount: quote.cash_amount,
    pricePerGram: quote.price_per_gram,
    fees: quote.fees,
    paymentMethod: body.paymentMethod,
  });

  // Step 2: Atomically debit wallet (prevents overdraft race condition)
  const walletDebited = await walletService.processBuyTransaction(
    transactionId,
    wallet.id,
    quote.token_amount,
    quote.total
  );

  if (!walletDebited) {
    // Rollback stock reservation
    await marketService.atomicSellStock(quote.token_amount);
    return c.json({
      success: false,
      error: {
        code: 'TRADING_INSUFFICIENT_BALANCE',
        message: 'Solde insuffisant. Veuillez recharger votre compte.',
      },
      requestId,
    }, 400);
  }

  const buyResponse = {
    success: true,
    data: {
      transactionId,
      type: 'BUY',
      tokenAmount: quote.token_amount,
      cashAmount: quote.total,
      status: 'COMPLETED',
    },
    requestId,
  };

  // Cache idempotency response (24h TTL)
  if (body.idempotencyKey) {
    c.executionCtx.waitUntil(
      c.env.CACHE.put(
        `idempotency:buy:${userId}:${body.idempotencyKey}`,
        JSON.stringify(buyResponse),
        { expirationTtl: 86400 }
      )
    );
  }

  return c.json(buyResponse);
});

// POST /market/sell - Protected
market.post('/sell', authMiddleware, zValidator('json', executeSchema), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId');
  const kycLevel = c.get('kycLevel') as 'BASIC' | 'STANDARD' | 'VERIFIED';
  const requestId = crypto.randomUUID();

  // Idempotency check
  if (body.idempotencyKey) {
    const cacheKey = `idempotency:sell:${userId}:${body.idempotencyKey}`;
    const cached = await c.env.CACHE.get(cacheKey, 'json');
    if (cached) return c.json(cached as Record<string, unknown>);
  }

  const marketService = new MarketService(c.env.DB, c.env.CACHE, c.env.ENVIRONMENT);
  const walletService = new WalletService(c.env.DB);

  // Check KYC can sell
  const limits = KYC_LIMITS[kycLevel];
  if (!limits.canSell) {
    return c.json({
      success: false,
      error: {
        code: 'KYC_LEVEL_INSUFFICIENT',
        message: 'Niveau KYC insuffisant pour vendre',
      },
      requestId,
    }, 403);
  }

  // Validate quote
  const quote = await marketService.useQuote(body.quoteId, userId);
  if (!quote) {
    return c.json({
      success: false,
      error: {
        code: 'TRADING_PRICE_EXPIRED',
        message: 'Devis expiré ou invalide',
      },
      requestId,
    }, 400);
  }

  if (quote.type !== 'SELL') {
    return c.json({
      success: false,
      error: {
        code: 'TRADING_INVALID_QUOTE_TYPE',
        message: 'Ce devis n\'est pas pour une vente',
      },
      requestId,
    }, 400);
  }

  // Get wallet
  const wallet = await walletService.findByUserId(userId);
  if (!wallet) {
    return c.json({
      success: false,
      error: {
        code: 'WALLET_NOT_FOUND',
        message: 'Portefeuille non trouvé',
      },
      requestId,
    }, 404);
  }

  // Create transaction
  const transactionId = crypto.randomUUID();
  await walletService.createTransaction({
    id: transactionId,
    userId,
    walletId: wallet.id,
    type: 'SELL',
    tokenAmount: quote.token_amount,
    cashAmount: quote.cash_amount,
    pricePerGram: quote.price_per_gram,
    fees: quote.fees,
    paymentMethod: body.paymentMethod,
  });

  // Step 1: Atomically debit tokens (prevents overdraft race condition)
  const walletDebited = await walletService.processSellTransaction(
    transactionId,
    wallet.id,
    quote.token_amount,
    quote.total
  );

  if (!walletDebited) {
    return c.json({
      success: false,
      error: {
        code: 'TRADING_INSUFFICIENT_BALANCE',
        message: 'Solde de tokens insuffisant',
      },
      requestId,
    }, 400);
  }

  // Step 2: Release stock (tokens returned to available pool)
  await marketService.atomicSellStock(quote.token_amount);

  const sellResponse = {
    success: true,
    data: {
      transactionId,
      type: 'SELL',
      tokenAmount: quote.token_amount,
      cashAmount: quote.total,
      status: 'COMPLETED',
    },
    requestId,
  };

  // Cache idempotency response (24h TTL)
  if (body.idempotencyKey) {
    c.executionCtx.waitUntil(
      c.env.CACHE.put(
        `idempotency:sell:${userId}:${body.idempotencyKey}`,
        JSON.stringify(sellResponse),
        { expirationTtl: 86400 }
      )
    );
  }

  return c.json(sellResponse);
});

// POST /market/price/refresh - Refresh gold price from external API
// This can be called by a scheduled trigger or manually
market.post('/price/refresh', async (c) => {
  const requestId = crypto.randomUUID();

  // Optional: Add authentication for production
  const authHeader = c.req.header('X-Refresh-Secret');
  if (c.env.ENVIRONMENT !== 'development' && authHeader !== c.env.WEBHOOK_SECRET) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid refresh secret' },
      requestId,
    }, 401);
  }

  try {
    const goldApiService = new GoldAPIService(
      c.env.CACHE,
      c.env.GOLD_API_KEY,
      c.env.EXCHANGE_RATE_API_KEY,
      c.env.DB
    );

    const marketService = new MarketService(c.env.DB, c.env.CACHE, c.env.ENVIRONMENT);

    // Fetch fresh price from external API
    const priceData = await goldApiService.fetchCurrentPrice();

    if (!priceData) {
      return c.json({
        success: false,
        error: { code: 'PRICE_FETCH_FAILED', message: 'Unable to fetch gold price' },
        requestId,
      }, 503);
    }

    // Update the market with new price
    const updatedPrice = await marketService.updatePrice({
      priceUsd: priceData.priceUsd,
      exchangeRate: priceData.exchangeRate,
      source: priceData.source,
    });

    // Check and trigger price alerts asynchronously
    let alertResults = { triggered: 0, notified: 0, errors: 0 };
    try {
      const notificationService = new NotificationService(c.env.DB, {
        resendApiKey: c.env.RESEND_API_KEY,
        sendgridApiKey: c.env.SENDGRID_API_KEY,
        twilioAccountSid: c.env.TWILIO_ACCOUNT_SID,
        twilioAuthToken: c.env.TWILIO_AUTH_TOKEN,
        twilioPhoneNumber: c.env.TWILIO_PHONE_NUMBER,
      });

      const priceAlertService = new PriceAlertService(c.env.DB, notificationService);
      alertResults = await priceAlertService.checkAndTriggerAlerts(
        updatedPrice.buy_price, // Use buy price for XOF alerts
        updatedPrice.price_usd
      );
    } catch (alertError) {
      console.error('Error checking price alerts:', alertError);
      // Don't fail the entire request if alerts fail
    }

    return c.json({
      success: true,
      data: {
        priceUsd: updatedPrice.price_usd,
        priceXof: updatedPrice.price_xof,
        buyPrice: updatedPrice.buy_price,
        sellPrice: updatedPrice.sell_price,
        exchangeRate: updatedPrice.exchange_rate,
        source: updatedPrice.source,
        updatedAt: updatedPrice.timestamp,
        alerts: alertResults,
      },
      requestId,
    });
  } catch (error) {
    console.error('Price refresh error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to refresh price' },
      requestId,
    }, 500);
  }
});

// GET /market/price/health - Check price API health status
market.get('/price/health', async (c) => {
  const requestId = crypto.randomUUID();

  const goldApiService = new GoldAPIService(
    c.env.CACHE,
    c.env.GOLD_API_KEY,
    c.env.EXCHANGE_RATE_API_KEY,
    c.env.DB
  );

  const health = await goldApiService.checkHealth();

  return c.json({
    success: true,
    data: health,
    requestId,
  });
});

export const marketRoutes = market;
