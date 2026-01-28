import { Hono } from 'hono';
import type { AppEnv } from '../types/env';
import { CertificateService } from '../services/certificate.service';

const verify = new Hono<AppEnv>();

// GET /verify/:code — Public endpoint (no auth required)
verify.get('/:code', async (c) => {
  const { code } = c.req.param();
  const requestId = crypto.randomUUID();

  if (!code || code.trim().length < 6) {
    return c.json({
      success: false,
      error: {
        code: 'INVALID_CODE',
        message: 'Code de vérification invalide',
      },
      requestId,
    }, 400);
  }

  const certificateService = new CertificateService(c.env.DB, c.env.STORAGE, c.env.CACHE);
  const result = await certificateService.verifyCertificate(code);

  if (!result.valid) {
    return c.json({
      success: false,
      error: {
        code: 'CERTIFICATE_INVALID',
        message: result.reason || 'Certificat non trouvé',
      },
      requestId,
    }, 404);
  }

  return c.json({
    success: true,
    data: result.certificate,
    requestId,
  });
});

export const verifyRoutes = verify;
