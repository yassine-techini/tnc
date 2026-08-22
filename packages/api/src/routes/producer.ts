/**
 * Producer routes — gold consignment submission and tracking.
 * Authenticated users whose `role` is 'producer'.
 */
import { Hono, Context, Next } from 'hono';
import type { StorageFeesData } from '@tnc-trading/shared/contracts';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types/env';
import { authMiddleware } from '../middleware/auth';
import { ConsignmentService } from '../services/consignment.service';
import { ConfigService } from '../services/config.service';
import {
  sniffImageType,
  sniffDocumentType,
  extensionFor,
  isOwnedConsignmentPhotoKey,
  consignmentPhotoPrefix,
  isOwnedProducerDocumentKey,
  producerDocumentPrefix,
  isOwnedConsignmentDocumentKey,
  consignmentDocumentPrefix,
} from '../lib/image-upload';
import { ProducerProfileService, kybSchema } from '../services/producer-profile.service';
import {
  ConsignmentDocumentService,
  attachDocumentSchema,
} from '../services/consignment-document.service';
import { EncryptionService } from '../services/encryption.service';
import {
  SettlementStatementService,
  statementFilename,
} from '../services/settlement-statement.service';
import { DispositionService } from '../services/disposition.service';
import { StorageFeeService } from '../services/storage-fee.service';
import { MarketService } from '../services/market.service';
import { texte } from '../lib/reponse-erreur';

const producer = new Hono<AppEnv>();

// All routes require a logged-in user…
producer.use('/*', authMiddleware);

// …who is a producer.
async function requireProducer(c: Context<AppEnv>, next: Next) {
  const userId = c.get('userId');
  const row = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first<{ role: string }>();
  if (!row || row.role !== 'producer') {
    return c.json({
      success: false,
      error: { code: 'NOT_A_PRODUCER', message: texte(c, 'NOT_A_PRODUCER') },
      requestId: crypto.randomUUID(),
    }, 403);
  }
  return next();
}
producer.use('/*', requireProducer);

// ============================================
// KYB — identifying the entity behind the account
// ============================================

// POST /producer/profile — submit or resubmit the KYB
producer.post('/profile', async (c) => {
  const userId = c.get('userId');
  const requestId = crypto.randomUUID();
  const parsed = kybSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({
      success: false,
      error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message || texte(c, 'INVALID_INPUT') },
      requestId,
    }, 400);
  }
  const body = parsed.data;

  // Document keys travel through the client, so they are untrusted.
  const badKey = (body.documents ?? []).find((k) => !isOwnedProducerDocumentKey(k, userId));
  if (badKey !== undefined) {
    return c.json({
      success: false,
      error: { code: 'INVALID_DOCUMENT_KEY', message: texte(c, 'INVALID_DOCUMENT_KEY') },
      requestId,
    }, 400);
  }

  // A legal entity must identify itself by its registration; an individual
  // producer is covered by the ordinary KYC flow.
  if (body.entityType !== 'INDIVIDUAL' && !body.registrationNumber) {
    return c.json({
      success: false,
      error: { code: 'REGISTRATION_REQUIRED', message: texte(c, 'REGISTRATION_REQUIRED') },
      requestId,
    }, 400);
  }

  const service = new ProducerProfileService(c.env.DB);
  const profile = await service.submit(userId, body);
  if (!profile) {
    return c.json({
      success: false,
      error: { code: 'ALREADY_VERIFIED', message: texte(c, 'ALREADY_VERIFIED') },
      requestId,
    }, 409);
  }
  return c.json({ success: true, data: profile, requestId }, 201);
});

// GET /producer/profile — own KYB status
producer.get('/profile', async (c) => {
  const userId = c.get('userId');
  const requestId = crypto.randomUUID();
  const service = new ProducerProfileService(c.env.DB);
  const profile = await service.getByUserId(userId);
  if (!profile) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: texte(c, 'NOT_FOUND', { ressource: 'dossier' }) }, requestId }, 404);
  }
  return c.json({ success: true, data: profile, requestId });
});

