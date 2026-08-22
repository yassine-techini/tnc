import { Hono } from 'hono';
// Contrats partagés : `satisfies` ci-dessous fait échouer la compilation si
// la forme émise s'écarte de ce que les clients importent.
import type {
  PriceHistoryData,
  MarketStockData,
  QuoteData,
  TradeExecutionData,
} from '@tnc-trading/shared/contracts';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv, Env } from '../types/env';
import { authMiddleware } from '../middleware/auth';
import { MarketService } from '../services/market.service';
import { WalletService } from '../services/wallet.service';
import { GoldAPIService } from '../services/goldapi.service';
import { PriceAlertService } from '../services/price-alert.service';
import { NotificationService } from '../services/notification.service';
import { ConfigService } from '../services/config.service';
import { chiffresReserve } from '../lib/reserve';
import { requireTwoFactorIfHighValue } from '../lib/high-value-2fa';
import { KycService } from '../services/kyc.service';
import { texte } from '../lib/reponse-erreur';
import { surErreurDeValidation } from '../lib/validation-hook';

const market = new Hono<AppEnv>();

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
        message: texte(c, 'MARKET_PRICE_UNAVAILABLE'),
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
  // SECURITY: Whitelist valid period values
  const validPeriods = ['24h', '7d', '30d', '1y'] as const;
  const requestedPeriod = c.req.query('period') || '24h';
  const period = validPeriods.includes(requestedPeriod as typeof validPeriods[number])
    ? (requestedPeriod as typeof validPeriods[number])
    : '24h';

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
    } satisfies PriceHistoryData,
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
        // Aucun stock, donc aucun jeton emis : le ratio est sans objet.
        coverageRatio: null,
        lastAuditDate: null,
      } satisfies MarketStockData,
      requestId,
    });
  }

  // Meme source que le portail Etat et le back-office (ADR 012). Cette route
  // lisait deja `tokens_issued`, la bonne colonne ; ce qui changeait etait le
  // NOM du champ — `coverage` designait ici un ratio, et le meme mot designait
  // le taux d'utilisation cote administration.
  const reserve = chiffresReserve(stock);

  return c.json({
    success: true,
    data: {
      totalAllocated: reserve.alloueG,
      tokensIssued: reserve.emisG,
      availableStock: reserve.disponibleG,
      coverageRatio: reserve.couverture,
      lastAuditDate: stock.last_audit_date ?? null,
    } satisfies MarketStockData,
    requestId,
  });
});

// Protected routes
// Amount bounds:
// - grams: min 0.001g (smallest tradable unit), max 10,000g (reasonable upper limit)
// - XOF: min 100 XOF, max 500,000,000 XOF (500M, matches monthly limit for large traders)
const MAX_GRAMS = 10000;
const MIN_GRAMS = 0.001;
const MAX_XOF = 500_000_000;

/**
 * Plancher ABSOLU d'un ordre exprime en XOF.
 *
 * Il ne suffit pas a garantir une quantite non nulle : `tokenAmount` est tronque
 * au milligramme, donc 100 XOF n'achetent un milligramme que tant que le gramme
 * vaut moins de 100 000 XOF. Au cours actuel (~53 000 XOF/g) la marge est d'un
 * facteur deux — pas d'une impossibilite sur la duree de vie d'une plateforme
 * souveraine.
 *
 * La constante encodait donc une hypothese sur le prix de l'or sans la nommer.
 * Le vrai plancher est desormais DERIVE du cours (`planchierXof`) ; celui-ci ne
 * reste qu'un minimum de bon sens, independant du marche.
 */
const MIN_XOF = 100;

/**
 * Le montant minimal qui achete encore un milligramme, au cours du moment.
 *
 * Arrondi au XOF SUPERIEUR : au XOF inferieur, le montant annonce a
 * l'utilisateur serait lui-meme refuse.
 */
export function planchierXof(pricePerGram: number): number {
  // `Number.isFinite` et pas seulement `> 0` : `Infinity > 0` est vrai, et
  // produirait un plancher infini — donc un marche ferme a tout le monde.
  if (!Number.isFinite(pricePerGram) || pricePerGram <= 0) return MIN_XOF;
  return Math.max(MIN_XOF, Math.ceil(MIN_GRAMS * pricePerGram));
}

