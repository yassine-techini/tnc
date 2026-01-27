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

export class KycService {
  private baseUrl: string;

  constructor(
    private db: D1Database,
    private storage: R2Bucket,
    private config: KycConfig
  ) {
    this.baseUrl = config.environment === 'production'
      ? 'https://api.smileidentity.com/v1'
      : 'https://testapi.smileidentity.com/v1';
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
      const response = await fetch(`${this.baseUrl}/upload`, {
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

      const result = await response.json();

      // Update KYC document with job ID
      await this.db
        .prepare(`
          UPDATE kyc_documents
          SET verification_job_id = ?,
              verification_status = 'PROCESSING',
              updated_at = datetime('now')
          WHERE id = ?
        `)
        .bind(result.job_id, request.kycDocumentId)
        .run();

      // Log the verification request
      await this.logVerification(request.userId, request.kycDocumentId, 'SUBMITTED', result.job_id);

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
  async processCallback(webhookData: any): Promise<{
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
        .prepare('SELECT * FROM kyc_documents WHERE verification_job_id = ?')
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
          SET verification_status = ?,
              verification_result = ?,
              rejection_reason = ?,
              verified_at = CASE WHEN ? = 'VERIFIED' THEN datetime('now') ELSE NULL END,
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
        isVerified ? 'APPROVED' : 'REJECTED',
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

      const response = await fetch(`${this.baseUrl}/job_status`, {
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

      const result = await response.json();

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
    action: string,
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
          `KYC_${action}`,
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
        SELECT id, document_type, verification_status, created_at, verified_at, rejection_reason
        FROM kyc_documents
        WHERE user_id = ?
        ORDER BY created_at DESC
      `)
      .bind(userId)
      .all<any>();

    // KYC limits
    const limits: Record<string, { dailyBuy: number; monthlyBuy: number; canSell: boolean; dailyWithdraw: number }> = {
      BASIC: { dailyBuy: 0, monthlyBuy: 0, canSell: false, dailyWithdraw: 0 },
      STANDARD: { dailyBuy: 100, monthlyBuy: 500, canSell: true, dailyWithdraw: 500_000 },
      VERIFIED: { dailyBuy: 1000, monthlyBuy: 5000, canSell: true, dailyWithdraw: 5_000_000 },
    };

    return {
      level: user.kyc_level as 'BASIC' | 'STANDARD' | 'VERIFIED',
      status: user.kyc_status as 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED',
      documents: (documents.results || []).map((d: any) => ({
        id: d.id,
        type: d.document_type,
        status: d.verification_status,
        submittedAt: d.created_at,
        verifiedAt: d.verified_at,
        rejectionReason: d.rejection_reason,
      })),
      limits: limits[user.kyc_level] || limits.BASIC,
    };
  }
}
