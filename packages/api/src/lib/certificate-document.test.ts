import { describe, it, expect } from 'vitest';
import {
  buildCertificateDocument,
  totalOwnedGrams,
  type CertificateDocumentInput,
} from './certificate-document';
import { renderPdf } from './pdf';

const base: CertificateDocumentInput = {
  certificateId: 'CERT-1755000000000-AB12CD34',
  verificationCode: 'BF-7K3M-P9QR',
  holderName: 'Awa Ouédraogo',
  holderEmail: 'awa@example.bf',
  kycLevel: 'VERIFIED',
  walletGrams: 120.5,
  leasedGrams: 0,
  issuedAt: '2026-08-16T09:30:00Z',
  verifyUrl: 'https://app.tnc-trading.com/verify',
  platformName: 'TNC Trading',
};

const text = (doc: ReturnType<typeof buildCertificateDocument>) => JSON.stringify(doc.blocks);

describe('totalOwnedGrams', () => {
  it('counts leased grams as owned — they left the wallet, not the holder', () => {
    expect(totalOwnedGrams({ walletGrams: 120.5, leasedGrams: 100 })).toBe(220.5);
  });

  it('rounds to the milligram', () => {
    expect(totalOwnedGrams({ walletGrams: 0.0004, leasedGrams: 0.0004 })).toBe(0.001);
  });
});

describe('buildCertificateDocument', () => {
  it('states the holder and the quantity', () => {
    const body = text(buildCertificateDocument(base));
    expect(body).toContain('Awa Ouédraogo');
    expect(body).toContain('120.500 g');
    expect(body).toContain('BF-7K3M-P9QR');
    expect(body).toContain('CERT-1755000000000-AB12CD34');
  });

  it('never prints a value — only a weight', () => {
    const body = text(buildCertificateDocument(base));
    // Gold moves; a valuation printed today is wrong tomorrow.
    expect(body).not.toMatch(/XOF|FCFA|USD|\$/);
    expect(body).toContain("jamais d'une valeur");
  });

  it('separates leased grams from grams in the wallet', () => {
    const body = text(buildCertificateDocument({ ...base, walletGrams: 120.5, leasedGrams: 100 }));

    expect(body).toContain('120.500 g'); // in the wallet
    expect(body).toContain('100.000 g'); // lent out
    expect(body).toContain('220.500 g'); // total owned
    // And says what the difference means, rather than leaving two numbers to
    // be read as interchangeable.
    expect(body).toContain('prêtée à une contrepartie');
    expect(body).toContain('ne peut être vendue');
  });

  it('does not mention leasing at all when nothing is lent', () => {
    // A holder who never used the product should not be shown a warning about it.
    const body = text(buildCertificateDocument(base));
    expect(body).not.toContain('location');
    expect(body).not.toContain('prêtée');
  });

  it('certifies a holding made entirely of leased gold', () => {
    // The wallet is empty but the holder owns 100 g — the certificate must not
    // read as "0 g".
    const body = text(buildCertificateDocument({ ...base, walletGrams: 0, leasedGrams: 100 }));
    expect(body).toContain('100.000 g');
    expect(body).toContain('prêtée à une contrepartie');
  });

  it('formats the date without depending on the ICU data of the runtime', () => {
    expect(text(buildCertificateDocument(base))).toContain('16 août 2026');
  });

  it('spells out the KYC level rather than leaking the internal code', () => {
    expect(text(buildCertificateDocument(base))).toContain('identité et justificatifs vérifiés');
    expect(text(buildCertificateDocument({ ...base, kycLevel: 'STANDARD' }))).toContain(
      'identité vérifiée'
    );
    // An unknown level falls back to the raw code instead of rendering blank.
    expect(text(buildCertificateDocument({ ...base, kycLevel: 'FUTURE' }))).toContain('FUTURE');
  });

  it('says the certificate is a snapshot, not a permanent statement', () => {
    const body = text(buildCertificateDocument(base));
    expect(body).toContain("date d'émission");
    expect(body).toContain('ne vaut pas pour une date ultérieure');
  });

  it('carries the verification code in the footer, on every page', () => {
    const doc = buildCertificateDocument(base);
    expect(doc.footer).toContain('BF-7K3M-P9QR');
    expect(doc.footer).toContain('https://app.tnc-trading.com/verify');
  });

  it('renders to a real PDF with the accents intact', () => {
    const pdf = renderPdf(buildCertificateDocument(base));
    const raw = Array.from(pdf, (b) => String.fromCharCode(b)).join('');

    expect(raw.startsWith('%PDF-1.4')).toBe(true);
    expect(raw).toContain('%%EOF');
    // "Ouédraogo" must not come out as "Ou?draogo" on a legal document.
    expect(raw).not.toContain('Ou?draogo');
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });
});