const quoteSchema = z.object({
  type: z.enum(['BUY', 'SELL']),
  amount: z.number().positive().max(MAX_XOF),
  amountType: z.enum(['grams', 'xof']),
}).refine(
  (data) => {
    if (data.amountType === 'grams') {
      return data.amount >= MIN_GRAMS && data.amount <= MAX_GRAMS;
    }
    return data.amount >= MIN_XOF && data.amount <= MAX_XOF;
  },
  (data) => ({
    message: data.amountType === 'grams'
      ? `Quantité doit être entre ${MIN_GRAMS}g et ${MAX_GRAMS}g`
      : `Montant doit être entre ${MIN_XOF} et ${MAX_XOF} XOF`,
  })
);

// POST /market/quote - Protected
market.post('/quote', authMiddleware, zValidator('json', quoteSchema, surErreurDeValidation), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId');
  const kycLevel = c.get('kycLevel') as 'BASIC' | 'STANDARD' | 'VERIFIED';
  const requestId = crypto.randomUUID();

  const configService = new ConfigService(c.env.DB, c.env.CACHE);
  const marketService = new MarketService(c.env.DB, c.env.CACHE, c.env.ENVIRONMENT, configService);

  // Check KYC level permissions (centralized in KycService)
  const kycLimits = await KycService.getKycLimits(configService);
  const limits = kycLimits[kycLevel];
  if (body.type === 'BUY' && limits.dailyBuy === 0) {
    return c.json({
      success: false,
      error: {
        code: 'KYC_LEVEL_INSUFFICIENT',
        message: texte(c, 'KYC_LEVEL_INSUFFICIENT', { operation: 'achat' }),
      },
      requestId,
    }, 403);
  }

  if (body.type === 'SELL' && !limits.canSell) {
    return c.json({
      success: false,
      error: {
        code: 'KYC_LEVEL_INSUFFICIENT',
        message: texte(c, 'KYC_LEVEL_INSUFFICIENT', { operation: 'vente' }),
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
        message: texte(c, 'MARKET_PRICE_UNAVAILABLE'),
      },
      requestId,
    }, 503);
  }

  if (body.amountType === 'grams') {
    tokenAmount = body.amount;
  } else {
    // Convert XOF to grams
    const pricePerGram = body.type === 'BUY' ? price.buy_price : price.sell_price;

    // Le plancher se DEDUIT du cours. `MIN_XOF` seul laissait passer un montant
    // qui, tronque au milligramme, donnait zero gramme : le devis valait alors
    // 0 g pour 0 XOF, et rien sur le chemin d'execution ne le refusait.
    const plancher = planchierXof(pricePerGram);
    if (body.amount < plancher) {
      return c.json({
        success: false,
        error: {
          code: 'TRADING_AMOUNT_TOO_SMALL',
          message: texte(c, 'TRADING_AMOUNT_TOO_SMALL', { grammesMinimum: MIN_GRAMS, plancher: { montant: plancher, devise: 'XOF' } }),
          details: { minimumXof: plancher, minimumGrams: MIN_GRAMS, pricePerGram },
        },
        requestId,
      }, 400);
    }

    tokenAmount = body.amount / pricePerGram;
    tokenAmount = Math.floor(tokenAmount * 1000) / 1000; // Round to 3 decimals
  }

  // Dernier rempart, quel que soit le chemin d'entree : un devis a quantite nulle
  // n'a pas de sens et ne doit pas exister en base.
  if (!(tokenAmount > 0)) {
    return c.json({
      success: false,
      error: {
        code: 'TRADING_AMOUNT_TOO_SMALL',
        message: texte(c, 'TRADING_AMOUNT_TOO_SMALL', { grammesMinimum: MIN_GRAMS }),
        details: { minimumGrams: MIN_GRAMS },
      },
      requestId,
    }, 400);
  }

  // Check stock for buy orders
  if (body.type === 'BUY') {
    const canPurchase = await marketService.canPurchase(tokenAmount);
    if (!canPurchase) {
      return c.json({
        success: false,
        error: {
          code: 'TRADING_INSUFFICIENT_STOCK',
          message: texte(c, 'TRADING_INSUFFICIENT_STOCK'),
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
    } satisfies QuoteData,
    requestId,
  });
});

const executeSchema = z.object({
  quoteId: z.string().uuid(),
  paymentMethod: z.enum(['orange_money', 'moov_money', 'card', 'bank']).optional(),
  idempotencyKey: z.string().max(64).optional(),
  /**
   * Exige seulement au-dessus du seuil de forte valeur (ADR 009). Le rendre
   * obligatoire partout ferait saisir un code pour acheter un gramme.
   */
  totpCode: z.string().regex(/^\d{6}$/).optional(),
});

// Helper: Get TransactionSession Durable Object stub for a user
function getTransactionSession(env: Env, userId: string) {
  const id = env.TRANSACTION_SESSION.idFromName(`user:${userId}`);
  return env.TRANSACTION_SESSION.get(id);
}

// POST /market/buy - Protected
market.post('/buy', authMiddleware, zValidator('json', executeSchema, surErreurDeValidation), async (c) => {
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

  const configService = new ConfigService(c.env.DB, c.env.CACHE);
  const marketService = new MarketService(c.env.DB, c.env.CACHE, c.env.ENVIRONMENT, configService);
  const walletService = new WalletService(c.env.DB);

  // Second facteur au-dessus du seuil (ADR 009).
  //
  // Place AVANT `useQuote()`, qui consomme le devis de facon atomique : verifier
  // apres ferait perdre le devis a chaque code mal saisi, et le prix aurait
  // change au moment de recommencer.
  const quoteAVerifier = await marketService.getQuote(body.quoteId);
  if (quoteAVerifier && quoteAVerifier.user_id === userId) {
    const garde = await requireTwoFactorIfHighValue({
      db: c.env.DB,
      cache: c.env.CACHE,
      encryptionKey: c.env.ENCRYPTION_KEY,
      userId,
      amountXof: quoteAVerifier.total,
      operation: 'BUY',
      totpCode: body.totpCode,
      ipAddress: c.req.header('CF-Connecting-IP'),
      userAgent: c.req.header('User-Agent'),
    });

    if (!garde.ok) {
      return c.json({
        success: false,
        error: {
          code: garde.code,
          message: texte(c, garde.code),
          details: { thresholdXof: garde.thresholdXof },
        },
        requestId,
      }, garde.status);
    }
  }

  // Validate quote (must be first - marks quote as USED atomically)
  const quote = await marketService.useQuote(body.quoteId, userId);
  if (!quote) {
    return c.json({
      success: false,
      error: {
        code: 'TRADING_PRICE_EXPIRED',
        message: texte(c, 'TRADING_PRICE_EXPIRED'),
      },
      requestId,
    }, 400);
  }

  if (quote.type !== 'BUY') {
    return c.json({
      success: false,
      error: {
        code: 'TRADING_INVALID_QUOTE_TYPE',
        message: texte(c, 'TRADING_INVALID_QUOTE_TYPE', { attendu: 'achat' }),
      },
      requestId,
    }, 400);
  }

  // Acquire transaction lock via Durable Object (prevents concurrent transactions)
  const txSession = getTransactionSession(c.env, userId);
  const lockResponse = await txSession.fetch('https://do/lock', {
    method: 'POST',
    body: JSON.stringify({
      userId,
      quoteId: body.quoteId,
      transactionType: 'BUY',
      tokenAmount: quote.token_amount,
      requestId,
    }),
  });

  if (!lockResponse.ok) {
    const lockError = await lockResponse.json() as { reason: string; message: string };
    return c.json({
      success: false,
      error: {
        code: 'TRANSACTION_LOCKED',
        message: texte(c, 'TRANSACTION_LOCKED'),
      },
      requestId,
    }, 409);
  }

  // Release lock helper (used on success and failure)
  const releaseLock = async () => {
    try {
      await txSession.fetch('https://do/release', {
        method: 'POST',
        body: JSON.stringify({ userId, requestId }),
      });
    } catch (e) {
      console.error('[Market] Failed to release transaction lock:', e);
    }
  };

  // `finally` plutot que des liberations dispersees (ADR 022) : une
  // exception entre la prise et le relachement laissait le titulaire
  // incapable d'acheter, de vendre ou de retirer — les trois partagent ce
  // verrou — jusqu'a son expiration, deux minutes plus tard.
  try {

    // Check KYC limits
    const kycLimits = await KycService.getKycLimits(configService);
    const limits = kycLimits[kycLevel];
    const dailyVolume = await walletService.getDailyTransactionVolume(userId, 'BUY');
    const monthlyVolume = await walletService.getMonthlyTransactionVolume(userId, 'BUY');

    if (dailyVolume + quote.token_amount > limits.dailyBuy) {
      return c.json({
        success: false,
        error: {
          code: 'TRADING_LIMIT_EXCEEDED',
          message: texte(c, 'TRADING_LIMIT_EXCEEDED', { limiteG: limits.dailyBuy, periode: 'jour' }),
        },
        requestId,
      }, 400);
    }

    if (monthlyVolume + quote.token_amount > limits.monthlyBuy) {
      return c.json({
        success: false,
        error: {
          code: 'TRADING_LIMIT_EXCEEDED',
          message: texte(c, 'TRADING_LIMIT_EXCEEDED', { limiteG: limits.monthlyBuy, periode: 'mois' }),
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

    // Atomic execution: stock reservation + wallet debit + transaction record run
    // as a single all-or-nothing D1 batch. CHECK constraints guarantee no
    // overselling and no overdraft even under concurrent requests; a mid-request
    // failure leaves NO partial state (no orphan stock reservation).
    const transactionId = crypto.randomUUID();
    const result = await walletService.executeBuyAtomic({
      transactionId,
      userId,
      walletId: wallet.id,
      tokenAmount: quote.token_amount,
      cashAmount: quote.cash_amount,
      total: quote.total,
      pricePerGram: quote.price_per_gram,
      fees: quote.fees,
      paymentMethod: body.paymentMethod,
    });

    if (!result.ok) {
      const reason = result.reason; // capture before await (await resets narrowing)
      const errorMap = {
        INSUFFICIENT_STOCK: { status: 400, code: 'TRADING_INSUFFICIENT_STOCK', message: texte(c, 'TRADING_INSUFFICIENT_STOCK') },
        INSUFFICIENT_BALANCE: { status: 400, code: 'TRADING_INSUFFICIENT_BALANCE', message: texte(c, 'TRADING_INSUFFICIENT_BALANCE') },
        CONFLICT: { status: 409, code: 'TRADING_CONFLICT', message: texte(c, 'TRADING_CONFLICT') },
      } as const;
      // No transaction happened on a transient conflict — give the quote back so
      // the user can retry without requesting a new one.
      if (reason === 'CONFLICT') await marketService.restoreQuote(body.quoteId, userId);
      const e = errorMap[reason];
      return c.json({ success: false, error: { code: e.code, message: e.message }, requestId }, e.status);
    }

    // Transaction successful - release lock

    const buyResponse = {
      success: true,
      data: {
        transactionId,
        type: 'BUY',
        tokenAmount: quote.token_amount,
        cashAmount: quote.total,
        status: 'COMPLETED',
      } satisfies TradeExecutionData,
      requestId,
    };

    // Cache idempotency response
    if (body.idempotencyKey) {
      const idempotencyTtl = await configService.getNumber('idempotency_cache_ttl', 86400);
      c.executionCtx.waitUntil(
        c.env.CACHE.put(
          `idempotency:buy:${userId}:${body.idempotencyKey}`,
          JSON.stringify(buyResponse),
          { expirationTtl: idempotencyTtl }
        )
      );
    }

    return c.json(buyResponse);
  } finally {
    await releaseLock();
  }
});

// POST /market/sell - Protected
market.post('/sell', authMiddleware, zValidator('json', executeSchema, surErreurDeValidation), async (c) => {
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

  const configService = new ConfigService(c.env.DB, c.env.CACHE);
  const marketService = new MarketService(c.env.DB, c.env.CACHE, c.env.ENVIRONMENT, configService);
  const walletService = new WalletService(c.env.DB);

  // Check KYC can sell
  const kycLimits = await KycService.getKycLimits(configService);
  const limits = kycLimits[kycLevel];
  if (!limits.canSell) {
    return c.json({
      success: false,
      error: {
        code: 'KYC_LEVEL_INSUFFICIENT',
        message: texte(c, 'KYC_LEVEL_INSUFFICIENT', { operation: 'vente' }),
      },
      requestId,
    }, 403);
  }

  // Second facteur au-dessus du seuil (ADR 009).
  //
  // Place AVANT `useQuote()`, qui consomme le devis de facon atomique : verifier
  // apres ferait perdre le devis a chaque code mal saisi, et le prix aurait
  // change au moment de recommencer.
  const quoteAVerifier = await marketService.getQuote(body.quoteId);
  if (quoteAVerifier && quoteAVerifier.user_id === userId) {
    const garde = await requireTwoFactorIfHighValue({
      db: c.env.DB,
      cache: c.env.CACHE,
      encryptionKey: c.env.ENCRYPTION_KEY,
      userId,
      amountXof: quoteAVerifier.total,
      operation: 'SELL',
      totpCode: body.totpCode,
      ipAddress: c.req.header('CF-Connecting-IP'),
      userAgent: c.req.header('User-Agent'),
    });

    if (!garde.ok) {
      return c.json({
        success: false,
        error: {
          code: garde.code,
          message: texte(c, garde.code),
          details: { thresholdXof: garde.thresholdXof },
        },
        requestId,
      }, garde.status);
    }
  }

  // Validate quote (must be first - marks quote as USED atomically)
  const quote = await marketService.useQuote(body.quoteId, userId);
  if (!quote) {
    return c.json({
      success: false,
      error: {
        code: 'TRADING_PRICE_EXPIRED',
        message: texte(c, 'TRADING_PRICE_EXPIRED'),
      },
      requestId,
    }, 400);
  }

  if (quote.type !== 'SELL') {
    return c.json({
      success: false,
      error: {
        code: 'TRADING_INVALID_QUOTE_TYPE',
        message: texte(c, 'TRADING_INVALID_QUOTE_TYPE', { attendu: 'vente' }),
      },
      requestId,
    }, 400);
  }

  // Acquire transaction lock via Durable Object (prevents concurrent transactions)
  const txSession = getTransactionSession(c.env, userId);
  const lockResponse = await txSession.fetch('https://do/lock', {
    method: 'POST',
    body: JSON.stringify({
      userId,
      quoteId: body.quoteId,
      transactionType: 'SELL',
      tokenAmount: quote.token_amount,
      requestId,
    }),
  });

  if (!lockResponse.ok) {
    const lockError = await lockResponse.json() as { reason: string; message: string };
    return c.json({
      success: false,
      error: {
        code: 'TRANSACTION_LOCKED',
        message: texte(c, 'TRANSACTION_LOCKED'),
      },
      requestId,
    }, 409);
  }

  // Release lock helper (used on success and failure)
  const releaseLock = async () => {
    try {
      await txSession.fetch('https://do/release', {
        method: 'POST',
        body: JSON.stringify({ userId, requestId }),
      });
    } catch (e) {
      console.error('[Market] Failed to release transaction lock:', e);
    }
  };

  // `finally` plutot que des liberations dispersees (ADR 022) : une
  // exception entre la prise et le relachement laissait le titulaire
  // incapable d'acheter, de vendre ou de retirer — les trois partagent ce
  // verrou — jusqu'a son expiration, deux minutes plus tard.
  try {

    // Get wallet
    const wallet = await walletService.findByUserId(userId);
    if (!wallet) {
      return c.json({
        success: false,
        error: {
          code: 'WALLET_NOT_FOUND',
          message: texte(c, 'WALLET_NOT_FOUND'),
        },
        requestId,
      }, 404);
    }

    // Atomic execution: token debit + net-cash credit + stock release + record,
    // as a single all-or-nothing D1 batch. The token_balance >= 0 CHECK prevents
    // selling more than held, even under concurrent requests.
    const transactionId = crypto.randomUUID();
    const result = await walletService.executeSellAtomic({
      transactionId,
      userId,
      walletId: wallet.id,
      tokenAmount: quote.token_amount,
      cashAmount: quote.cash_amount,
      total: quote.total,
      pricePerGram: quote.price_per_gram,
      fees: quote.fees,
      paymentMethod: body.paymentMethod,
    });

    if (!result.ok) {
      const reason = result.reason; // capture before await (await resets narrowing)
      if (reason === 'CONFLICT') await marketService.restoreQuote(body.quoteId, userId);
      const message = reason === 'CONFLICT'
        ? 'Transaction non aboutie, veuillez réessayer.'
        : 'Solde de tokens insuffisant';
      const code = reason === 'CONFLICT' ? 'TRADING_CONFLICT' : 'TRADING_INSUFFICIENT_BALANCE';
      return c.json({ success: false, error: { code, message }, requestId }, reason === 'CONFLICT' ? 409 : 400);
    }

    // Transaction successful - release lock

    const sellResponse = {
      success: true,
      data: {
        transactionId,
        type: 'SELL',
        tokenAmount: quote.token_amount,
        cashAmount: quote.total,
        status: 'COMPLETED',
      } satisfies TradeExecutionData,
      requestId,
    };

    // Cache idempotency response
    if (body.idempotencyKey) {
      const idempotencyTtl = await configService.getNumber('idempotency_cache_ttl', 86400);
      c.executionCtx.waitUntil(
        c.env.CACHE.put(
          `idempotency:sell:${userId}:${body.idempotencyKey}`,
          JSON.stringify(sellResponse),
          { expirationTtl: idempotencyTtl }
        )
      );
    }

    return c.json(sellResponse);
  } finally {
    await releaseLock();
  }
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
      error: { code: 'UNAUTHORIZED', message: texte(c, 'UNAUTHORIZED') },
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
        error: { code: 'PRICE_FETCH_FAILED', message: texte(c, 'PRICE_FETCH_FAILED') },
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
      error: { code: 'INTERNAL_ERROR', message: texte(c, 'INTERNAL_ERROR') },
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