// POST /producer/profile/documents — upload a KYB document to R2, returns its key
producer.post('/profile/documents', async (c) => {
  const userId = c.get('userId');
  const requestId = crypto.randomUUID();
  const formData = await c.req.formData();
  const file = formData.get('file') as unknown as File;

  if (!file) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: texte(c, 'INVALID_INPUT') }, requestId }, 400);
  }
  const cfg = new ConfigService(c.env.DB, c.env.CACHE);
  const maxSize = await cfg.getNumber('producer_max_document_bytes', 10 * 1024 * 1024);
  if (file.size > maxSize) {
    return c.json({ success: false, error: { code: 'FILE_TOO_LARGE', message: texte(c, 'FILE_TOO_LARGE', { maxMo: Math.round(maxSize / (1024 * 1024)) }) }, requestId }, 400);
  }

  const bytes = await file.arrayBuffer();
  const contentType = sniffDocumentType(bytes);
  if (!contentType) {
    return c.json({ success: false, error: { code: 'INVALID_FILE_TYPE', message: texte(c, 'INVALID_FILE_TYPE') }, requestId }, 400);
  }

  // Company records are as sensitive as identity documents — same fail-closed
  // rule as the KYC upload: refuse rather than store them in the clear.
  if (!c.env.ENCRYPTION_KEY) {
    console.error('Producer document upload refused: ENCRYPTION_KEY is not configured');
    return c.json({
      success: false,
      error: { code: 'ENCRYPTION_UNAVAILABLE', message: texte(c, 'ENCRYPTION_UNAVAILABLE') },
      requestId,
    }, 503);
  }
  const encrypted = await new EncryptionService(c.env.ENCRYPTION_KEY).encrypt(bytes);

  const key = `${producerDocumentPrefix(userId)}${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${extensionFor(contentType)}`;
  await c.env.STORAGE.put(key, encrypted, {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: {
      userId,
      uploadedAt: new Date().toISOString(),
      encrypted: 'aes-256-gcm',
      originalContentType: contentType,
    },
  });

  return c.json({ success: true, data: { key }, requestId }, 201);
});

const submitSchema = z.object({
  weightGrams: z.number().positive().max(1_000_000),
  purity: z.number().positive().max(1), // fraction 0..1 (e.g. 0.916 for 22K)
  goldType: z.enum(['nuggets', 'powder', 'bar']),
  originCountry: z.string().length(2).optional(),
  gps: z.object({ lat: z.number(), lng: z.number() }).optional(),
  /**
   * Whether `gps` came from a device fix. A hand-typed position is a
   * declaration, not evidence, and the two must not be conflated.
   */
  gpsVerified: z.boolean().optional(),
  /** Free-text mining zone, used when no device position is available. */
  originZone: z.string().max(150).optional(),
  photos: z.array(z.string().max(256)).max(20).optional(),
  estimatedValueXof: z.number().nonnegative().optional(),
});

// POST /producer/consignments — submit a new gold lot
producer.post('/consignments', zValidator('json', submitSchema), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const requestId = crypto.randomUUID();

  // A validated lot is paid in tokens, and BASIC accounts cannot sell tokens
  // (KYC_LIMITS). Refuse here rather than at the Dubai audit: at that point the
  // gold is already refined, and blocking would strand it with no way out.
  // An entity reaches STANDARD through the KYB (POST /producer/profile), an
  // individual through the ordinary KYC flow.
  const kyc = await c.env.DB
    .prepare('SELECT kyc_level FROM users WHERE id = ?')
    .bind(userId)
    .first<{ kyc_level: string }>();
  if (!kyc || kyc.kyc_level === 'BASIC') {
    return c.json({
      success: false,
      error: {
        code: 'KYC_LEVEL_INSUFFICIENT',
        message: texte(c, 'KYC_LEVEL_INSUFFICIENT', { operation: 'consignation' }),
      },
      requestId,
    }, 403);
  }

  // Photo keys come back from the client, so they are untrusted: only keys under
  // this producer's own prefix may be referenced.
  const badKey = (body.photos ?? []).find((k) => !isOwnedConsignmentPhotoKey(k, userId));
  if (badKey !== undefined) {
    return c.json({
      success: false,
      error: { code: 'INVALID_PHOTO_KEY', message: texte(c, 'INVALID_PHOTO_KEY') },
      requestId,
    }, 400);
  }

  const service = new ConsignmentService(c.env.DB);
  const consignment = await service.create({
    producerId: userId,
    weightDeclaredG: body.weightGrams,
    purityDeclared: body.purity,
    goldType: body.goldType,
    originCountry: body.originCountry,
    gps: body.gps ? { lat: body.gps.lat, lng: body.gps.lng } : null,
    gpsVerified: body.gpsVerified,
    originZone: body.originZone,
    photos: body.photos,
    estimatedValueXof: body.estimatedValueXof ?? null,
  });

  return c.json({ success: true, data: consignment, requestId }, 201);
});

