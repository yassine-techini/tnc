import { Hono, type Context } from 'hono';
// Contrats partages : `satisfies` fait echouer la compilation si la forme
// emise s ecarte de ce que les clients importent.
import type {
  UserProfileData,
  KycStatusData,
  KycSubmitData,
  NotificationPreferencesData,
  PriceAlertsData,
  NotificationsData,
} from '@tnc-trading/shared/contracts';
import type { PasswordChangedData } from '@tnc-trading/shared/contracts';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { phoneSchema } from '@tnc-trading/shared/validators';
import type { AppEnv } from '../types/env';
import { authMiddleware } from '../middleware/auth';
import { KycService } from '../services/kyc.service';
import { CountryConfigService } from '../services/country-config.service';
import { AccountClosureService, type MotifRefus } from '../services/account-closure.service';
import { AuthService } from '../services/auth.service';
import { SecurityService, SECURITY_CONFIG } from '../services/security.service';
import { NotificationService } from '../services/notification.service';
import { EncryptionService } from '../services/encryption.service';
import { ConfigService } from '../services/config.service';
import { sniffImageType, extensionFor } from '../lib/image-upload';
import { PushTokenService } from '../services/push-token.service';
import { messageValidation, texte } from '../lib/reponse-erreur';
import { surErreurDeValidation } from '../lib/validation-hook';

const users = new Hono<AppEnv>();

/**
 * Met en mots un obstacle a la fermeture de compte (ADR 015, ADR 026).
 *
 * Le service nomme l'obstacle et compte ce qu'il y a a compter ; c'est ici,
 * dans la requete, qu'on connait la langue du titulaire. Le `switch` est
 * explicite plutot que generique : chaque motif a ses propres chiffres, et un
 * rendu generique les aurait perdus.
 */
function messageObstacle(
  c: Context<AppEnv>,
  code: MotifRefus,
  details: Record<string, unknown> | undefined
): string {
  const d = details ?? {};
  switch (code) {
    case 'LEASE_POSITION_OPEN':
      return texte(c, 'LEASE_POSITION_OPEN', {
        positions: Number(d.positions),
        grammesG: Number(d.grammesG),
      });
    case 'CONSIGNMENT_IN_PROGRESS':
      return texte(c, 'CONSIGNMENT_IN_PROGRESS', { lots: Number(d.lots) });
    case 'STORAGE_FEES_OUTSTANDING':
      return texte(c, 'STORAGE_FEES_OUTSTANDING', { montantXof: Number(d.montantXof) });
    default:
      return texte(c, code as 'BALANCE_NOT_ZERO' | 'PENDING_TRANSACTIONS' | 'STORAGE_DELETE_FAILED');
  }
}

// All routes require authentication
users.use('/*', authMiddleware);

