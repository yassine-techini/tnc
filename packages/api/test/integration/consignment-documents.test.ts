/**
 * Origin documents attached to a lot — the evidence behind the "certified
 * route" claim.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConsignmentDocumentService } from '../../src/services/consignment-document.service';
import { isOwnedConsignmentDocumentKey, consignmentDocumentPrefix, isOwnedConsignmentPhotoKey } from '../../src/lib/image-upload';
import { createTestD1, type TestD1 } from '../helpers/real-d1';

const asD1 = (db: TestD1) => db as unknown as D1Database;
const PRODUCER = 'prod-1';
const LOT = 'lot-1';

describe('ConsignmentDocumentService (real D1)', () => {
  let db: TestD1;
  let svc: ConsignmentDocumentService;

  beforeEach(() => {
    db = createTestD1();
    db.sqlite
      .prepare(
        `INSERT INTO gold_consignments (id, reference, producer_id, weight_declared_g, purity_declared, gold_type, status)
         VALUES (?, 'CONS-AAAA1111', ?, 1000, 0.916, 'nuggets', 'SUBMITTED')`
      )
      .run(LOT, PRODUCER);
    svc = new ConsignmentDocumentService(asD1(db));
  });

  it('attaches a typed document with its issuer and reference', async () => {
    const doc = await svc.attach(LOT, PRODUCER, {
      docType: 'CERTIFICATE_OF_ORIGIN',
      key: `${consignmentDocumentPrefix(PRODUCER)}cert.pdf`,
      issuer: 'Ministère des Mines',
      reference: 'CO-2026-0042',
      issuedAt: '2026-08-01',
    });

    expect(doc).toMatchObject({
      doc_type: 'CERTIFICATE_OF_ORIGIN',
      issuer: 'Ministère des Mines',
      reference: 'CO-2026-0042',
      issued_at: '2026-08-01',
    });
    expect(await svc.listForConsignment(LOT)).toHaveLength(1);
  });

  it('refuses to attach the same upload twice', async () => {
    const key = `${consignmentDocumentPrefix(PRODUCER)}cert.pdf`;
    expect(await svc.attach(LOT, PRODUCER, { docType: 'CERTIFICATE_OF_ORIGIN', key })).toBeTruthy();
    // Double-counting the same file would overstate the evidence behind a lot.
    expect(await svc.attach(LOT, PRODUCER, { docType: 'MINING_DECLARATION', key })).toBeNull();
    expect(await svc.listForConsignment(LOT)).toHaveLength(1);
  });

  it('reports which required documents are missing rather than blocking', async () => {
    // A producer in the field may photograph the lot before the paperwork
    // exists; the gap is surfaced, not used to refuse the declaration.
    expect(await svc.missingRequired(LOT)).toEqual(['CERTIFICATE_OF_ORIGIN', 'MINING_DECLARATION']);

    await svc.attach(LOT, PRODUCER, {
      docType: 'CERTIFICATE_OF_ORIGIN',
      key: `${consignmentDocumentPrefix(PRODUCER)}a.pdf`,
    });
    expect(await svc.missingRequired(LOT)).toEqual(['MINING_DECLARATION']);

    await svc.attach(LOT, PRODUCER, {
      docType: 'MINING_DECLARATION',
      key: `${consignmentDocumentPrefix(PRODUCER)}b.pdf`,
    });
    expect(await svc.missingRequired(LOT)).toEqual([]);
  });

  it('keeps documents attached to their own lot', async () => {
    db.sqlite
      .prepare(
        `INSERT INTO gold_consignments (id, reference, producer_id, weight_declared_g, purity_declared, gold_type, status)
         VALUES ('lot-2', 'CONS-BBBB2222', ?, 500, 0.916, 'bar', 'SUBMITTED')`
      )
      .run(PRODUCER);

    await svc.attach(LOT, PRODUCER, {
      docType: 'ASSAY_REPORT',
      key: `${consignmentDocumentPrefix(PRODUCER)}a.pdf`,
    });

    expect(await svc.listForConsignment(LOT)).toHaveLength(1);
    expect(await svc.listForConsignment('lot-2')).toHaveLength(0);
  });
});

describe('document key namespace', () => {
  it('accepts a key under the producer own document prefix', () => {
    expect(isOwnedConsignmentDocumentKey(`consignment-docs/${PRODUCER}/a.pdf`, PRODUCER)).toBe(true);
  });

  it('does not let another producer documents in', () => {
    expect(isOwnedConsignmentDocumentKey('consignment-docs/other/a.pdf', PRODUCER)).toBe(false);
    expect(isOwnedConsignmentDocumentKey('kyc/other/front.jpg', PRODUCER)).toBe(false);
  });

  it('keeps lot documents and lot photos in separate namespaces', () => {
    // A photo key must not pass as an origin document, nor the reverse.
    expect(isOwnedConsignmentDocumentKey(`consignments/${PRODUCER}/x.jpg`, PRODUCER)).toBe(false);
    expect(isOwnedConsignmentPhotoKey(`consignment-docs/${PRODUCER}/x.pdf`, PRODUCER)).toBe(false);
  });
});