// GET /producer/consignments — list own consignments
producer.get('/consignments', async (c) => {
  const userId = c.get('userId');
  const requestId = crypto.randomUUID();
  const page = Math.max(1, Math.floor(Number(c.req.query('page')) || 1));
  const limit = Math.min(50, Math.max(1, Math.floor(Number(c.req.query('limit')) || 20)));

  const service = new ConsignmentService(c.env.DB);
  const { items, total } = await service.listByProducer(userId, limit, (page - 1) * limit);

  return c.json({ success: true, data: { items, meta: { page, limit, total } }, requestId });
});

// GET /producer/consignments/:id — own consignment detail + event timeline
producer.get('/consignments/:id', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const requestId = crypto.randomUUID();

  const service = new ConsignmentService(c.env.DB);
  const consignment = await service.getById(id);
  if (!consignment || consignment.producer_id !== userId) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: texte(c, 'NOT_FOUND', { ressource: 'consignation' }) }, requestId }, 404);
  }
  const events = await service.listEvents(id);
  const docService = new ConsignmentDocumentService(c.env.DB);
  const documents = await docService.listForConsignment(id);
  const missingDocuments = await docService.missingRequired(id);
  return c.json({ success: true, data: { consignment, events, documents, missingDocuments }, requestId });
});

// GET /producer/consignments/:id/statement.pdf — settlement statement for the lot
//
// The document that answers the producer's only real question: I sent gold,
// what did I get and why. Served for any status, not only settled lots — a
// producer whose lot is still in transit is entitled to see where it stands.
producer.get('/consignments/:id/statement.pdf', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();

  const service = new ConsignmentService(c.env.DB);
  const consignment = await service.getById(id);
  if (!consignment || consignment.producer_id !== userId) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: texte(c, 'NOT_FOUND', { ressource: 'consignation' }) } }, 404);
  }

  const statements = new SettlementStatementService(
    c.env.DB,
    new ConfigService(c.env.DB, c.env.CACHE)
  );
  const pdf = await statements.pdfFor(id);
  if (!pdf) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: texte(c, 'NOT_FOUND', { ressource: 'consignation' }) } }, 404);
  }

  return new Response(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${statementFilename(consignment.reference)}"`,
    },
  });
});

// ============================================
// RÉPARTITION D'UN LOT — vendre / louer / stocker
// ============================================

const disposeSchema = z.object({
  sellG: z.number().min(0).max(1_000_000).default(0),
  leaseG: z.number().min(0).max(1_000_000).default(0),
  storeG: z.number().min(0).max(1_000_000).default(0),
});

