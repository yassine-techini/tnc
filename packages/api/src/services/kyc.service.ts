/**
 * KYC Service - Smile Identity Integration
 *
 * Smile Identity provides identity verification services for Africa:
 * - Document Verification (ID cards, passports)
 * - Face Verification (biometric matching)
 * - Liveness Detection
 * - AML Screening
 *
 * Documentation: https://docs.smileidentity.com/
 */

export interface KycConfig {
  apiKey: string;
  partnerId: string;
  environment: 'sandbox' | 'production';
  callbackUrl: string;
}

export interface KycDocument {
  id: string;
  userId: string;
  documentType: 'CNIB' | 'PASSPORT' | 'PERMIT' | 'CEDEAO';
  documentNumber?: string;
  frontImageUrl: string;
  backImageUrl?: string;
  selfieUrl: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  nationality?: string;
  expiryDate?: string;
}

export interface VerificationRequest {
  userId: string;
  kycDocumentId: string;
  documentType: string;
  documentNumber?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  country: string;
  frontImageBase64: string;
  backImageBase64?: string;
  selfieImageBase64: string;
}

/**
 * Smile Identity webhook callback data structure
 * @see https://docs.smileidentity.com/server-to-server/webhooks
 */
export interface SmileIdentityWebhookData {
  job_id: string;
  job_success: boolean;
  result_code: string;
  result_text: string;
  partner_params?: {
    job_id?: string;
    user_id?: string;
    [key: string]: unknown;
  };
  actions?: {
    Document_Check?: string;
    Human_Review_Compare?: string;
    Human_Review_Update_Selfie?: string;
    Liveness_Check?: string;
    Register_Selfie?: string;
    Return_Personal_Info?: string;
    Selfie_Check?: string;
    Verify_ID_Number?: string;
  };
  confidence?: number;
  full_data?: Record<string, unknown>;
  timestamp?: string;
}

export interface VerificationResult {
  success: boolean;
  jobId?: string;
  resultCode?: string;
  resultText?: string;
  confidence?: number;
  actions?: {
    documentVerified: boolean;
    humanReviewRequired: boolean;
    selfieVerified: boolean;
    livenessCheckPassed: boolean;
  };
  details?: {
    documentValid: boolean;
    documentExpired: boolean;
    faceMatch: boolean;
    faceMatchScore: number;
    antiSpoofPassed: boolean;
    antiSpoofScore: number;
    extractedData?: {
      firstName?: string;
      lastName?: string;
      dateOfBirth?: string;
      documentNumber?: string;
      expiryDate?: string;
      nationality?: string;
    };
  };
  error?: string;
}

// Smile Identity Result Codes
const RESULT_CODES = {
  '0810': { success: true, text: 'Verified' },
  '0820': { success: true, text: 'Exact Match' },
  '0840': { success: true, text: 'Partial Match' },
  '1000': { success: false, text: 'Unable to match' },
  '1010': { success: false, text: 'Face not found' },
  '1020': { success: false, text: 'Document not readable' },
  '1030': { success: false, text: 'Liveness check failed' },
  '1100': { success: false, text: 'Spoof detected' },
};

import { ConfigService } from './config.service';

/**
 * KYC Limits type - defines trading limits per KYC level
 */
export interface KycLimits {
  dailyBuy: number;      // Max grams per day
  monthlyBuy: number;    // Max grams per month
  canSell: boolean;      // Can user sell tokens
  dailyWithdraw: number; // Max XOF withdrawal per day
}

/**
 * Default KYC limits (used when config is not available)
 */
export const DEFAULT_KYC_LIMITS: Record<string, KycLimits> = {
  BASIC: { dailyBuy: 0, monthlyBuy: 0, canSell: false, dailyWithdraw: 0 },
  STANDARD: { dailyBuy: 100, monthlyBuy: 500, canSell: true, dailyWithdraw: 500_000 },
  VERIFIED: { dailyBuy: 1000, monthlyBuy: 5000, canSell: true, dailyWithdraw: 5_000_000 },
};

