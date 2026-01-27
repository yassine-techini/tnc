/**
 * Certificate Service - Generate ownership certificates
 */

export interface CertificateData {
  certificateId: string;
  userName: string;
  userEmail: string;
  tokenBalance: number;
  equivalentGrams: number;
  currentPriceXof: number;
  estimatedValueXof: number;
  generatedAt: string;
}

export class CertificateService {
  constructor(
    private storage: R2Bucket,
    private cache: KVNamespace
  ) {}

  /**
   * Generate HTML certificate
   */
  generateHtmlCertificate(data: CertificateData): string {
    const formattedDate = new Date(data.generatedAt).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const formattedValue = data.estimatedValueXof.toLocaleString('fr-FR');
    const formattedPrice = data.currentPriceXof.toLocaleString('fr-FR');

    return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Certificat de Propriété - TNC Trading</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Georgia', serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .certificate {
      background: linear-gradient(180deg, #fdf6e3 0%, #f5e6c8 100%);
      max-width: 800px;
      padding: 60px;
      border: 8px double #d4a373;
      border-radius: 8px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
      position: relative;
    }
    .certificate::before {
      content: '';
      position: absolute;
      top: 20px;
      left: 20px;
      right: 20px;
      bottom: 20px;
      border: 2px solid #d4a373;
      border-radius: 4px;
      pointer-events: none;
    }
    .logo { text-align: center; margin-bottom: 30px; }
    .logo h1 {
      font-size: 2.5em;
      color: #b8860b;
      text-shadow: 1px 1px 2px rgba(0,0,0,0.1);
    }
    .logo .subtitle {
      font-size: 1.2em;
      color: #666;
      margin-top: 5px;
    }
    .title {
      text-align: center;
      font-size: 2em;
      color: #333;
      margin: 30px 0;
      text-transform: uppercase;
      letter-spacing: 3px;
    }
    .content { text-align: center; margin: 40px 0; }
    .owner-name {
      font-size: 1.8em;
      color: #1a1a2e;
      border-bottom: 2px solid #d4a373;
      display: inline-block;
      padding: 10px 40px;
      margin-bottom: 20px;
    }
    .details {
      background: rgba(255,255,255,0.5);
      border-radius: 8px;
      padding: 30px;
      margin: 30px 0;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 15px 0;
      border-bottom: 1px dashed #d4a373;
    }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { color: #666; font-size: 1em; }
    .detail-value {
      font-size: 1.3em;
      font-weight: bold;
      color: #1a1a2e;
    }
    .gold-amount {
      text-align: center;
      margin: 30px 0;
      padding: 20px;
      background: linear-gradient(135deg, #b8860b 0%, #daa520 50%, #b8860b 100%);
      border-radius: 8px;
      color: white;
    }
    .gold-amount .amount {
      font-size: 3em;
      font-weight: bold;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
    }
    .gold-amount .unit { font-size: 1.5em; opacity: 0.9; }
    .footer {
      text-align: center;
      margin-top: 40px;
      font-size: 0.9em;
      color: #666;
    }
    .certificate-id {
      font-family: monospace;
      background: #f5f5f5;
      padding: 8px 16px;
      border-radius: 4px;
      display: inline-block;
      margin-top: 10px;
    }
    .seal {
      position: absolute;
      bottom: 60px;
      right: 60px;
      width: 100px;
      height: 100px;
      border: 3px solid #b8860b;
      border-radius: 50%;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      transform: rotate(-15deg);
      background: rgba(184, 134, 11, 0.1);
    }
    .seal .text { font-size: 10px; color: #b8860b; text-transform: uppercase; }
    .seal .check { font-size: 32px; color: #b8860b; }
    @media print {
      body { background: white; }
      .certificate { box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="certificate">
    <div class="logo">
      <h1>TNC Trading</h1>
      <div class="subtitle">Plateforme de Tokenisation d'Or du Burkina Faso</div>
    </div>

    <div class="title">Certificat de Propriété</div>

    <div class="content">
      <p style="margin-bottom: 20px;">Ce certificat atteste que</p>
      <div class="owner-name">${data.userName}</div>
      <p style="color: #666; margin-top: 10px;">${data.userEmail}</p>
    </div>

    <div class="gold-amount">
      <div class="amount">${data.tokenBalance.toFixed(3)}</div>
      <div class="unit">grammes d'or</div>
    </div>

    <div class="details">
      <div class="detail-row">
        <span class="detail-label">Équivalent en tokens</span>
        <span class="detail-value">${data.tokenBalance.toFixed(3)} TNC</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Prix de l'or (XOF/g)</span>
        <span class="detail-value">${formattedPrice} XOF</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Valeur estimée</span>
        <span class="detail-value">${formattedValue} XOF</span>
      </div>
    </div>

    <div class="footer">
      <p>Certificat généré le ${formattedDate}</p>
      <div class="certificate-id">ID: ${data.certificateId}</div>
      <p style="margin-top: 20px; font-size: 0.8em;">
        Ce certificat atteste de la propriété de tokens représentant de l'or physique<br>
        stocké de manière sécurisée par l'État du Burkina Faso.
      </p>
    </div>

    <div class="seal">
      <span class="check">✓</span>
      <span class="text">Vérifié</span>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Store certificate in R2 and cache
   */
  async storeCertificate(data: CertificateData): Promise<string> {
    const html = this.generateHtmlCertificate(data);
    const filename = `certificates/${data.certificateId}.html`;

    // Store in R2
    await this.storage.put(filename, html, {
      httpMetadata: {
        contentType: 'text/html; charset=utf-8',
      },
      customMetadata: {
        certificateId: data.certificateId,
        userEmail: data.userEmail,
        generatedAt: data.generatedAt,
      },
    });

    // Cache certificate data for 24 hours
    await this.cache.put(
      `certificate:${data.certificateId}`,
      JSON.stringify(data),
      { expirationTtl: 86400 }
    );

    return filename;
  }

  /**
   * Get certificate by ID
   */
  async getCertificate(certificateId: string): Promise<CertificateData | null> {
    const cached = await this.cache.get(`certificate:${certificateId}`);
    if (cached) {
      return JSON.parse(cached) as CertificateData;
    }
    return null;
  }

  /**
   * Get certificate HTML from R2
   */
  async getCertificateHtml(certificateId: string): Promise<string | null> {
    const filename = `certificates/${certificateId}.html`;
    const obj = await this.storage.get(filename);
    if (obj) {
      return await obj.text();
    }
    return null;
  }
}
