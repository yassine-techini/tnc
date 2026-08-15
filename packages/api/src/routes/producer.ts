/**
 * Producer routes — gold consignment submission and tracking.
 * Authenticated users whose `role` is 'producer'.
 */
import { Hono, Context, Next } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types/env';
import { authMiddleware } from '../middleware/auth';
import { ConsignmentService } from '../services/consignment.service';
import { ConfigService } from '../services/config.service';

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
      error: { code: 'NOT_A_PRODUCER', message: 'Accès réservé aux producteurs' },
      requestId: crypto.randomUUID(),
    }, 403);
  }
  return next();
}
producer.use('/*', requireProducer);

const submitSchema = z.object({
  weightGrams: z.number().positive().max(1_000_000),
  purity: z.number().positive().max(1), // fraction 0..1 (e.g. 0.916 for 22K)
  goldType: z.enum(['nuggets', 'powder', 'bar']),
  originCountry: z.string().length(2).optional(),
  gps: z.object({ lat: z.number(), lng: z.number() }).optional(),
  photos: z.array(z.string().max(256)).max(20).optional(),
  estimatedValueXof: z.number().nonnegative().optional(),
});

// POST /producer/consignments — submit a new gold lot
producer.post('/consignments', zValidator('json', submitSchema), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const requestId = crypto.randomUUID();

  const service = new ConsignmentService(c.env.DB);
  const consignment = await service.create({
    producerId: userId,
    weightDeclaredG: body.weightGrams,
    purityDeclared: body.purity,
    goldType: body.goldType,
    originCountry: body.originCountry,
    gps: body.gps ? { lat: body.gps.lat, lng: body.gps.lng } : null,
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
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Lot non trouvé' }, requestId }, 404);
  }
  const events = await service.listEvents(id);
  return c.json({ success: true, data: { consignment, events }, requestId });
});

// POST /producer/consignments/photos — upload a lot photo to R2, returns its key
producer.post('/consignments/photos', async (c) => {
  const userId = c.get('userId');
  const requestId = crypto.randomUUID();
  const formData = await c.req.formData();
  const file = formData.get('file') as unknown as File;

  if (!file) {
    return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'Fichier requis' }, requestId }, 400);
  }
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) {
    return c.json({ success: false, error: { code: 'INVALID_FILE_TYPE', message: 'Format non supporté (JPEG, PNG, WebP)' }, requestId }, 400);
  }
  const cfg = new ConfigService(c.env.DB, c.env.CACHE);
  const maxSize = await cfg.getNumber('consignment_max_photo_bytes', 8 * 1024 * 1024);
  if (file.size > maxSize) {
    return c.json({ success: false, error: { code: 'FILE_TOO_LARGE', message: `Fichier trop volumineux (max ${Math.round(maxSize / (1024 * 1024))} Mo)` }, requestId }, 400);
  }

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const key = `consignments/${userId}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
  await c.env.STORAGE.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
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
  return streamConsignmentPhoto(c, consignment.photos, idx);
});

export async function streamConsignmentPhoto(c: any, photosJson: string | null, idx: string): Promise<Response> {
  let keys: string[] = [];
  try { keys = photosJson ? JSON.parse(photosJson) : []; } catch { keys = []; }
  const key = keys[Number(idx)];
  if (!key) return c.notFound();
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