// GET /users/me
users.get('/me', async (c) => {
  const userId = c.get('userId');

  try {
    const user = await c.env.DB
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(userId)
      .first<any>();

    if (!user) {
      return c.json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: texte(c, 'USER_NOT_FOUND'),
        },
        requestId: crypto.randomUUID(),
      }, 404);
    }

    // Get wallet
    const wallet = await c.env.DB
      .prepare('SELECT * FROM wallets WHERE user_id = ?')
      .bind(userId)
      .first<any>();

    return c.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        country: user.country,
        kycLevel: user.kyc_level,
        kycStatus: user.kyc_status,
        role: user.role || 'investor',
        emailVerified: Boolean(user.email_verified),
        phoneVerified: Boolean(user.phone_verified),
        twoFactorEnabled: Boolean(user.two_factor_enabled),
        createdAt: user.created_at,
        wallet: wallet ? {
          tokenBalance: wallet.token_balance,
          cashBalance: wallet.cash_balance,
          totalBought: wallet.total_bought,
          totalSpent: wallet.total_spent,
        } : null,
      } satisfies UserProfileData,
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('Get user error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// SECURITY: Validation schema for profile updates
const updateProfileSchema = z.object({
  /**
   * MEME regle que l'inscription, partagee (ADR 021).
   *
   * La regle etait `/^\+226\d{8}$/` alors que l'inscription accepte tout numero
   * international : un raffineur ougandais s'inscrivait sans peine, puis ne
   * pouvait plus jamais corriger son numero.
   */
  phone: phoneSchema.optional(),
  country: z.string().length(2).optional(),
}).refine(
  (data) => data.phone || data.country,
  { message: 'CHAMP_AU_MOINS_UN' }
);

// PATCH /users/me
users.patch('/me', zValidator('json', updateProfileSchema, surErreurDeValidation), async (c) => {
  const userId = c.get('userId');

  try {
    const body = c.req.valid('json');
    const { phone, country } = body;

    const updates: string[] = [];
    const values: any[] = [];

    if (phone) {
      updates.push('phone = ?');
      values.push(phone);
    }
    if (country) {
      updates.push('country = ?');
      values.push(country);
    }

    updates.push("updated_at = datetime('now')");
    values.push(userId);

    await c.env.DB
      .prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    return c.json({
      success: true,
      message: 'Profil mis à jour',
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('Update user error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// SECURITY: Comprehensive validation schema for KYC submission
const kycSubmitSchema = z.object({
  /**
   * La FORME seulement. La liste des pieces acceptees appartient au pays
   * (`country_config.id_document_types`) et est verifiee dans le gestionnaire,
   * la ou le pays de l'utilisateur est connu (ADR 018).
   *
   * L'enumeration figee ici — CNIB, PASSPORT, PERMIT, CEDEAO — etait celle d'un
   * seul pays : elle refusait la CNI ivoirienne comme la carte nationale
   * ougandaise, alors que `country_config` les declare.
   */
  documentType: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'TYPE_DOCUMENT_FORME'),
  documentNumber: z.string().min(1).max(30).optional(),
  firstName: z.string()
    .min(1)
    .max(50)
    .regex(/^[a-zA-ZÀ-ÿ\s'-]+$/, 'NOM_CARACTERES'),
  lastName: z.string()
    .min(1)
    .max(50)
    .regex(/^[a-zA-ZÀ-ÿ\s'-]+$/, 'NOM_CARACTERES'),
  dateOfBirth: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'DATE_ISO'),
  nationality: z.string().length(2),
  address: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  documentExpiryDate: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'DATE_ISO')
    .optional(),
});

// POST /users/me/kyc - Submit KYC application
users.post('/me/kyc', zValidator('json', kycSubmitSchema, surErreurDeValidation), async (c) => {
  const userId = c.get('userId');

  try {
    const body = c.req.valid('json');
    const {
      documentType,
      documentNumber,
      firstName,
      lastName,
      dateOfBirth,
      nationality,
      address,
      city,
      documentExpiryDate,
    } = body;

    // Le pays decide de ses pieces d'identite (ADR 018). Refuser en NOMMANT les
    // documents acceptes : « Type de document invalide » n'apprend rien a
    // quelqu'un qui tient sa carte nationale a la main.
    const titulaire = await c.env.DB
      .prepare('SELECT country FROM users WHERE id = ?')
      .bind(userId)
      .first<{ country: string | null }>();
    const pays = await new CountryConfigService(c.env.DB).forUser(titulaire?.country);

    if (!pays.idDocumentTypes.includes(documentType)) {
      return c.json({
        success: false,
        error: {
          code: 'KYC_DOCUMENT_TYPE_UNSUPPORTED',
          message: texte(c, 'KYC_DOCUMENT_TYPE_UNSUPPORTED', { pays: pays.name, acceptes: pays.idDocumentTypes }),
          details: { accepted: pays.idDocumentTypes, country: pays.code },
        },
        requestId: crypto.randomUUID(),
      }, 400);
    }

    // Check if user already has a pending or verified KYC
    const existingKyc = await c.env.DB
      .prepare("SELECT id, status FROM kyc_documents WHERE user_id = ? AND status IN ('SUBMITTED', 'PROCESSING', 'VERIFIED') ORDER BY created_at DESC LIMIT 1")
      .bind(userId)
      .first<any>();

    if (existingKyc) {
      if (existingKyc.status === 'VERIFIED') {
        return c.json({
          success: false,
          error: {
            code: 'KYC_ALREADY_VERIFIED',
            message: texte(c, 'KYC_ALREADY_VERIFIED'),
          },
          requestId: crypto.randomUUID(),
        }, 400);
      }
      return c.json({
        success: false,
        error: {
          code: 'KYC_PENDING',
          message: texte(c, 'KYC_PENDING'),
        },
        requestId: crypto.randomUUID(),
      }, 400);
    }

    // Check if documents have been uploaded
    const pendingDocs = await c.env.DB
      .prepare("SELECT id FROM kyc_documents WHERE user_id = ? AND status = 'SUBMITTED' AND front_image_url IS NOT NULL AND selfie_url IS NOT NULL")
      .bind(userId)
      .first();

    if (!pendingDocs) {
      return c.json({
        success: false,
        error: {
          code: 'DOCUMENTS_REQUIRED',
          message: texte(c, 'DOCUMENTS_REQUIRED'),
        },
        requestId: crypto.randomUUID(),
      }, 400);
    }

    // Update the existing KYC document with personal information
    await c.env.DB
      .prepare(`
        UPDATE kyc_documents
        SET document_type = ?, document_number = ?, first_name = ?, last_name = ?,
            date_of_birth = ?, nationality = ?, address = ?, city = ?,
            document_expiry_date = ?, updated_at = datetime('now')
        WHERE id = ?
      `)
      .bind(
        documentType,
        documentNumber || null,
        firstName,
        lastName,
        dateOfBirth,
        nationality,
        address || null,
        city || null,
        documentExpiryDate || null,
        pendingDocs.id
      )
      .run();

    // Update user KYC status
    await c.env.DB
      .prepare("UPDATE users SET kyc_status = 'SUBMITTED', updated_at = datetime('now') WHERE id = ?")
      .bind(userId)
      .run();

    // Automatically initiate KYC verification with Smile Identity
    let verificationJobId: string | undefined;
    try {
      const configService = new ConfigService(c.env.DB, c.env.CACHE);
      const apiUrl = await configService.get('api_url', 'https://api.tnc-trading.com');
      const kycService = new KycService(c.env.DB, c.env.STORAGE, {
        apiKey: c.env.SMILE_IDENTITY_API_KEY,
        partnerId: c.env.SMILE_IDENTITY_PARTNER_ID,
        environment: c.env.ENVIRONMENT === 'production' ? 'production' : 'sandbox',
        callbackUrl: `${apiUrl}/api/v1/webhooks/kyc`,
      });

      const verificationResult = await kycService.initiateVerification(pendingDocs.id as string);
      if (verificationResult.success) {
        verificationJobId = verificationResult.jobId;
      }
    } catch (kycError) {
      console.error('KYC verification initiation failed:', kycError);
      // Don't fail the entire request - manual verification can still happen
    }

    return c.json({
      success: true,
      message: 'Demande KYC soumise avec succès',
      data: {
        kycId: pendingDocs.id,
        status: 'SUBMITTED',
        verificationJobId,
        verificationStarted: !!verificationJobId,
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('Submit KYC error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// GET /users/me/kyc/status
users.get('/me/kyc/status', async (c) => {
  const userId = c.get('userId');

  try {
    const user = await c.env.DB
      .prepare('SELECT kyc_level, kyc_status FROM users WHERE id = ?')
      .bind(userId)
      .first<any>();

    const kycDoc = await c.env.DB
      .prepare('SELECT * FROM kyc_documents WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
      .bind(userId)
      .first<any>();

    return c.json({
      success: true,
      data: {
        level: user?.kyc_level || 'BASIC',
        status: user?.kyc_status || 'PENDING',
        document: kycDoc ? {
          id: kycDoc.id,
          documentType: kycDoc.document_type,
          status: kycDoc.status,
          rejectionReason: kycDoc.rejection_reason,
          submittedAt: kycDoc.created_at,
          reviewedAt: kycDoc.reviewed_at,
        } : null,
      } satisfies KycStatusData,
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('Get KYC status error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// POST /users/me/kyc/resubmit - Resubmit rejected KYC
users.post('/me/kyc/resubmit', async (c) => {
  const userId = c.get('userId');
  const requestId = crypto.randomUUID();

  try {
    // Check current KYC status
    const user = await c.env.DB
      .prepare('SELECT kyc_status, kyc_level FROM users WHERE id = ?')
      .bind(userId)
      .first<any>();

    if (!user) {
      return c.json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: texte(c, 'USER_NOT_FOUND') },
        requestId,
      }, 404);
    }

    // Only allow resubmission if KYC was rejected
    if (user.kyc_status !== 'REJECTED') {
      if (user.kyc_status === 'APPROVED') {
        return c.json({
          success: false,
          error: { code: 'KYC_ALREADY_APPROVED', message: texte(c, 'KYC_ALREADY_APPROVED') },
          requestId,
        }, 400);
      }
      if (['SUBMITTED', 'PENDING'].includes(user.kyc_status)) {
        return c.json({
          success: false,
          error: { code: 'KYC_ALREADY_PENDING', message: texte(c, 'KYC_ALREADY_PENDING') },
          requestId,
        }, 400);
      }
    }

    // Get the rejected KYC document
    const rejectedKyc = await c.env.DB
      .prepare(`
        SELECT * FROM kyc_documents
        WHERE user_id = ? AND status = 'REJECTED'
        ORDER BY created_at DESC LIMIT 1
      `)
      .bind(userId)
      .first<any>();

    // Reset user KYC status to allow new submission
    await c.env.DB
      .prepare(`
        UPDATE users
        SET kyc_status = 'PENDING', updated_at = datetime('now')
        WHERE id = ?
      `)
      .bind(userId)
      .run();

    // Create a new KYC document entry for resubmission
    const newKycId = crypto.randomUUID();
    await c.env.DB
      .prepare(`
        INSERT INTO kyc_documents (id, user_id, document_type, first_name, last_name, date_of_birth, nationality, status, created_at, updated_at)
        VALUES (?, ?, 'CNIB', '', '', '', 'BF', 'SUBMITTED', datetime('now'), datetime('now'))
      `)
      .bind(newKycId, userId)
      .run();

    return c.json({
      success: true,
      data: {
        message: 'Vous pouvez maintenant soumettre de nouveaux documents KYC',
        kycId: newKycId,
        previousRejectionReason: rejectedKyc?.rejection_reason || null,
        nextSteps: [
          'Téléchargez la photo recto de votre document',
          'Téléchargez la photo verso de votre document (si applicable)',
          'Téléchargez un selfie avec votre document',
          'Soumettez vos informations personnelles',
        ],
      },
      requestId,
    });
  } catch (error) {
    console.error('KYC resubmit error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: texte(c, 'INTERNAL_ERROR') },
      requestId,
    }, 500);
  }
});

// GET /users/me/kyc/history - Get KYC submission history
users.get('/me/kyc/history', async (c) => {
  const userId = c.get('userId');
  const requestId = crypto.randomUUID();

  try {
    const kycHistory = await c.env.DB
      .prepare(`
        SELECT id, document_type, status, rejection_reason, created_at, updated_at, reviewed_at
        FROM kyc_documents
        WHERE user_id = ?
        ORDER BY created_at DESC
      `)
      .bind(userId)
      .all<any>();

    return c.json({
      success: true,
      data: {
        items: kycHistory.results?.map(k => ({
          id: k.id,
          documentType: k.document_type,
          status: k.status,
          rejectionReason: k.rejection_reason,
          createdAt: k.created_at,
          updatedAt: k.updated_at,
          reviewedAt: k.reviewed_at,
        })) || [],
        total: kycHistory.results?.length || 0,
      },
      requestId,
    });
  } catch (error) {
    console.error('KYC history error:', error);
    return c.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: texte(c, 'INTERNAL_ERROR') },
      requestId,
    }, 500);
  }
});

// POST /users/me/kyc/documents - Upload KYC document to R2
users.post('/me/kyc/documents', async (c) => {
  const userId = c.get('userId');

  try {
    const formData = await c.req.formData();
    const documentType = formData.get('type') as string; // 'front', 'back', 'selfie'
    const file = formData.get('file') as unknown as File;

    if (!documentType || !file) {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: texte(c, 'INVALID_INPUT'),
        },
        requestId: crypto.randomUUID(),
      }, 400);
    }

    if (!['front', 'back', 'selfie'].includes(documentType)) {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_DOCUMENT_TYPE',
          message: texte(c, 'INVALID_DOCUMENT_TYPE'),
        },
        requestId: crypto.randomUUID(),
      }, 400);
    }

    // Validate file size (configurable, default 5MB) before reading the body.
    const kycConfigService = new ConfigService(c.env.DB, c.env.CACHE);
    const maxFileSize = await kycConfigService.getNumber('kyc_max_file_size_bytes', 5 * 1024 * 1024);
    if (file.size > maxFileSize) {
      const maxMb = Math.round(maxFileSize / (1024 * 1024));
      return c.json({
        success: false,
        error: {
          code: 'FILE_TOO_LARGE',
          message: texte(c, 'FILE_TOO_LARGE', { maxMo: maxMb }),
        },
        requestId: crypto.randomUUID(),
      }, 400);
    }

    // The declared MIME type is a client-supplied header — trust the bytes instead.
    const arrayBuffer = await file.arrayBuffer();
    const contentType = sniffImageType(arrayBuffer);
    if (!contentType) {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_FILE_TYPE',
          message: texte(c, 'INVALID_FILE_TYPE'),
        },
        requestId: crypto.randomUUID(),
      }, 400);
    }

    // Fail closed: an identity document must never land in R2 in the clear
    // because a secret happens to be missing.
    if (!c.env.ENCRYPTION_KEY) {
      console.error('KYC upload refused: ENCRYPTION_KEY is not configured');
      return c.json({
        success: false,
        error: {
          code: 'ENCRYPTION_UNAVAILABLE',
          message: texte(c, 'ENCRYPTION_UNAVAILABLE'),
        },
        requestId: crypto.randomUUID(),
      }, 503);
    }

    const filename = `kyc/${userId}/${documentType}_${Date.now()}.${extensionFor(contentType)}`;
    const encryptionService = new EncryptionService(c.env.ENCRYPTION_KEY);
    const uploadData = await encryptionService.encrypt(arrayBuffer);

    await c.env.STORAGE.put(filename, uploadData, {
      httpMetadata: {
        contentType: 'application/octet-stream',
      },
      customMetadata: {
        userId,
        documentType,
        uploadedAt: new Date().toISOString(),
        encrypted: 'aes-256-gcm',
        originalContentType: contentType,
      },
    });

    // Get or create KYC document record
    let kycDoc = await c.env.DB
      .prepare("SELECT id FROM kyc_documents WHERE user_id = ? AND status = 'SUBMITTED' ORDER BY created_at DESC LIMIT 1")
      .bind(userId)
      .first<{ id: string }>();

    if (!kycDoc) {
      // Create new KYC document record
      const kycId = crypto.randomUUID();
      const columns = ['id', 'user_id', 'document_type', 'first_name', 'last_name', 'date_of_birth', 'nationality'];
      const values = [kycId, userId, 'CNIB', '', '', '', 'BF']; // Placeholder values

      if (documentType === 'front') {
        columns.push('front_image_url');
        values.push(filename);
      } else if (documentType === 'back') {
        columns.push('back_image_url');
        values.push(filename);
      } else if (documentType === 'selfie') {
        columns.push('selfie_url');
        values.push(filename);
      }

      await c.env.DB
        .prepare(`INSERT INTO kyc_documents (${columns.join(', ')}, created_at, updated_at) VALUES (${columns.map(() => '?').join(', ')}, datetime('now'), datetime('now'))`)
        .bind(...values)
        .run();

      kycDoc = { id: kycId };
    } else {
      // Update existing KYC document record
      const updateField = documentType === 'front' ? 'front_image_url'
        : documentType === 'back' ? 'back_image_url'
        : 'selfie_url';

      await c.env.DB
        .prepare(`UPDATE kyc_documents SET ${updateField} = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(filename, kycDoc.id)
        .run();
    }

    return c.json({
      success: true,
      data: {
        documentId: kycDoc.id,
        type: documentType,
        filename,
        message: 'Document téléchargé avec succès',
      },
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('Upload document error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// GET /users/me/notifications
users.get('/me/notifications', async (c) => {
  const userId = c.get('userId');

  try {
    // SECURITY: Validate pagination parameters with bounds
    const configService = new ConfigService(c.env.DB, c.env.CACHE);
    const maxLimit = await configService.getNumber('pagination_max_limit', 100);
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '20', 10) || 20), maxLimit);
    const offset = (page - 1) * limit;

    const notifications = await c.env.DB
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .bind(userId, limit, offset)
      .all<any>();

    const totalResult = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ?')
      .bind(userId)
      .first<{ count: number }>();

    const unreadResult = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0')
      .bind(userId)
      .first<{ count: number }>();

    // SECURITY: Safe JSON parsing for notification data
    const safeParseJson = (data: string | null): unknown => {
      if (!data) return null;
      try {
        return JSON.parse(data);
      } catch {
        return null;
      }
    };

    return c.json({
      success: true,
      data: {
        items: notifications.results?.map((n: any) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          data: safeParseJson(n.data),
          read: Boolean(n.read),
          createdAt: n.created_at,
        })) || [],
        total: totalResult?.count || 0,
        unread: unreadResult?.count || 0,
        page,
        limit,
      } satisfies NotificationsData,
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// PATCH /users/me/notifications/:id/read
users.patch('/me/notifications/:id/read', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const requestId = crypto.randomUUID();

  try {
    const result = await c.env.DB
      .prepare("UPDATE notifications SET read = 1, read_at = datetime('now') WHERE id = ? AND user_id = ?")
      .bind(id, userId)
      .run();

    // SECURITY: Check if notification was actually found and updated
    if (!result.meta.changes || result.meta.changes === 0) {
      return c.json({
        success: false,
        error: {
          code: 'NOTIFICATION_NOT_FOUND',
          message: texte(c, 'NOTIFICATION_NOT_FOUND'),
        },
        requestId,
      }, 404);
    }

    return c.json({
      success: true,
      message: 'Notification marquée comme lue',
      requestId,
    });
  } catch (error) {
    console.error('Mark notification read error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId,
    }, 500);
  }
});

// POST /users/me/notifications/read-all
users.post('/me/notifications/read-all', async (c) => {
  const userId = c.get('userId');

  try {
    await c.env.DB
      .prepare("UPDATE notifications SET read = 1, read_at = datetime('now') WHERE user_id = ? AND read = 0")
      .bind(userId)
      .run();

    return c.json({
      success: true,
      message: 'Toutes les notifications marquées comme lues',
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId: crypto.randomUUID(),
    }, 500);
  }
});

// ============================================
// NOTIFICATION PREFERENCES
// ============================================

// GET /users/me/preferences/notifications - Get notification preferences
users.get('/me/preferences/notifications', async (c) => {
  const userId = c.get('userId');
  const requestId = crypto.randomUUID();

  try {
    // Try to get existing preferences
    let prefs = await c.env.DB
      .prepare('SELECT * FROM notification_preferences WHERE user_id = ?')
      .bind(userId)
      .first<any>();

    // If no preferences exist, create defaults
    if (!prefs) {
      const defaultPrefs = {
        email: true,
        sms: true,
        priceAlerts: false,
        transactionAlerts: true,
        marketingEmails: false,
      };

      await c.env.DB
        .prepare(`
          INSERT INTO notification_preferences (id, user_id, email, sms, price_alerts, transaction_alerts, marketing_emails, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `)
        .bind(
          crypto.randomUUID(),
          userId,
          defaultPrefs.email ? 1 : 0,
          defaultPrefs.sms ? 1 : 0,
          defaultPrefs.priceAlerts ? 1 : 0,
          defaultPrefs.transactionAlerts ? 1 : 0,
          defaultPrefs.marketingEmails ? 1 : 0
        )
        .run();

      return c.json({
        success: true,
        data: defaultPrefs,
        requestId,
      });
    }

    return c.json({
      success: true,
      data: {
        email: Boolean(prefs.email),
        sms: Boolean(prefs.sms),
        priceAlerts: Boolean(prefs.price_alerts),
        transactionAlerts: Boolean(prefs.transaction_alerts),
        marketingEmails: Boolean(prefs.marketing_emails),
      } satisfies NotificationPreferencesData,
      requestId,
    });
  } catch (error) {
    console.error('Get notification preferences error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId,
    }, 500);
  }
});

// PATCH /users/me/preferences/notifications - Update notification preferences
users.patch('/me/preferences/notifications', async (c) => {
  const userId = c.get('userId');
  const requestId = crypto.randomUUID();

  try {
    const body = await c.req.json();
    const { email, sms, priceAlerts, transactionAlerts, marketingEmails } = body;

    // Ensure user has preferences record
    let prefs = await c.env.DB
      .prepare('SELECT id FROM notification_preferences WHERE user_id = ?')
      .bind(userId)
      .first<{ id: string }>();

    if (!prefs) {
      // Create new preferences
      const prefsId = crypto.randomUUID();
      await c.env.DB
        .prepare(`
          INSERT INTO notification_preferences (id, user_id, email, sms, price_alerts, transaction_alerts, marketing_emails, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `)
        .bind(
          prefsId,
          userId,
          email !== undefined ? (email ? 1 : 0) : 1,
          sms !== undefined ? (sms ? 1 : 0) : 1,
          priceAlerts !== undefined ? (priceAlerts ? 1 : 0) : 0,
          transactionAlerts !== undefined ? (transactionAlerts ? 1 : 0) : 1,
          marketingEmails !== undefined ? (marketingEmails ? 1 : 0) : 0
        )
        .run();

      prefs = { id: prefsId };
    } else {
      // Build update query dynamically
      const updates: string[] = [];
      const values: any[] = [];

      if (email !== undefined) {
        updates.push('email = ?');
        values.push(email ? 1 : 0);
      }
      if (sms !== undefined) {
        updates.push('sms = ?');
        values.push(sms ? 1 : 0);
      }
      if (priceAlerts !== undefined) {
        updates.push('price_alerts = ?');
        values.push(priceAlerts ? 1 : 0);
      }
      if (transactionAlerts !== undefined) {
        updates.push('transaction_alerts = ?');
        values.push(transactionAlerts ? 1 : 0);
      }
      if (marketingEmails !== undefined) {
        updates.push('marketing_emails = ?');
        values.push(marketingEmails ? 1 : 0);
      }

      if (updates.length > 0) {
        updates.push("updated_at = datetime('now')");
        values.push(prefs.id);

        await c.env.DB
          .prepare(`UPDATE notification_preferences SET ${updates.join(', ')} WHERE id = ?`)
          .bind(...values)
          .run();
      }
    }

    // Return updated preferences
    const updatedPrefs = await c.env.DB
      .prepare('SELECT * FROM notification_preferences WHERE user_id = ?')
      .bind(userId)
      .first<any>();

    return c.json({
      success: true,
      data: {
        email: Boolean(updatedPrefs?.email),
        sms: Boolean(updatedPrefs?.sms),
        priceAlerts: Boolean(updatedPrefs?.price_alerts),
        transactionAlerts: Boolean(updatedPrefs?.transaction_alerts),
        marketingEmails: Boolean(updatedPrefs?.marketing_emails),
      },
      requestId,
    });
  } catch (error) {
    console.error('Update notification preferences error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId,
    }, 500);
  }
});

// Password change validation schema
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(SECURITY_CONFIG.PASSWORD_MIN_LENGTH)
    .max(SECURITY_CONFIG.PASSWORD_MAX_LENGTH),
  confirmPassword: z.string().min(1),
}).refine(data => data.newPassword === data.confirmPassword, {
  message: 'MDP_CONFIRMATION',
  path: ['confirmPassword'],
});

// POST /users/me/password - Change user password
users.post('/me/password', zValidator('json', changePasswordSchema, surErreurDeValidation), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const requestId = crypto.randomUUID();
  const ipAddress = c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown';

  try {
    const authService = new AuthService(c.env.JWT_SECRET);
    const securityService = new SecurityService(c.env.DB, c.env.CACHE);

    // Get current user
    const user = await c.env.DB
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(userId)
      .first<any>();

    if (!user) {
      return c.json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: texte(c, 'USER_NOT_FOUND'),
        },
        requestId,
      }, 404);
    }

    // Verify current password
    const passwordResult = await authService.verifyPasswordWithRehashCheck(body.currentPassword, user.password_hash);
    if (!passwordResult.valid) {
      await securityService.logSecurityEvent({
        userId,
        action: 'PASSWORD_CHANGE_FAILED',
        identifier: user.email,
        ipAddress,
        riskLevel: 'medium',
        details: { reason: 'Invalid current password' },
      });

      return c.json({
        success: false,
        error: {
          code: 'INVALID_CURRENT_PASSWORD',
          message: texte(c, 'INVALID_CURRENT_PASSWORD'),
        },
        requestId,
      }, 401);
    }
    // Note: No need to rehash here - new password will be hashed with Argon2id

    // Validate new password strength
    const passwordValidation = securityService.validatePassword(body.newPassword);
    if (!passwordValidation.valid) {
      return c.json({
        success: false,
        error: {
          code: 'WEAK_PASSWORD',
          message: texte(c, 'WEAK_PASSWORD'),
          details: passwordValidation.errors,
        },
        requestId,
      }, 400);
    }

    // Hash new password
    const newPasswordHash = await authService.hashPassword(body.newPassword);

    // Check password history (verify plaintext against salted stored hashes)
    const isNewPassword = await securityService.checkPasswordHistory(
      userId,
      body.newPassword,
      (plain, hash) => authService.verifyPassword(plain, hash),
      5
    );
    if (!isNewPassword) {
      return c.json({
        success: false,
        error: {
          code: 'PASSWORD_RECENTLY_USED',
          message: texte(c, 'PASSWORD_RECENTLY_USED'),
        },
        requestId,
      }, 400);
    }

    // Update password
    await c.env.DB
      .prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(newPasswordHash, userId)
      .run();

    // Add to password history
    await securityService.addPasswordToHistory(userId, newPasswordHash);

    // SECURITY: Invalidate ALL sessions and refresh tokens after password change
    await Promise.all([
      c.env.DB
        .prepare('DELETE FROM active_sessions WHERE user_id = ?')
        .bind(userId)
        .run(),
      c.env.DB
        .prepare('DELETE FROM sessions WHERE user_id = ?')
        .bind(userId)
        .run(),
    ]);

    // Log the password change
    await securityService.logAuditEvent({
      userId,
      action: 'PASSWORD_CHANGED',
      entityType: 'user',
      entityId: userId,
      ipAddress,
      riskLevel: 'high',
      success: true,
    });

    // Send security notification
    const notificationService = new NotificationService(c.env.DB, {
      resendApiKey: c.env.RESEND_API_KEY,
      twilioAccountSid: c.env.TWILIO_ACCOUNT_SID,
      twilioAuthToken: c.env.TWILIO_AUTH_TOKEN,
      twilioPhoneNumber: c.env.TWILIO_PHONE_NUMBER,
    });

    notificationService.sendSecurityAlert(
      user.email,
      'Changement de mot de passe',
      `Votre mot de passe a été modifié le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')} depuis l'adresse IP ${ipAddress}. Si ce n'était pas vous, sécurisez immédiatement votre compte.`
    ).catch(err => console.error('Failed to send password change alert:', err));

    return c.json({
      success: true,
      data: {
        message: 'Mot de passe modifié avec succès',
        passwordStrength: passwordValidation.strength,
        sessionsInvalidated: true,
      } satisfies PasswordChangedData,
      requestId,
    });
  } catch (error) {
    console.error('Password change error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId,
    }, 500);
  }
});

// ============================================
// PRICE ALERTS
// ============================================

// Price alert validation schema
const createPriceAlertSchema = z.object({
  alertType: z.enum(['ABOVE', 'BELOW']),
  targetPrice: z.number().positive(),
  currency: z.enum(['XOF', 'USD']).default('XOF'),
  notificationMethod: z.enum(['PUSH', 'EMAIL', 'SMS', 'ALL']).default('PUSH'),
  note: z.string().max(200).optional(),
});

const updatePriceAlertSchema = z.object({
  targetPrice: z.number().positive().optional(),
  notificationMethod: z.enum(['PUSH', 'EMAIL', 'SMS', 'ALL']).optional(),
  isActive: z.boolean().optional(),
  note: z.string().max(200).optional(),
});

// GET /users/me/price-alerts - List user's price alerts
users.get('/me/price-alerts', async (c) => {
  const userId = c.get('userId');
  const requestId = crypto.randomUUID();

  try {
    const includeTriggered = c.req.query('includeTriggered') === 'true';
    const activeOnly = c.req.query('activeOnly') !== 'false';

    let query = 'SELECT * FROM price_alerts WHERE user_id = ?';
    const params: any[] = [userId];

    if (activeOnly) {
      query += ' AND is_active = 1';
    }

    if (!includeTriggered) {
      query += ' AND triggered = 0';
    }

    query += ' ORDER BY created_at DESC';

    const alerts = await c.env.DB.prepare(query).bind(...params).all<any>();

    // Get current price for reference
    let currentPrice = null;
    try {
      const env = c.env.ENVIRONMENT || 'development';
      const priceStr = await c.env.CACHE.get(`${env}:gold_price:current`);
      if (priceStr) currentPrice = JSON.parse(priceStr);
    } catch {}

    return c.json({
      success: true,
      data: {
        items: alerts.results?.map((a: any) => ({
          id: a.id,
          alertType: a.alert_type,
          targetPrice: a.target_price,
          currency: a.currency,
          notificationMethod: a.notification_method,
          isActive: Boolean(a.is_active),
          triggered: Boolean(a.triggered),
          triggeredAt: a.triggered_at,
          triggeredPrice: a.triggered_price,
          note: a.note,
          createdAt: a.created_at,
        })) || [],
        total: alerts.results?.length || 0,
        currentPrice,
      },
      requestId,
    });
  } catch (error) {
    console.error('Get price alerts error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId,
    }, 500);
  }
});

// POST /users/me/price-alerts - Create a new price alert
users.post('/me/price-alerts', zValidator('json', createPriceAlertSchema, surErreurDeValidation), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const requestId = crypto.randomUUID();

  try {
    // Check if user already has too many active alerts
    const configService = new ConfigService(c.env.DB, c.env.CACHE);
    const maxAlerts = await configService.getNumber('max_price_alerts_per_user', 10);
    const countResult = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM price_alerts WHERE user_id = ? AND is_active = 1 AND triggered = 0')
      .bind(userId)
      .first<{ count: number }>();

    if ((countResult?.count || 0) >= maxAlerts) {
      return c.json({
        success: false,
        error: {
          code: 'ALERT_LIMIT_EXCEEDED',
          message: texte(c, 'ALERT_LIMIT_EXCEEDED', { max: maxAlerts }),
        },
        requestId,
      }, 400);
    }

    // Check for duplicate alert (same type and similar price within configurable threshold)
    const alertConfigService = new ConfigService(c.env.DB, c.env.CACHE);
    const duplicateThreshold = await alertConfigService.getNumber('price_alert_duplicate_threshold', 0.01);
    const duplicateCheck = await c.env.DB
      .prepare(`
        SELECT id FROM price_alerts
        WHERE user_id = ? AND alert_type = ? AND is_active = 1 AND triggered = 0
          AND ABS(target_price - ?) / target_price < ?
      `)
      .bind(userId, body.alertType, body.targetPrice, duplicateThreshold)
      .first();

    if (duplicateCheck) {
      return c.json({
        success: false,
        error: {
          code: 'DUPLICATE_ALERT',
          message: texte(c, 'DUPLICATE_ALERT'),
        },
        requestId,
      }, 400);
    }

    const alertId = crypto.randomUUID();

    await c.env.DB
      .prepare(`
        INSERT INTO price_alerts (id, user_id, alert_type, target_price, currency, notification_method, note, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `)
      .bind(
        alertId,
        userId,
        body.alertType,
        body.targetPrice,
        body.currency,
        body.notificationMethod,
        body.note || null
      )
      .run();

    return c.json({
      success: true,
      data: {
        id: alertId,
        alertType: body.alertType,
        targetPrice: body.targetPrice,
        currency: body.currency,
        notificationMethod: body.notificationMethod,
        note: body.note,
        message: `Alerte créée: vous serez notifié quand le prix passe ${body.alertType === 'ABOVE' ? 'au-dessus de' : 'en-dessous de'} ${body.targetPrice} ${body.currency}`,
      },
      requestId,
    });
  } catch (error) {
    console.error('Create price alert error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId,
    }, 500);
  }
});

// PATCH /users/me/price-alerts/:id - Update a price alert
users.patch('/me/price-alerts/:id', zValidator('json', updatePriceAlertSchema, surErreurDeValidation), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const body = c.req.valid('json');
  const requestId = crypto.randomUUID();

  try {
    // Check if alert exists and belongs to user
    const existingAlert = await c.env.DB
      .prepare('SELECT * FROM price_alerts WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first<any>();

    if (!existingAlert) {
      return c.json({
        success: false,
        error: {
          code: 'ALERT_NOT_FOUND',
          message: texte(c, 'ALERT_NOT_FOUND'),
        },
        requestId,
      }, 404);
    }

    // Build update query
    const updates: string[] = [];
    const values: any[] = [];

    if (body.targetPrice !== undefined) {
      updates.push('target_price = ?');
      values.push(body.targetPrice);
    }

    if (body.notificationMethod !== undefined) {
      updates.push('notification_method = ?');
      values.push(body.notificationMethod);
    }

    if (body.isActive !== undefined) {
      updates.push('is_active = ?');
      values.push(body.isActive ? 1 : 0);
    }

    if (body.note !== undefined) {
      updates.push('note = ?');
      values.push(body.note);
    }

    if (updates.length === 0) {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: texte(c, 'INVALID_INPUT'),
        },
        requestId,
      }, 400);
    }

    updates.push("updated_at = datetime('now')");
    values.push(id);

    await c.env.DB
      .prepare(`UPDATE price_alerts SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    return c.json({
      success: true,
      data: {
        id,
        message: 'Alerte mise à jour',
      },
      requestId,
    });
  } catch (error) {
    console.error('Update price alert error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId,
    }, 500);
  }
});

// DELETE /users/me/price-alerts/:id - Delete a price alert
users.delete('/me/price-alerts/:id', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const requestId = crypto.randomUUID();

  try {
    // Check if alert exists and belongs to user
    const existingAlert = await c.env.DB
      .prepare('SELECT id FROM price_alerts WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first();

    if (!existingAlert) {
      return c.json({
        success: false,
        error: {
          code: 'ALERT_NOT_FOUND',
          message: texte(c, 'ALERT_NOT_FOUND'),
        },
        requestId,
      }, 404);
    }

    // SECURITY: Include user_id in DELETE to prevent TOCTOU race condition
    await c.env.DB
      .prepare('DELETE FROM price_alerts WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .run();

    return c.json({
      success: true,
      data: {
        message: 'Alerte supprimée',
      },
      requestId,
    });
  } catch (error) {
    console.error('Delete price alert error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId,
    }, 500);
  }
});

// ============================================
// ACCOUNT DELETION
// ============================================

// DELETE /users/me - Delete user account
users.delete('/me', async (c) => {
  const userId = c.get('userId');
  const requestId = crypto.randomUUID();

  try {
    const body = await c.req.json();
    const { password } = body;

    if (!password) {
      return c.json({
        success: false,
        error: {
          code: 'PASSWORD_REQUIRED',
          message: texte(c, 'PASSWORD_REQUIRED'),
        },
        requestId,
      }, 400);
    }

    // Get user
    const user = await c.env.DB
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(userId)
      .first<any>();

    if (!user) {
      return c.json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: texte(c, 'USER_NOT_FOUND'),
        },
        requestId,
      }, 404);
    }

    // Verify password
    const authService = new AuthService(c.env.JWT_SECRET);
    const passwordResult = await authService.verifyPasswordWithRehashCheck(password, user.password_hash);

    if (!passwordResult.valid) {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_PASSWORD',
          message: texte(c, 'INVALID_PASSWORD'),
        },
        requestId,
      }, 401);
    }
    // Note: No rehash needed - account is being deleted

    // Ce qui empêche la fermeture SE DIT, condition par condition (ADR 015).
    // La route renvoyait INTERNAL_ERROR 500 sans rien expliquer, et échouait
    // pour tout utilisateur ayant demandé un seul devis : `quotes` référence
    // `users` sans `ON DELETE CASCADE`, comme onze autres tables.
    const cloture = new AccountClosureService(c.env.DB, c.env.STORAGE);

    const obstacle = await cloture.obstacles(userId);
    if (!obstacle.ok) {
      return c.json({
        success: false,
        error: {
          code: obstacle.code,
          message: messageObstacle(c, obstacle.code, obstacle.details),
          details: obstacle.details,
        },
        requestId,
      }, 400);
    }

    // Les objets R2 partent AVANT les lignes qui les désignent. L'ordre inverse
    // laissait les pièces d'identité chiffrées en ligne, sans plus rien pour
    // les retrouver.
    const pieces = await cloture.supprimerPieces(userId);
    if (!pieces.ok) {
      return c.json({
        success: false,
        error: { code: pieces.code, message: texte(c, 'STORAGE_DELETE_FAILED') },
        requestId,
      }, 503);
    }

    const maintenant = new Date().toISOString();
    await c.env.DB.batch(cloture.fermeture(userId, maintenant));

    const securityService = new SecurityService(c.env.DB, c.env.CACHE);
    const ipAddress = c.req.header('CF-Connecting-IP') ||
      c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
      'unknown';

    await securityService.logAuditEvent({
      userId,
      action: 'ACCOUNT_CLOSED',
      entityType: 'user',
      entityId: userId,
      ipAddress,
      riskLevel: 'critical',
      success: true,
      oldValue: JSON.stringify({ email: user.email }),
    });

    return c.json({
      success: true,
      data: {
        // Le message disait « supprimé définitivement » alors que rien ne
        // l'était vraiment. Il dit maintenant ce qui se passe.
        message: 'Votre compte est fermé. Vos données personnelles ont été supprimées ; le registre de vos opérations est conservé.',
      },
      requestId,
    });
  } catch (error) {
    console.error('Delete account error:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: texte(c, 'INTERNAL_ERROR'),
      },
      requestId,
    }, 500);
  }
});

// ============================================
// PUSH DEVICES
// The `push_tokens` table shipped in the initial schema but nothing ever wrote
// to it, so the platform had no one to notify even once FCM was repaired.
// ============================================

const registerDeviceSchema = z.object({
  token: z.string().min(10).max(512),
  platform: z.enum(['ios', 'android', 'web']),
  deviceId: z.string().max(128).optional(),
});

// POST /users/me/devices — register this installation for push
users.post('/me/devices', async (c) => {
  const userId = c.get('userId');
  const requestId = crypto.randomUUID();
  const parsed = registerDeviceSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({
      success: false,
      error: { code: 'INVALID_INPUT', message: messageValidation(c, parsed.error.issues) },
      requestId,
    }, 400);
  }

  const service = new PushTokenService(c.env.DB);
  await service.register({
    userId,
    token: parsed.data.token,
    platform: parsed.data.platform,
    deviceId: parsed.data.deviceId,
  });

  return c.json({ success: true, data: { registered: true }, requestId }, 201);
});

// DELETE /users/me/devices — stop notifying this installation (logout)
users.delete('/me/devices', async (c) => {
  const userId = c.get('userId');
  const requestId = crypto.randomUUID();
  const body = await c.req.json().catch(() => ({})) as { token?: string };
  if (!body?.token) {
    return c.json({
      success: false,
      error: { code: 'INVALID_INPUT', message: texte(c, 'INVALID_INPUT') },
      requestId,
    }, 400);
  }

  const service = new PushTokenService(c.env.DB);
  // Scoped to the caller: a token you do not own is not yours to silence.
  const removed = await service.deactivateForUser(userId, body.token);
  return c.json({ success: true, data: { removed }, requestId });
});

export const userRoutes = users;
