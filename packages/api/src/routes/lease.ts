/**
 * Gold lease — /api/v1/lease
 *
 * Placing grams into a lease is a disposal of gold: it leaves the wallet and is
 * lent to a counterparty. So it sits behind the same KYC gate as selling — a
 * holder who may not trade may not lend either.
 */
import { Hono } from 'hono';
// Contrats partages : `satisfies` fait echouer la compilation si la forme
// emise s ecarte de ce que les clients importent.
import type {
  LeaseTermsData,
  LeasePositionsData,
  LeaseAccrualsData,
  LeaseExitData,
} from '@tnc-trading/shared/contracts';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types/env';
import { authMiddleware } from '../middleware/auth';
import { LeaseService } from '../services/lease.service';
import { CountryConfigService } from '../services/country-config.service';
import { MarketService } from '../services/market.service';
import { ConfigService } from '../services/config.service';
import { KycService } from '../services/kyc.service';
import { texte } from '../lib/reponse-erreur';

const lease = new Hono<AppEnv>();

lease.use('/*', authMiddleware);

const openSchema = z.object({
  grams: z.number().positive().max(1_000_000),
});

/** Terms in force, so the app never hardcodes the rate it displays. */
lease.get('/terms', async (c) => {
  const config = new ConfigService(c.env.DB, c.env.CACHE);
  const [annualRate, settlementDays, minimumG] = await Promise.all([
    config.getNumber('lease_annual_rate', 0.06),
    config.getNumber('lease_exit_settlement_days', 3),
    config.getNumber('lease_min_grams', 1),
  ]);

  return c.json({
    success: true,
    data: {
      annualRate,
      annualRatePercent: Math.round(annualRate * 10000) / 100,
      exitSettlementBusinessDays: settlementDays,
      minimumGrams: minimumG,
      // Said plainly because it is the whole point: the yield is funded by
      // lending the gold out, and lent gold is a claim on a counterparty rather
      // than metal sitting in the vault.
      disclosure:
        "Le rendement est financé par la mise en prêt de votre or. Pendant la location, votre or est prêté à une contrepartie : il n'est plus en coffre et n'est pas vendable tant que la position est ouverte. La sortie vous rend vos grammes après le délai de rappel, elle ne les vend pas.",
    } satisfies LeaseTermsData,
  });
});

/** The holder's positions, with the yield accrued so far. */
lease.get('/positions', async (c) => {
  const userId = c.get('userId');
  const service = new LeaseService(c.env.DB);
  const market = new MarketService(c.env.DB, c.env.CACHE, c.env.ENVIRONMENT);

  const [positions, price] = await Promise.all([
    service.listForUser(userId),
    market.getCurrentPrice(),
  ]);
  const spot = price?.price_xof ?? 0;

  return c.json({
    success: true,
    data: {
      positions: positions.map((p) => ({
        id: p.id,
        principalG: p.principal_g,
        annualRate: p.annual_rate,
        accruedXof: Math.round(p.accrued_xof),
        // Yield is XOF; the principal is gold. Two units, never mixed.
        principalValueXof: Math.round(p.principal_g * spot),
        lastAccruedOn: p.last_accrued_on,
        status: p.status,
        openedAt: p.opened_at,
        closedAt: p.closed_at,
      })),
      totalPrincipalG:
        Math.round(
          positions
            .filter((p) => p.status !== 'CLOSED')
            .reduce((sum, p) => sum + p.principal_g, 0) * 1000
        ) / 1000,
      totalAccruedXof: Math.round(
        positions.reduce((sum, p) => sum + p.accrued_xof, 0)
      ),
    } satisfies LeasePositionsData,
  });
});

/** Day-by-day accrual trail for one position. */
lease.get('/positions/:id/accruals', async (c) => {
  const userId = c.get('userId');
  const positionId = c.req.param('id');
  const service = new LeaseService(c.env.DB);

  const position = await service.getById(positionId);
  if (!position || position.user_id !== userId) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: texte(c, 'NOT_FOUND', { ressource: 'position' }) } },
      404
    );
  }

  const rows = await c.env.DB.prepare(
    `SELECT accrual_date, principal_g, price_per_gram, annual_rate, amount_xof
     FROM lease_accruals WHERE position_id = ? ORDER BY accrual_date DESC LIMIT 400`
  )
    .bind(positionId)
    .all<{
      accrual_date: string;
      principal_g: number;
      price_per_gram: number;
      annual_rate: number;
      amount_xof: number;
    }>();

  return c.json({
    success: true,
    data: {
      positionId,
      accruedXof: Math.round(position.accrued_xof),
      // Every line, so the total can be recomputed rather than trusted.
      accruals: (rows.results || []).map((r) => ({
        date: r.accrual_date,
        principalG: r.principal_g,
        pricePerGram: r.price_per_gram,
        annualRate: r.annual_rate,
        amountXof: r.amount_xof,
      })),
    } satisfies LeaseAccrualsData,
  });
});