// GET /producer/consignments/:id/disposition — ce qui est répartissable, et comment
producer.get('/consignments/:id/disposition', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();

  const service = new ConsignmentService(c.env.DB);
  const consignment = await service.getById(id);
  if (!consignment || consignment.producer_id !== userId) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: texte(c, 'NOT_FOUND', { ressource: 'consignation' }) } }, 404);
  }

  const dispositions = new DispositionService(c.env.DB);
  const existing = await dispositions.getByConsignment(id);
  const market = new MarketService(c.env.DB, c.env.CACHE, c.env.ENVIRONMENT);
  const price = await market.getCurrentPrice();

  const creditedG = consignment.producer_tokens_credited ?? 0;

  return c.json({
    success: true,
    data: {
      consignmentId: id,
      reference: consignment.reference,
      settled: consignment.status === 'AUDIT_VALIDATED',
      creditedG,
      sellPricePerGram: price?.sell_price ?? null,
      // La part gardée sera facturée : le dire avant le choix, pas après.
      storageNotice:
        "L'or laissé en stockage à Dubaï est conservé dans le coffre et facturé en frais de garde. L'or placé en location n'est pas facturé : il n'est pas en coffre et vous rémunère déjà.",
      disposition: existing,
    },
  });
});

// POST /producer/consignments/:id/disposition — répartir, éventuellement en trois
producer.post('/consignments/:id/disposition', zValidator('json', disposeSchema), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const split = c.req.valid('json');

  const service = new ConsignmentService(c.env.DB);
  const consignment = await service.getById(id);
  if (!consignment || consignment.producer_id !== userId) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: texte(c, 'NOT_FOUND', { ressource: 'consignation' }) } }, 404);
  }
  if (consignment.status !== 'AUDIT_VALIDATED') {
    return c.json({
      success: false,
      error: {
        code: 'NOT_SETTLED',
        message: texte(c, 'NOT_SETTLED'),
      },
    }, 400);
  }

  const config = new ConfigService(c.env.DB, c.env.CACHE);
  const market = new MarketService(c.env.DB, c.env.CACHE, c.env.ENVIRONMENT, config);
  const [price, leaseAnnualRate, leaseMinimumG] = await Promise.all([
    market.getCurrentPrice(),
    config.getNumber('lease_annual_rate', 0.06),
    config.getNumber('lease_min_grams', 1),
  ]);

  const dispositions = new DispositionService(c.env.DB);
  const result = await dispositions.dispose({
    consignmentId: id,
    userId,
    split: { sellG: split.sellG, leaseG: split.leaseG, storeG: split.storeG },
    creditedG: consignment.producer_tokens_credited ?? 0,
    // Prix de vente marché : le même spread que tout le monde, décision actée.
    sellPricePerGram: price?.sell_price ?? 0,
    leaseAnnualRate,
    leaseMinimumG,
  });

  if (!result.disposition) {
    const messages: Record<string, string> = {
      SPLIT_MISMATCH: 'La somme des trois parts doit couvrir exactement le lot',
      NEGATIVE_SHARE: 'Une part ne peut pas être négative',
      NOTHING_CREDITED: 'Aucun gramme crédité sur ce lot',
      ALREADY_DISPOSED: 'Ce lot a déjà été réparti',
      INSUFFICIENT_BALANCE: 'Solde en or insuffisant pour cette répartition',
      NO_PRICE: 'Prix indisponible : la vente est impossible pour le moment',
      NO_WALLET: 'Portefeuille introuvable',
    };
    const status = result.error === 'ALREADY_DISPOSED' ? 409 : 400;
    return c.json({
      success: false,
      error: {
        code: result.error,
        message: messages[result.error as string] || 'Répartition impossible',
      },
    }, status as 400 | 409);
  }

  const d = result.disposition;
  return c.json({
    success: true,
    data: {
      id: d.id,
      status: d.status,
      sellG: d.sell_g,
      leaseG: d.lease_g,
      storeG: d.store_g,
      sellProceedsXof: d.sell_proceeds_xof,
      leasePositionId: d.lease_position_id,
      // Une exécution partielle est dite, pas tue.
      failureReason: d.failure_reason,
    },
  }, d.status === 'EXECUTED' ? 201 : 200);
});

