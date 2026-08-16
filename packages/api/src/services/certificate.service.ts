/**
 * Certificate Service - Generate and verify ownership certificates
 * Certificates are persisted in D1 with unique verification codes.
 * No price/value displayed — gold price is volatile.
 */

export interface CertificateData {
  certificateId: string;
  verificationCode: string;
  userName: string;
  userEmail: string;
  userId: string;
  kycLevel: string;
  tokenBalance: number;
  equivalentGrams: number;
  /** Grams currently in a lease: owned by the holder, lent out, not in the wallet. */
  leasedBalance: number;
  issuedAt: string;
}

export interface CertificateRecord {
  id: string;
  user_id: string;
  verification_code: string;
  token_balance: number;
  leased_balance: number;
  user_name: string;
  user_email: string;
  kyc_level: string;
  status: 'VALID' | 'REVOKED' | 'EXPIRED';
  issued_at: string;
  expires_at: string | null;
  verification_count: number;
  last_verified_at: string | null;
}

export interface VerificationResult {
  valid: boolean;
  certificate?: {
    certificateId: string;
    verificationCode: string;
    holderName: string;
    tokenBalance: number;
    leasedBalance: number;
    totalOwnedGrams: number;
    kycLevel: string;
    status: string;
    issuedAt: string;
    verificationCount: number;
  };
  reason?: string;
}

import { ConfigService } from './config.service';
import { renderPdf } from '../lib/pdf';
import { buildCertificateDocument, totalOwnedGrams } from '../lib/certificate-document';

export class CertificateService {
  private configService: ConfigService;

  constructor(
    private db: D1Database,
    private storage: R2Bucket,
    private cache: KVNamespace,
    configService?: ConfigService
  ) {
    this.configService = configService || new ConfigService(db, cache);
  }