/** Open a position: the grams leave the wallet. */
lease.post('/positions', zValidator('json', openSchema), async (c) => {
  const userId = c.get('userId');
  const { grams } = c.req.valid('json');

  // Same gate as selling: lending gold away is a disposal. The check reads the
  // database only — no provider call — so the credentials stay empty here
  // rather than being threaded through a route that never contacts Smile.
  const kyc = new KycService(c.env.DB, c.env.STORAGE, {
    apiKey: '',
    partnerId: '',
    environment: c.env.ENVIRONMENT === 'production' ? 'production' : 'sandbox',
    callbackUrl: '',
  });
  const tradable = await kyc.isKycValidForTrading(userId);
  if (!tradable.valid) {
    return c.json(
      {
        success: false,
        error: {
          code: 'KYC_LEVEL_INSUFFICIENT',
          message: texte(c, 'KYC_LEVEL_INSUFFICIENT', { operation: 'generique' }),
          details: { reason: tradable.reason },
        },
      },
      403
    );
  }

  const config = new ConfigService(c.env.DB, c.env.CACHE);
  const [annualRate, minimumG] = await Promise.all([
    config.getNumber('lease_annual_rate', 0.06),
    config.getNumber('lease_min_grams', 1),
  ]);

  const service = new LeaseService(c.env.DB);
  const result = await service.open(userId, grams, annualRate, minimumG);

  if (!result.ok) {
    const status = result.error === 'INSUFFICIENT_BALANCE' ? 400 : result.error === 'CONFLICT' ? 409 : 400;
    const messages: Record<string, string> = {
      INSUFFICIENT_BALANCE: 'Solde en or insuffisant',
      BELOW_MINIMUM: `Le minimum est de ${minimumG} g`,
      NO_WALLET: 'Portefeuille introuvable',
      CONFLICT: 'Opération concurrente, veuillez réessayer',
    };
    return c.json(
      {
        success: false,
        error: { code: result.error, message: messages[result.error] || 'Opération impossible' },
      },
      status as 400 | 409
    );
  }

  return c.json({
    success: true,
    data: {
      id: result.position.id,
      principalG: result.position.principal_g,
      annualRate: result.position.annual_rate,
      status: result.position.status,
      openedAt: result.position.opened_at,
    },
  }, 201);
});

/** Request an exit. The gold comes back after the recall period (ADR 004). */
lease.post('/positions/:id/exit', async (c) => {
  const userId = c.get('userId');
  const positionId = c.req.param('id');

  const config = new ConfigService(c.env.DB, c.env.CACHE);
  const settlementDays = await config.getNumber('lease_exit_settlement_days', 3);

  // Le calendrier ouvré appartient au PAYS du titulaire, pas à la plateforme
  // (ADR 017). La liste est vide tant que l'exploitant ne l'a pas renseignée —
  // une liste fausse produirait silencieusement de mauvaises dates de règlement.
  const titulaire = await c.env.DB
    .prepare('SELECT country FROM users WHERE id = ?')
    .bind(userId)
    .first<{ country: string | null }>();
  const pays = await new CountryConfigService(c.env.DB).forUser(titulaire?.country);

  const service = new LeaseService(c.env.DB);
  const result = await service.requestExit(
    positionId,
    userId,
    settlementDays,
    new Date(),
    pays.businessHolidays
  );

  if (!result.ok) {
    const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'CONFLICT' ? 409 : 400;
    const messages: Record<string, string> = {
      NOT_FOUND: 'Position introuvable',
      ALREADY_EXITING: 'Une sortie est déjà en cours sur cette position',
      NOT_ACTIVE: 'Cette position est clôturée',
      CONFLICT: 'Opération concurrente, veuillez réessayer',
    };
    return c.json(
      {
        success: false,
        error: {
          code: result.error,
          message: messages[result.error as string] || 'Sortie impossible',
        },
      },
      status as 400 | 404 | 409
    );
  }

  return c.json({
    success: true,
    data: {
      positionId,
      settlesOn: result.settlesOn,
      message: `Vos grammes reviendront dans votre portefeuille le ${result.settlesOn}, avec le rendement accumulé.`,
    } satisfies LeaseExitData,
  });
});

export { lease as leaseRoutes };