// GET /producer/storage-fees — ce qui est dû au titre de la garde
producer.get('/storage-fees', async (c) => {
  const userId = c.get('userId');
  const service = new StorageFeeService(c.env.DB);

  const [outstanding, totalXof] = await Promise.all([
    service.outstandingFor(userId),
    service.totalOutstandingXof(userId),
  ]);

  // Typé explicitement : sans cela `.all()` rend des Record<string, unknown>,
  // et le contrat ne pourrait rien vérifier de ce que la ligne contient.
  const recent = await c.env.DB.prepare(
    `SELECT accrual_date, stored_g, price_per_gram, amount_xof, status
     FROM storage_fee_accruals WHERE user_id = ?
     ORDER BY accrual_date DESC LIMIT 90`
  )
    .bind(userId)
    .all<{
      accrual_date: string;
      stored_g: number;
      price_per_gram: number;
      amount_xof: number;
      status: 'PAID' | 'OUTSTANDING';
    }>();

  return c.json({
    success: true,
    data: {
      outstandingCount: outstanding.length,
      outstandingXof: totalXof,
      // Jour par jour, pour que le total se recalcule au lieu d'être cru.
      accruals: recent.results || [],
      notice:
        "Les frais de garde sont prélevés sur votre solde espèces. Lorsqu'il est insuffisant, le frais reste dû et sera prélevé automatiquement dès que votre solde le permettra.",
    } satisfies StorageFeesData,
  });
});

// ============================================
// ORIGIN DOCUMENTS — what makes the route "certified"
// ============================================

// POST /producer/consignments/:id/documents/upload — encrypted upload, returns a key
producer.post('/consignments/:id/documents/upload', async (c) => {
  const userId = c.get('userId');
  const requestId = crypto.randomUUID();

  const service = new ConsignmentService(c.env.DB);
  const consignment = await service.getById(c.req.param('id'));
  if (!consignment || consignment.producer_id !== userId) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: texte(c, 'NOT_FOUND', { ressource: 'consignation' }) }, requestId }, 404);
  }

  const formData = await c.req.formData();
  const file = formData.get('file') as unknown as File;
  if (!file) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: texte(c, 'INVALID_INPUT') }, requestId }, 400);
  }

  const cfg = new ConfigService(c.env.DB, c.env.CACHE);
  const maxSize = await cfg.getNumber('consignment_max_document_bytes', 10 * 1024 * 1024);
  if (file.size > maxSize) {
    return c.json({ success: false, error: { code: 'FILE_TOO_LARGE', message: texte(c, 'FILE_TOO_LARGE', { maxMo: Math.round(maxSize / (1024 * 1024)) }) }, requestId }, 400);
  }

  const bytes = await file.arrayBuffer();
  const contentType = sniffDocumentType(bytes);
  if (!contentType) {
    return c.json({ success: false, error: { code: 'INVALID_FILE_TYPE', message: texte(c, 'INVALID_FILE_TYPE') }, requestId }, 400);
  }

  // Same fail-closed rule as KYC and KYB: an origin certificate is a legal
  // document, it does not land in R2 in the clear because a secret is missing.
  if (!c.env.ENCRYPTION_KEY) {
    console.error('Consignment document upload refused: ENCRYPTION_KEY is not configured');
    return c.json({
      success: false,
      error: { code: 'ENCRYPTION_UNAVAILABLE', message: texte(c, 'ENCRYPTION_UNAVAILABLE') },
      requestId,
    }, 503);
  }
  const encrypted = await new EncryptionService(c.env.ENCRYPTION_KEY).encrypt(bytes);

  const key = `${consignmentDocumentPrefix(userId)}${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${extensionFor(contentType)}`;
  await c.env.STORAGE.put(key, encrypted, {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: {
      userId,
      consignmentId: consignment.id,
      uploadedAt: new Date().toISOString(),
      encrypted: 'aes-256-gcm',
      originalContentType: contentType,
    },
  });

  return c.json({ success: true, data: { key }, requestId }, 201);
});