  /**
   * Generate a unique 12-character verification code: BF-XXXX-XXXX
   */
  private generateVerificationCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous chars (0/O, 1/I)
    let code = '';
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < 8; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return `BF-${code.slice(0, 4)}-${code.slice(4, 8)}`;
  }

  /**
   * Issue a new certificate — persists to D1 + generates HTML + stores in R2
   */
  async issueCertificate(data: Omit<CertificateData, 'certificateId' | 'verificationCode' | 'issuedAt'>): Promise<CertificateData> {
    // The random suffix is not decoration: on `CERT-{ms}-{userId}` alone, two
    // certificates issued by the same holder in the same millisecond — a
    // double-tap, a client retry — collide on the primary key and the second
    // one fails instead of being issued.
    const certificateId = `CERT-${Date.now()}-${data.userId.slice(0, 8).toUpperCase()}-${crypto
      .randomUUID()
      .slice(0, 8)
      .toUpperCase()}`;
    const verificationCode = this.generateVerificationCode();
    const issuedAt = new Date().toISOString();

    const certData: CertificateData = {
      ...data,
      certificateId,
      verificationCode,
      issuedAt,
    };

    // Persist to D1
    await this.db
      .prepare(`INSERT INTO certificates (id, user_id, verification_code, token_balance, leased_balance, user_name, user_email, kyc_level, issued_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        certificateId,
        data.userId,
        verificationCode,
        data.tokenBalance,
        data.leasedBalance,
        data.userName,
        data.userEmail,
        data.kycLevel,
        issuedAt
      )
      .run();

    const metadata = {
      certificateId,
      verificationCode,
      userEmail: data.userEmail,
      issuedAt,
    };

    // HTML is what the app displays; the PDF is what the holder downloads,
    // sends to a bank, or still opens in ten years. Both are stored at issue
    // time so a certificate can never be re-rendered differently later.
    const html = await this.generateHtmlCertificate(certData);
    await this.storage.put(`certificates/${certificateId}.html`, html, {
      httpMetadata: { contentType: 'text/html; charset=utf-8' },
      customMetadata: metadata,
    });

    const pdf = await this.generatePdfCertificate(certData);
    await this.storage.put(`certificates/${certificateId}.pdf`, pdf, {
      httpMetadata: { contentType: 'application/pdf' },
      customMetadata: metadata,
    });

    // Cache for quick lookups
    const certCacheTtl = await this.configService.getNumber('certificate_cache_ttl', 86400 * 30);
    await this.cache.put(
      `certificate:${certificateId}`,
      JSON.stringify(certData),
      { expirationTtl: certCacheTtl }
    );

    return certData;
  }

  /**
   * Verify a certificate by its verification code
   */
  async verifyCertificate(verificationCode: string): Promise<VerificationResult> {
    const code = verificationCode.trim().toUpperCase();

    const record = await this.db
      .prepare('SELECT * FROM certificates WHERE verification_code = ?')
      .bind(code)
      .first<CertificateRecord>();

    if (!record) {
      return { valid: false, reason: 'Certificat introuvable. Vérifiez le code saisi.' };
    }

    if (record.status === 'REVOKED') {
      return { valid: false, reason: 'Ce certificat a été révoqué.' };
    }

    if (record.status === 'EXPIRED') {
      return { valid: false, reason: 'Ce certificat a expiré.' };
    }

    // Increment verification count
    await this.db
      .prepare('UPDATE certificates SET verification_count = verification_count + 1, last_verified_at = datetime(\'now\') WHERE id = ?')
      .bind(record.id)
      .run();

    return {
      valid: true,
      certificate: {
        certificateId: record.id,
        verificationCode: record.verification_code,
        holderName: record.user_name,
        tokenBalance: record.token_balance,
        leasedBalance: record.leased_balance ?? 0,
        totalOwnedGrams: totalOwnedGrams({
          walletGrams: record.token_balance,
          leasedGrams: record.leased_balance ?? 0,
        }),
        kycLevel: record.kyc_level,
        status: record.status,
        issuedAt: record.issued_at,
        verificationCount: record.verification_count + 1,
      },
    };
  }

  /**
   * Get certificate HTML from R2
   */
  async getCertificateHtml(certificateId: string): Promise<string | null> {
    const obj = await this.storage.get(`certificates/${certificateId}.html`);
    return obj ? await obj.text() : null;
  }

  /** Get the certificate PDF from R2. */
  async getCertificatePdf(certificateId: string): Promise<ArrayBuffer | null> {
    const obj = await this.storage.get(`certificates/${certificateId}.pdf`);
    return obj ? await obj.arrayBuffer() : null;
  }

  /**
   * Generate the official PDF certificate.
   *
   * No QR image: the PDF writer embeds no bitmaps, and pulling one from an
   * external service would make the document depend on that service still
   * existing when it is opened. The verification code and the URL are printed
   * as text, which is what actually proves the certificate anyway.
   */
  async generatePdfCertificate(data: CertificateData): Promise<Uint8Array> {
    const [appUrl, platformName] = await Promise.all([
      this.configService.get('app_url', 'https://app.tnc-trading.com'),
      this.configService.get('app_name', 'TNC Trading'),
    ]);

    return renderPdf(
      buildCertificateDocument({
        certificateId: data.certificateId,
        verificationCode: data.verificationCode,
        holderName: data.userName,
        holderEmail: data.userEmail,
        kycLevel: data.kycLevel,
        walletGrams: data.tokenBalance,
        leasedGrams: data.leasedBalance,
        issuedAt: data.issuedAt,
        verifyUrl: `${appUrl || 'https://app.tnc-trading.com'}/verify`,
        platformName: platformName || 'TNC Trading',
      })
    );
  }

  /**
   * Generate official HTML certificate — no price, with QR code + verification code
   */
  async generateHtmlCertificate(data: CertificateData): Promise<string> {
    const formattedDate = new Date(data.issuedAt).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    // QR code via public API (encodes the verification URL)
    const appUrl = await this.configService.get('app_url', 'https://app.tnc-trading.com');
    const qrApiUrl = await this.configService.get('qr_code_api_url', 'https://api.qrserver.com/v1/create-qr-code');
    const verifyUrl = `${appUrl}/verify/${encodeURIComponent(data.verificationCode)}`;
    const qrCodeSize = await this.configService.getNumber('certificate_qr_code_size', 180);
    const qrCodeUrl = `${qrApiUrl}/?size=${qrCodeSize}x${qrCodeSize}&data=${encodeURIComponent(verifyUrl)}&color=1B4332&bgcolor=FFFEF5`;

    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Certificat ${data.certificateId} - ${await this.configService.get('app_name', 'TNC Trading')}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Georgia','Times New Roman',serif;background:#e8e0d0;min-height:100vh;display:flex;justify-content:center;align-items:center;padding:24px}
    .cert{background:linear-gradient(180deg,#FFFEF5 0%,#FBF7EB 100%);max-width:780px;width:100%;border:3px solid #C9A84C;position:relative;box-shadow:0 8px 40px rgba(0,0,0,.2)}
    .cert::before{content:'';position:absolute;top:8px;left:8px;right:8px;bottom:8px;border:1px solid #E5D9B6;pointer-events:none}
    .gold-bar{height:6px;background:linear-gradient(90deg,#B8960C,#D4AF37,#E5C158,#D4AF37,#B8960C)}
    .header{text-align:center;padding:40px 40px 20px}
    .republic{font-size:14px;font-weight:800;letter-spacing:4px;color:#1B4332;text-transform:uppercase}
    .emblem{width:64px;height:64px;border-radius:50%;background:#1B4332;border:3px solid #D4AF37;display:flex;align-items:center;justify-content:center;margin:14px auto;color:#D4AF37;font-size:20px;font-weight:900}
    .motto{font-size:11px;color:#6B7280;letter-spacing:2.5px;font-style:italic}
    .sep{width:60px;height:2px;background:#D4AF37;margin:16px auto}
    .ministry{font-size:11px;color:#374151;font-weight:600;letter-spacing:.5px}
    .agency{font-size:10px;color:#6B7280;margin-top:2px}
    .title-block{display:flex;align-items:center;gap:14px;padding:0 40px;margin-top:8px}
    .title-line{flex:1;height:1px;background:#C9A84C}
    .title{font-size:16px;font-weight:800;letter-spacing:3px;color:#7C6D3A;white-space:nowrap}
    .subtitle{text-align:center;font-size:11px;color:#9CA3AF;letter-spacing:1.5px;margin-top:4px}
    .cert-num{text-align:center;margin:12px 40px;padding:8px;border:1px solid #E5D9B6;border-radius:4px;background:rgba(212,175,55,.06)}
    .cert-num span{font-family:'Courier New',monospace;font-size:14px;font-weight:700;color:#374151;letter-spacing:1.5px}
    .cert-num small{font-size:11px;color:#9CA3AF;margin-right:6px}
    .body{padding:20px 40px 24px}
    .attestation{font-style:italic;color:#374151;font-size:13px;line-height:21px;text-align:justify;margin-bottom:20px}
    .divider{height:1px;background:#E5D9B6;margin:18px 0}
    .section-label{display:flex;align-items:center;gap:6px;margin-bottom:10px;font-size:10px;font-weight:700;letter-spacing:2px;color:#7C6D3A;text-transform:uppercase}
    .owner-name{font-size:20px;font-weight:700;color:#1A1A2E}
    .owner-detail{font-size:13px;color:#6B7280;margin-top:3px}
    .gold-row{display:flex;align-items:baseline;gap:10px}
    .gold-amount{font-size:44px;font-weight:800;color:#1B4332}
    .gold-unit{font-size:17px;color:#6B7280}
    .gold-purity{font-size:12px;font-weight:600;color:#D4AF37;margin-top:4px;letter-spacing:.5px}
    .gold-note{font-size:12px;color:#9CA3AF;margin-top:2px}
    .guarantee{font-size:12px;color:#374151;line-height:19px}
    .detail-row{display:flex;justify-content:space-between;padding:5px 0;font-size:12px}
    .detail-label{color:#6B7280}
    .detail-value{color:#374151;font-weight:600}
    .footer{display:flex;gap:20px;background:#F5F0E1;padding:24px 40px;border-top:1px solid #E5D9B6;align-items:flex-start}
    .qr{flex-shrink:0;text-align:center}
    .qr img{width:100px;height:100px;border:2px solid #E5D9B6;border-radius:4px}
    .qr-label{font-size:8px;color:#9CA3AF;margin-top:4px;letter-spacing:.5px}
    .footer-content{flex:1}
    .footer-legal{font-size:10px;color:#6B7280;line-height:15px;margin-bottom:4px}
    .verification-box{margin-top:10px;padding:8px 14px;background:rgba(212,175,55,.08);border:1px solid #E5D9B6;border-radius:4px;text-align:center}
    .verification-box .code{font-family:'Courier New',monospace;font-size:18px;font-weight:800;color:#1B4332;letter-spacing:3px}
    .verification-box .label{font-size:9px;color:#7C6D3A;letter-spacing:1px;margin-bottom:4px;text-transform:uppercase}
    .seal{position:absolute;bottom:140px;right:50px;width:80px;height:80px;border:2px solid #D4AF37;border-radius:50%;display:flex;flex-direction:column;justify-content:center;align-items:center;transform:rotate(-12deg);background:rgba(212,175,55,.06)}
    .seal .s1{font-size:8px;color:#7C6D3A;font-weight:800;letter-spacing:1px}
    .seal .s2{font-size:7px;color:#7C6D3A;letter-spacing:.5px}
    .sig{margin-top:12px;text-align:center}
    .sig-line{width:140px;height:1px;background:#9CA3AF;margin:0 auto 4px}
    .sig-label{font-size:9px;color:#9CA3AF}
    @media print{body{background:#fff;padding:0}.cert{box-shadow:none;max-width:100%}}
  </style>
</head>
<body>
  <div class="cert">
    <div class="gold-bar"></div>
    <div class="header">
      <div class="republic">Burkina Faso</div>
      <div class="emblem">BF</div>
      <div class="motto">Unité – Progrès – Justice</div>
      <div class="sep"></div>
      <div class="ministry">Ministère des Mines et des Carrières</div>
      <div class="agency">Programme National de Tokenisation de l'Or</div>
    </div>
    <div class="title-block">
      <div class="title-line"></div>
      <div class="title">CERTIFICAT DE PROPRIÉTÉ</div>
      <div class="title-line"></div>
    </div>
    <div class="subtitle">Or Physique Tokenisé</div>
    <div class="cert-num"><small>N°</small><span>${data.certificateId}</span></div>
    <div class="body">
      <div class="attestation">
        Le présent certificat atteste que le titulaire ci-dessous désigné est propriétaire
        de la quantité d'or physique indiquée, détenue sous forme de tokens numériques
        adossés aux réserves aurifères du Burkina Faso.
      </div>
      <div class="divider"></div>
      <div class="section-label">&#9670; Titulaire</div>
      <div class="owner-name">${this.escapeHtml(data.userName)}</div>
      <div class="owner-detail">${this.escapeHtml(data.userEmail)}</div>
      <div class="owner-detail">Identité vérifiée — Niveau ${data.kycLevel}</div>
      <div class="divider"></div>
      <div class="section-label">&#9670; Or Physique Détenu</div>
      <div class="gold-row">
        <div class="gold-amount">${data.tokenBalance.toFixed(3)}</div>
        <div class="gold-unit">grammes</div>
      </div>
      <div class="gold-purity">Or pur 999,9/1000 (24 carats)</div>
      <div class="gold-note">Équivalent à ${data.tokenBalance.toFixed(3)} token(s) TNC — 1 token = 1 gramme d'or physique</div>
      <div class="divider"></div>
      <div class="section-label">&#9670; Garantie et Couverture</div>
      <div class="guarantee">
        L'or physique correspondant aux tokens émis est conservé dans les réserves nationales
        sous la supervision du Ministère des Mines et des Carrières du Burkina Faso.
        Le ratio de couverture est vérifié par audit indépendant.
      </div>
      <div class="divider"></div>
      <div class="section-label">&#9670; Informations du Certificat</div>
      <div class="detail-row"><span class="detail-label">Numéro</span><span class="detail-value">${data.certificateId}</span></div>
      <div class="detail-row"><span class="detail-label">Date d'émission</span><span class="detail-value">${formattedDate}</span></div>
      <div class="detail-row"><span class="detail-label">Émetteur</span><span class="detail-value">TNC Trading SA</span></div>
      <div class="detail-row"><span class="detail-label">Autorité de tutelle</span><span class="detail-value">Min. des Mines — BF</span></div>
    </div>
    <div class="seal">
      <span class="s1">SCEAU</span>
      <span class="s2">OFFICIEL</span>
    </div>
    <div class="footer">
      <div class="qr">
        <img src="${qrCodeUrl}" alt="QR Code de vérification" />
        <div class="qr-label">Scanner pour vérifier</div>
      </div>
      <div class="footer-content">
        <div class="footer-legal">
          Ce certificat est émis conformément à la réglementation en vigueur
          relative à la tokenisation des actifs aurifères en zone UEMOA.
        </div>
        <div class="footer-legal">
          Document à valeur probante — Vérifiable sur tnc-trading.com/verify
        </div>
        <div class="verification-box">
          <div class="label">Code de vérification</div>
          <div class="code">${data.verificationCode}</div>
        </div>
        <div class="sig">
          <div class="sig-line"></div>
          <div class="sig-label">Signature électronique — TNC Trading SA</div>
        </div>
      </div>
    </div>
    <div class="gold-bar"></div>
  </div>
</body>
</html>`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