export class KycService {
  private baseUrl: string;
  private configService: ConfigService | null;

  constructor(
    private db: D1Database,
    private storage: R2Bucket,
    private config: KycConfig,
    configService?: ConfigService
  ) {
    this.configService = configService || null;
    this.baseUrl = config.environment === 'production'
      ? 'https://api.smileidentity.com/v1'
      : 'https://testapi.smileidentity.com/v1';
  }

  private async getBaseUrl(): Promise<string> {
    if (!this.configService) return this.baseUrl;
    const configKey = this.config.environment === 'production'
      ? 'smile_identity_api_url'
      : 'smile_identity_test_api_url';
    const defaultUrl = this.baseUrl;
    return this.configService.get(configKey, defaultUrl);
  }

  /**
   * Verify Smile Identity webhook signature
   * Smile Identity signs webhooks with HMAC-SHA256 using the API key
   */
  async verifyWebhookSignature(payload: string, signature: string): Promise<boolean> {
    if (!signature) {
      return false;
    }

    try {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(this.config.apiKey),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );

      const signatureBuffer = await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(payload)
      );

      const computedSignature = Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      // Constant-time comparison to prevent timing attacks
      if (computedSignature.length !== signature.length) {
        return false;
      }

      let result = 0;
      for (let i = 0; i < computedSignature.length; i++) {
        result |= computedSignature.charCodeAt(i) ^ signature.charCodeAt(i);
      }
      return result === 0;
    } catch (error) {
      console.error('Failed to verify Smile Identity webhook signature:', error);
      return false;
    }
  }

  /**
   * Load KYC limits from config (or use defaults)
   * Static method to allow usage without full KycService instantiation
   * @param configService - Optional ConfigService for loading from DB
   * @returns KYC limits per level (BASIC, STANDARD, VERIFIED)
   */
  static async getKycLimits(configService?: ConfigService | null): Promise<Record<string, KycLimits>> {
    if (!configService) {
      return { ...DEFAULT_KYC_LIMITS };
    }

    const [
      basicDailyBuy, basicMonthlyBuy, basicCanSell, basicDailyWithdraw,
      standardDailyBuy, standardMonthlyBuy, standardCanSell, standardDailyWithdraw,
      verifiedDailyBuy, verifiedMonthlyBuy, verifiedCanSell, verifiedDailyWithdraw,
    ] = await Promise.all([
      configService.getNumber('kyc_basic_daily_buy', 0),
      configService.getNumber('kyc_basic_monthly_buy', 0),
      configService.getNumber('kyc_basic_can_sell', 0),
      configService.getNumber('kyc_basic_daily_withdraw', 0),
      configService.getNumber('kyc_standard_daily_buy', 100),
      configService.getNumber('kyc_standard_monthly_buy', 500),
      configService.getNumber('kyc_standard_can_sell', 1),
      configService.getNumber('kyc_standard_daily_withdraw_xof', 500_000),
      configService.getNumber('kyc_verified_daily_buy', 1000),
      configService.getNumber('kyc_verified_monthly_buy', 5000),
      configService.getNumber('kyc_verified_can_sell', 1),
      configService.getNumber('kyc_verified_daily_withdraw_xof', 5_000_000),
    ]);

    return {
      BASIC: { dailyBuy: basicDailyBuy, monthlyBuy: basicMonthlyBuy, canSell: basicCanSell === 1, dailyWithdraw: basicDailyWithdraw },
      STANDARD: { dailyBuy: standardDailyBuy, monthlyBuy: standardMonthlyBuy, canSell: standardCanSell === 1, dailyWithdraw: standardDailyWithdraw },
      VERIFIED: { dailyBuy: verifiedDailyBuy, monthlyBuy: verifiedMonthlyBuy, canSell: verifiedCanSell === 1, dailyWithdraw: verifiedDailyWithdraw },
    };
  }

  /**
   * Instance method wrapper for getKycLimits (for convenience)
   */
  async getKycLimitsForUser(): Promise<Record<string, KycLimits>> {
    return KycService.getKycLimits(this.configService);
  }

  /**
   * Generate Smile Identity signature
   */
  private async generateSignature(timestamp: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(this.config.partnerId + ':' + timestamp);

    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.config.apiKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', key, data);
    const signatureArray = new Uint8Array(signature);
    return btoa(String.fromCharCode(...signatureArray));
  }

  /**
   * Check if Smile Identity provider is enabled
   */
  private async isProviderEnabled(): Promise<boolean> {
    try {
      const row = await this.db
        .prepare('SELECT enabled FROM integrations WHERE provider = ?')
        .bind('smile_identity')
        .first<{ enabled: number }>();
      return row?.enabled === 1;
    } catch {
      return true;
    }
  }

  /**
   * Submit KYC verification request to Smile Identity
   */
  async submitVerification(request: VerificationRequest): Promise<VerificationResult> {
    if (!await this.isProviderEnabled()) {
      return { success: false, error: 'Smile Identity is currently disabled' };
    }

    try {
      const timestamp = new Date().toISOString();
      const signature = await this.generateSignature(timestamp);

      // Map document type to Smile Identity ID type
      const idType = this.mapDocumentType(request.documentType);

      // Prepare the request payload
      const payload = {
        partner_id: this.config.partnerId,
        timestamp,
        signature,
        callback_url: this.config.callbackUrl,
        source_sdk: 'tnc_trading_api',
        source_sdk_version: '1.0.0',
        partner_params: {
          user_id: request.userId,
          job_id: request.kycDocumentId,
          job_type: 1, // Document Verification with Selfie
        },
        id_info: {
          country: request.country || 'BF',
          id_type: idType,
          id_number: request.documentNumber,
          first_name: request.firstName,
          last_name: request.lastName,
          dob: request.dateOfBirth,
        },
        images: [
          {
            image_type_id: 0, // Selfie
            image: request.selfieImageBase64,
          },
          {
            image_type_id: 1, // ID Front
            image: request.frontImageBase64,
          },
        ],
      };

      // Add back image if provided
      if (request.backImageBase64) {
        payload.images.push({
          image_type_id: 2, // ID Back
          image: request.backImageBase64,
        });
      }

      // Submit to Smile Identity
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Smile Identity error:', errorText);
        return {
          success: false,
          error: `Smile Identity API error: ${response.status}`,
        };
      }

      const result = await response.json() as {
        job_id: string;
        result_code: string;
        result_text: string;
      };

      // Update KYC document with job ID
      await this.db
        .prepare(`
          UPDATE kyc_documents
          SET provider_job_id = ?,
              status = 'PROCESSING',
              updated_at = datetime('now')
          WHERE id = ?
        `)
        .bind(result.job_id, request.kycDocumentId)
        .run();

      // Log the verification request
      await this.logVerification(request.userId, request.kycDocumentId, 'KYC_SUBMITTED', result.job_id);

      return {
        success: true,
        jobId: result.job_id,
        resultCode: result.result_code,
        resultText: result.result_text,
      };
    } catch (error) {
      console.error('KYC verification error:', error);
      return {
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Process Smile Identity webhook callback
   */
  async processCallback(webhookData: SmileIdentityWebhookData): Promise<{
    success: boolean;
    userId?: string;
    newKycLevel?: 'BASIC' | 'STANDARD' | 'VERIFIED';
    error?: string;
  }> {
    try {
      const {
        job_id,
        job_success,
        result_code,
        result_text,
        partner_params,
        actions,
        confidence,
        full_data,
      } = webhookData;

      // Find the KYC document by job ID
      const kycDoc = await this.db
        .prepare('SELECT * FROM kyc_documents WHERE provider_job_id = ?')
        .bind(job_id)
        .first<any>();

      if (!kycDoc) {
        return { success: false, error: 'KYC document not found' };
      }

      const userId = kycDoc.user_id;

      // Determine verification status
      const isVerified = job_success && this.isSuccessCode(result_code);

      // Prepare verification result
      const verificationResult = {
        resultCode: result_code,
        resultText: result_text,
        confidence,
        actions,
        fullData: full_data,
        timestamp: new Date().toISOString(),
      };

      // Update KYC document
      const newDocStatus = isVerified ? 'VERIFIED' : 'REJECTED';
      const rejectionReason = isVerified ? null : result_text;

      await this.db
        .prepare(`
          UPDATE kyc_documents
          SET status = ?,
              provider_result = ?,
              rejection_reason = ?,
              reviewed_at = CASE WHEN ? = 'VERIFIED' THEN datetime('now') ELSE NULL END,
              updated_at = datetime('now')
          WHERE id = ?
        `)
        .bind(
          newDocStatus,
          JSON.stringify(verificationResult),
          rejectionReason,
          newDocStatus,
          kycDoc.id
        )
        .run();

      // Determine new KYC level based on verification
      let newKycLevel: 'BASIC' | 'STANDARD' | 'VERIFIED' = 'BASIC';

      if (isVerified) {
        // Get current user KYC level
        const user = await this.db
          .prepare('SELECT kyc_level FROM users WHERE id = ?')
          .bind(userId)
          .first<{ kyc_level: string }>();

        // Upgrade KYC level based on document type and current level
        if (user?.kyc_level === 'BASIC') {
          newKycLevel = 'STANDARD';
        } else if (user?.kyc_level === 'STANDARD') {
          // Check if this is a higher-level document (CNIB or passport)
          if (['CNIB', 'PASSPORT'].includes(kycDoc.document_type)) {
            newKycLevel = 'VERIFIED';
          } else {
            newKycLevel = 'STANDARD';
          }
        } else {
          newKycLevel = user?.kyc_level as 'VERIFIED' || 'STANDARD';
        }

        // Update user KYC level and status
        await this.db
          .prepare(`
            UPDATE users
            SET kyc_level = ?,
                kyc_status = 'APPROVED',
                updated_at = datetime('now')
            WHERE id = ?
          `)
          .bind(newKycLevel, userId)
          .run();
      } else {
        // Update user KYC status to rejected
        await this.db
          .prepare(`
            UPDATE users
            SET kyc_status = 'REJECTED',
                updated_at = datetime('now')
            WHERE id = ?
          `)
          .bind(userId)
          .run();
      }

      // Log the callback processing
      await this.logVerification(
        userId,
        kycDoc.id,
        isVerified ? 'KYC_APPROVED' : 'KYC_REJECTED',
        job_id,
        verificationResult
      );

      return {
        success: true,
        userId,
        newKycLevel: isVerified ? newKycLevel : undefined,
      };
    } catch (error) {
      console.error('KYC callback processing error:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Check verification status
   */
  async checkStatus(jobId: string): Promise<VerificationResult> {
    try {
      const timestamp = new Date().toISOString();
      const signature = await this.generateSignature(timestamp);

      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/job_status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          partner_id: this.config.partnerId,
          timestamp,
          signature,
          job_id: jobId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: errorText };
      }

      const result = await response.json() as {
        job_success: boolean;
        job_id: string;
        result_code: string;
        result_text: string;
        confidence: number;
        actions?: {
          Document_Check?: string;
          Human_Review_Required?: string;
          Selfie_Check?: string;
          Liveness_Check?: string;
        };
      };

      return {
        success: result.job_success,
        jobId: result.job_id,
        resultCode: result.result_code,
        resultText: result.result_text,
        confidence: result.confidence,
        actions: {
          documentVerified: result.actions?.Document_Check === 'Passed',
          humanReviewRequired: result.actions?.Human_Review_Required === 'Yes',
          selfieVerified: result.actions?.Selfie_Check === 'Passed',
          livenessCheckPassed: result.actions?.Liveness_Check === 'Passed',
        },
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Read image from R2 and convert to base64
   */
  async getImageBase64(imageUrl: string): Promise<string | null> {
    try {
      // Extract R2 key from URL
      const key = imageUrl.split('/').slice(-2).join('/');

      const object = await this.storage.get(key);
      if (!object) {
        console.error('Image not found in R2:', key);
        return null;
      }

      const arrayBuffer = await object.arrayBuffer();
      const base64 = btoa(
        String.fromCharCode(...new Uint8Array(arrayBuffer))
      );

      return base64;
    } catch (error) {
      console.error('Error reading image from R2:', error);
      return null;
    }
  }

  /**
   * Initiate KYC verification for a document
   */
  async initiateVerification(kycDocumentId: string): Promise<VerificationResult> {
    // Get KYC document
    const kycDoc = await this.db
      .prepare('SELECT * FROM kyc_documents WHERE id = ?')
      .bind(kycDocumentId)
      .first<any>();

    if (!kycDoc) {
      return { success: false, error: 'KYC document not found' };
    }

    // Read images from R2 and convert to base64
    const [frontImage, backImage, selfieImage] = await Promise.all([
      this.getImageBase64(kycDoc.front_image_url),
      kycDoc.back_image_url ? this.getImageBase64(kycDoc.back_image_url) : Promise.resolve(null),
      this.getImageBase64(kycDoc.selfie_url),
    ]);

    if (!frontImage || !selfieImage) {
      return { success: false, error: 'Failed to read document images' };
    }

    // Get user info
    const user = await this.db
      .prepare('SELECT country FROM users WHERE id = ?')
      .bind(kycDoc.user_id)
      .first<{ country: string }>();

    // Submit verification
    return this.submitVerification({
      userId: kycDoc.user_id,
      kycDocumentId: kycDoc.id,
      documentType: kycDoc.document_type,
      documentNumber: kycDoc.document_number,
      firstName: kycDoc.first_name,
      lastName: kycDoc.last_name,
      dateOfBirth: kycDoc.date_of_birth,
      country: user?.country || 'BF',
      frontImageBase64: frontImage,
      backImageBase64: backImage || undefined,
      selfieImageBase64: selfieImage,
    });
  }

  /**
   * Map document type to Smile Identity ID type
   */
  private mapDocumentType(docType: string): string {
    const mapping: Record<string, string> = {
      'CNIB': 'NATIONAL_ID',
      'PASSPORT': 'PASSPORT',
      'PERMIT': 'DRIVERS_LICENSE',
      'CEDEAO': 'NATIONAL_ID',
    };
    return mapping[docType] || 'NATIONAL_ID';
  }

  /**
   * Check if result code indicates success
   */
  private isSuccessCode(code: string): boolean {
    const successCodes = ['0810', '0820', '0840'];
    return successCodes.includes(code);
  }

  /**
   * Log verification activity
   */
  private async logVerification(
    userId: string,
    documentId: string,
    /** Action COMPLETE, jamais un fragment : voir `lib/audit-actions` (ADR 014). */
    action: 'KYC_SUBMITTED' | 'KYC_APPROVED' | 'KYC_REJECTED',
    jobId?: string,
    details?: any
  ): Promise<void> {
    try {
      await this.db
        .prepare(`
          INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, new_value, created_at)
          VALUES (?, ?, ?, 'kyc_document', ?, ?, datetime('now'))
        `)
        .bind(
          crypto.randomUUID(),
          userId,
          // Action ecrite en clair. Elle etait construite par gabarit
          // (`KYC_${action}`), donc invisible a la lecture comme au controle —
          // et c'est ainsi que la liste de purge a pu diverger sans rien dire.
          action,
          documentId,
          JSON.stringify({ jobId, ...details })
        )
        .run();
    } catch (error) {
      console.error('Failed to log verification:', error);
    }
  }

  /**
   * Get KYC verification status for user
   */
  async getUserKycStatus(userId: string): Promise<{
    level: 'BASIC' | 'STANDARD' | 'VERIFIED';
    status: 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
    documents: Array<{
      id: string;
      type: string;
      status: string;
      submittedAt: string;
      verifiedAt?: string;
      rejectionReason?: string;
    }>;
    limits: {
      dailyBuy: number;
      monthlyBuy: number;
      canSell: boolean;
      dailyWithdraw: number;
    };
  }> {
    // Get user
    const user = await this.db
      .prepare('SELECT kyc_level, kyc_status FROM users WHERE id = ?')
      .bind(userId)
      .first<{ kyc_level: string; kyc_status: string }>();

    if (!user) {
      throw new Error('User not found');
    }

    // Get documents
    const documents = await this.db
      .prepare(`
        SELECT id, document_type, status, created_at, reviewed_at, rejection_reason
        FROM kyc_documents
        WHERE user_id = ?
        ORDER BY created_at DESC
      `)
      .bind(userId)
      .all<any>();

    // KYC limits from config
    const limits = await KycService.getKycLimits(this.configService);

    return {
      level: user.kyc_level as 'BASIC' | 'STANDARD' | 'VERIFIED',
      status: user.kyc_status as 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED',
      documents: (documents.results || []).map((d: any) => ({
        id: d.id,
        type: d.document_type,
        status: d.status,
        submittedAt: d.created_at,
        verifiedAt: d.reviewed_at,
        rejectionReason: d.rejection_reason,
      })),
      limits: limits[user.kyc_level] || limits.BASIC,
    };
  }

  /**
   * Check if user's KYC is valid for trading
   * Returns false if:
   * - KYC level is BASIC (not verified)
   * - KYC status is not APPROVED
   * - KYC document has expired
   */
  async isKycValidForTrading(userId: string): Promise<{
    valid: boolean;
    reason?: string;
    kycLevel?: string;
    expiresAt?: string;
  }> {
    // Get user KYC status
    const user = await this.db
      .prepare('SELECT kyc_level, kyc_status FROM users WHERE id = ?')
      .bind(userId)
      .first<{ kyc_level: string; kyc_status: string }>();

    if (!user) {
      return { valid: false, reason: 'User not found' };
    }

    // Check KYC level
    if (user.kyc_level === 'BASIC') {
      return { valid: false, reason: 'KYC_LEVEL_BASIC', kycLevel: user.kyc_level };
    }

    // Check KYC status
    if (user.kyc_status !== 'APPROVED') {
      return { valid: false, reason: `KYC_STATUS_${user.kyc_status}`, kycLevel: user.kyc_level };
    }

    // Check document expiration
    const latestDoc = await this.db
      .prepare(`
        SELECT id, document_type, document_expiry_date, status
        FROM kyc_documents
        WHERE user_id = ? AND status = 'VERIFIED'
        ORDER BY reviewed_at DESC
        LIMIT 1
      `)
      .bind(userId)
      .first<{
        id: string;
        document_type: string;
        document_expiry_date: string | null;
        status: string;
      }>();

    if (!latestDoc) {
      return { valid: false, reason: 'NO_VERIFIED_DOCUMENT', kycLevel: user.kyc_level };
    }

    // Check expiration date if present
    if (latestDoc.document_expiry_date) {
      const expiryDate = new Date(latestDoc.document_expiry_date);
      const now = new Date();

      if (expiryDate < now) {
        // Document has expired - update user KYC status
        await this.db
          .prepare(`
            UPDATE users
            SET kyc_status = 'EXPIRED', updated_at = datetime('now')
            WHERE id = ?
          `)
          .bind(userId)
          .run();

        return {
          valid: false,
          reason: 'KYC_DOCUMENT_EXPIRED',
          kycLevel: user.kyc_level,
          expiresAt: latestDoc.document_expiry_date
        };
      }

      // Warn if document expires within 30 days
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      if (expiryDate < thirtyDaysFromNow) {
        // Still valid but expiring soon
        return {
          valid: true,
          reason: 'KYC_EXPIRING_SOON',
          kycLevel: user.kyc_level,
          expiresAt: latestDoc.document_expiry_date
        };
      }
    }

    return {
      valid: true,
      kycLevel: user.kyc_level,
      expiresAt: latestDoc.document_expiry_date || undefined
    };
  }
}
