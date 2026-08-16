/**
 * Issuing and verifying an ownership certificate.
 *
 * The arithmetic and wording are covered by src/lib/certificate-document.test.ts.
 * What is tested here is that the certificate persists what it claimed and
 * still claims it later — a certificate that reads differently a month after
 * issue is not a certificate.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CertificateService } from '../../src/services/certificate.service';
import { createTestD1, type TestD1 } from '../helpers/real-d1';

const asD1 = (db: TestD1) => db as unknown as D1Database;

/** In-memory R2 double: enough of the surface the service uses. */
function makeStorage() {
  const objects = new Map<string, { body: string | Uint8Array }>();
  return {
    objects,
    bucket: {
      put: async (key: string, body: string | Uint8Array | ArrayBuffer) => {
        objects.set(key, { body: body instanceof ArrayBuffer ? new Uint8Array(body) : body });
        return undefined;
      },
      get: async (key: string) => {
        const found = objects.get(key);
        if (!found) return null;
        return {
          text: async () => (typeof found.body === 'string' ? found.body : ''),
          arrayBuffer: async () =>
            typeof found.body === 'string'
              ? new TextEncoder().encode(found.body).buffer
              : (found.body.buffer as ArrayBuffer),
        };
      },
    } as unknown as R2Bucket,
  };
}

const makeCache = () =>
  ({
    get: async () => null,
    put: async () => undefined,
    delete: async () => undefined,
  }) as unknown as KVNamespace;

const holder = {
  userName: 'Awa Ouédraogo',
  userEmail: 'awa@example.bf',
  userId: 'user-1',
  kycLevel: 'VERIFIED',
};

describe('CertificateService (real D1)', () => {
  let db: TestD1;
  let storage: ReturnType<typeof makeStorage>;
  let svc: CertificateService;

  beforeEach(() => {
    db = createTestD1();
    storage = makeStorage();
    svc = new CertificateService(asD1(db), storage.bucket, makeCache());
  });

  it('stores both the HTML view and the downloadable PDF', async () => {
    const cert = await svc.issueCertificate({
      ...holder,
      tokenBalance: 120.5,
      equivalentGrams: 120.5,
      leasedBalance: 0,
    });

    expect(storage.objects.has(`certificates/${cert.certificateId}.html`)).toBe(true);
    expect(storage.objects.has(`certificates/${cert.certificateId}.pdf`)).toBe(true);

    const pdf = await svc.getCertificatePdf(cert.certificateId);
    expect(pdf).not.toBeNull();
    expect(new TextDecoder().decode(new Uint8Array(pdf!).slice(0, 8))).toContain('%PDF-1.4');
  });

  it('persists the leased grams instead of recomputing them later', async () => {
    const cert = await svc.issueCertificate({
      ...holder,
      tokenBalance: 20,
      equivalentGrams: 20,
      leasedBalance: 100,
    });

    const row = db.sqlite
      .prepare('SELECT token_balance, leased_balance FROM certificates WHERE id = ?')
      .get(cert.certificateId) as { token_balance: number; leased_balance: number };

    // Recomputing from today's positions would make a past certificate change
    // over time — the one thing a certificate must not do.
    expect(row).toMatchObject({ token_balance: 20, leased_balance: 100 });
  });

  it('reports both figures and the total when verified', async () => {
    const cert = await svc.issueCertificate({
      ...holder,
      tokenBalance: 20,
      equivalentGrams: 20,
      leasedBalance: 100,
    });

    const result = await svc.verifyCertificate(cert.verificationCode);
    expect(result.valid).toBe(true);
    expect(result.certificate).toMatchObject({
      tokenBalance: 20,
      leasedBalance: 100,
      totalOwnedGrams: 120,
      holderName: 'Awa Ouédraogo',
    });
  });

  it('certifies a holder whose gold is entirely in a lease', async () => {
    // The wallet is empty but 100 g are owned. A certificate reading "0 g"
    // would be wrong about exactly the holders using the product most.
    const cert = await svc.issueCertificate({
      ...holder,
      tokenBalance: 0,
      equivalentGrams: 0,
      leasedBalance: 100,
    });

    const result = await svc.verifyCertificate(cert.verificationCode);
    expect(result.certificate).toMatchObject({ tokenBalance: 0, totalOwnedGrams: 100 });
  });

  it('accepts the verification code however it was typed', async () => {
    const cert = await svc.issueCertificate({
      ...holder,
      tokenBalance: 10,
      equivalentGrams: 10,
      leasedBalance: 0,
    });

    expect((await svc.verifyCertificate(cert.verificationCode.toLowerCase())).valid).toBe(true);
    expect((await svc.verifyCertificate(`  ${cert.verificationCode}  `)).valid).toBe(true);
  });

  it('refuses an unknown code without saying whether it could exist', async () => {
    const result = await svc.verifyCertificate('BF-ZZZZ-ZZZZ');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('introuvable');
  });

  it('refuses a revoked certificate', async () => {
    const cert = await svc.issueCertificate({
      ...holder,
      tokenBalance: 10,
      equivalentGrams: 10,
      leasedBalance: 0,
    });
    db.sqlite.prepare("UPDATE certificates SET status = 'REVOKED' WHERE id = ?").run(
      cert.certificateId
    );

    expect(await svc.verifyCertificate(cert.verificationCode)).toMatchObject({ valid: false });
  });

  it('counts verifications, so an unusual number of checks is visible', async () => {
    const cert = await svc.issueCertificate({
      ...holder,
      tokenBalance: 10,
      equivalentGrams: 10,
      leasedBalance: 0,
    });

    await svc.verifyCertificate(cert.verificationCode);
    const second = await svc.verifyCertificate(cert.verificationCode);
    expect(second.certificate?.verificationCount).toBe(2);
  });

  it('issues a distinct verification code each time', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const cert = await svc.issueCertificate({
        ...holder,
        tokenBalance: 1,
        equivalentGrams: 1,
        leasedBalance: 0,
      });
      codes.add(cert.verificationCode);
    }
    expect(codes.size).toBe(10);
    // No ambiguous glyphs: a code is read aloud and typed by hand.
    for (const code of codes) expect(code).toMatch(/^BF-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it('returns null for a certificate that has no PDF stored', async () => {
    expect(await svc.getCertificatePdf('CERT-does-not-exist')).toBeNull();
  });
});