// POST /producer/consignments/:id/documents — attach an uploaded key with its metadata
producer.post('/consignments/:id/documents', async (c) => {
  const userId = c.get('userId');
  const requestId = crypto.randomUUID();

  const service = new ConsignmentService(c.env.DB);
  const consignment = await service.getById(c.req.param('id'));
  if (!consignment || consignment.producer_id !== userId) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: texte(c, 'NOT_FOUND', { ressource: 'consignation' }) }, requestId }, 404);
  }

  const parsed = attachDocumentSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({
      success: false,
      error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message || texte(c, 'INVALID_INPUT') },
      requestId,
    }, 400);
  }

  // The key comes back through the client, so it is untrusted like every other
  // R2 reference in this codebase.
  if (!isOwnedConsignmentDocumentKey(parsed.data.key, userId)) {
    return c.json({
      success: false,
      error: { code: 'INVALID_DOCUMENT_KEY', message: texte(c, 'INVALID_DOCUMENT_KEY') },
      requestId,
    }, 400);
  }

  const docService = new ConsignmentDocumentService(c.env.DB);
  const document = await docService.attach(consignment.id, userId, parsed.data);
  if (!document) {
    return c.json({
      success: false,
      error: { code: 'ALREADY_ATTACHED', message: texte(c, 'ALREADY_ATTACHED') },
      requestId,
    }, 409);
  }

  return c.json({ success: true, data: document, requestId }, 201);
});

// POST /producer/consignments/photos — upload a lot photo to R2, returns its key
producer.post('/consignments/photos', async (c) => {
  const userId = c.get('userId');
  const requestId = crypto.randomUUID();
  const formData = await c.req.formData();
  const file = formData.get('file') as unknown as File;

  if (!file) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: texte(c, 'INVALID_INPUT') }, requestId }, 400);
  }
  // Size is checked before reading the body into memory.
  const cfg = new ConfigService(c.env.DB, c.env.CACHE);
  const maxSize = await cfg.getNumber('consignment_max_photo_bytes', 8 * 1024 * 1024);
  if (file.size > maxSize) {
    return c.json({ success: false, error: { code: 'FILE_TOO_LARGE', message: texte(c, 'FILE_TOO_LARGE', { maxMo: Math.round(maxSize / (1024 * 1024)) }) }, requestId }, 400);
  }

  // The declared MIME type is a client-supplied header — trust the bytes instead.
  const bytes = await file.arrayBuffer();
  const contentType = sniffImageType(bytes);
  if (!contentType) {
    return c.json({ success: false, error: { code: 'INVALID_FILE_TYPE', message: texte(c, 'INVALID_FILE_TYPE') }, requestId }, 400);
  }

  const key = `${consignmentPhotoPrefix(userId)}${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${extensionFor(contentType)}`;
  await c.env.STORAGE.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: { userId, uploadedAt: new Date().toISOString() },
  });

  return c.json({ success: true, data: { key }, requestId }, 201);
});

// GET /producer/consignments/:id/photos/:idx — stream a photo the producer owns
producer.get('/consignments/:id/photos/:idx', async (c) => {
  const userId = c.get('userId');
  const { id, idx } = c.req.param();
  const service = new ConsignmentService(c.env.DB);
  const consignment = await service.getById(id);
  if (!consignment || consignment.producer_id !== userId) return c.notFound();
  return streamConsignmentPhoto(c, consignment, idx);
});

/**
 * Stream one photo of a consignment. Shared with the admin routes.
 *
 * The key is re-checked against the consignment's own producer prefix on every
 * read: rows predating the submission-time validation may still hold a foreign
 * key, and this endpoint must never become a way to read the rest of the bucket
 * (KYC documents live in the same one).
 */
export async function streamConsignmentPhoto(
  c: any,
  consignment: { producer_id: string; photos: string | null },
  idx: string
): Promise<Response> {
  let keys: unknown[] = [];
  try {
    const parsed = consignment.photos ? JSON.parse(consignment.photos) : [];
    keys = Array.isArray(parsed) ? parsed : [];
  } catch { keys = []; }
  const key = keys[Number(idx)];
  if (!isOwnedConsignmentPhotoKey(key, consignment.producer_id)) return c.notFound();
  const obj = await c.env.STORAGE.get(key);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'private, max-age=300',
    },
  });
}

export const producerRoutes = producer;
