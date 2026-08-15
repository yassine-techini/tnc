import { describe, it, expect } from 'vitest';
import {
  sniffImageType,
  sniffDocumentType,
  extensionFor,
  isOwnedConsignmentPhotoKey,
  consignmentPhotoPrefix,
  isOwnedProducerDocumentKey,
  producerDocumentPrefix,
} from './image-upload';

function bytes(...values: number[]): ArrayBuffer {
  // Pad to 12 bytes so the length guard doesn't reject valid short fixtures.
  const b = new Uint8Array(16);
  b.set(values);
  return b.buffer;
}

describe('sniffImageType', () => {
  it('identifies JPEG, PNG and WebP from their magic bytes', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe(
      'image/webp'
    );
  });

  it('rejects content that is not one of the three formats', () => {
    // An HTML document a client might upload while declaring "image/jpeg".
    const html = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');
    expect(sniffImageType(html.buffer as ArrayBuffer)).toBeNull();
    // A PDF.
    expect(sniffImageType(bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBeNull();
    // RIFF container that is not WebP (e.g. a WAV).
    expect(
      sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45))
    ).toBeNull();
  });

  it('rejects input too short to carry a signature', () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]).buffer as ArrayBuffer)).toBeNull();
  });

  it('maps a sniffed type to its extension', () => {
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('image/png')).toBe('png');
    expect(extensionFor('image/webp')).toBe('webp');
  });
});

describe('sniffDocumentType', () => {
  it('accepts a PDF, which sniffImageType rejects', () => {
    const pdf = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37);
    expect(sniffImageType(pdf)).toBeNull();
    expect(sniffDocumentType(pdf)).toBe('application/pdf');
    expect(extensionFor('application/pdf')).toBe('pdf');
  });

  it('still accepts the image formats', () => {
    expect(sniffDocumentType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
  });

  it('rejects anything else', () => {
    const doc = new TextEncoder().encode('PK fake docx payload here');
    expect(sniffDocumentType(doc.buffer as ArrayBuffer)).toBeNull();
  });
});

describe('isOwnedProducerDocumentKey', () => {
  const OWNER = 'user-1';

  it('accepts a key under the producer own prefix', () => {
    expect(isOwnedProducerDocumentKey(`${producerDocumentPrefix(OWNER)}1699_ab12cd34.pdf`, OWNER)).toBe(true);
  });

  it('keeps KYB documents and consignment photos in separate namespaces', () => {
    // A consignment photo key must not pass as a KYB document, and vice versa.
    expect(isOwnedProducerDocumentKey(`consignments/${OWNER}/x.jpg`, OWNER)).toBe(false);
    expect(isOwnedConsignmentPhotoKey(`producers/${OWNER}/x.pdf`, OWNER)).toBe(false);
  });

  it('rejects another producer documents and traversal', () => {
    expect(isOwnedProducerDocumentKey('producers/user-2/rccm.pdf', OWNER)).toBe(false);
    expect(isOwnedProducerDocumentKey(`producers/${OWNER}/../../kyc/user-2/front.jpg`, OWNER)).toBe(false);
  });
});

describe('isOwnedConsignmentPhotoKey', () => {
  const OWNER = 'user-1';

  it('accepts a key under the producer own prefix', () => {
    expect(
      isOwnedConsignmentPhotoKey(`${consignmentPhotoPrefix(OWNER)}1699_ab12cd34.jpg`, OWNER)
    ).toBe(true);
  });

  it('rejects another user KYC document in the same bucket', () => {
    expect(isOwnedConsignmentPhotoKey('kyc/user-2/front_1699999999.jpg', OWNER)).toBe(false);
  });

  it('rejects another producer photos', () => {
    expect(isOwnedConsignmentPhotoKey('consignments/user-2/1699_ab12cd34.jpg', OWNER)).toBe(false);
  });

  it('rejects a prefix that is only a lookalike', () => {
    // `consignments/user-10/` must not pass as `consignments/user-1/`.
    expect(isOwnedConsignmentPhotoKey('consignments/user-10/x.jpg', 'user-1')).toBe(false);
  });

  it('rejects traversal out of the prefix', () => {
    expect(
      isOwnedConsignmentPhotoKey(`consignments/${OWNER}/../../kyc/user-2/front.jpg`, OWNER)
    ).toBe(false);
  });

  it('rejects non-string and oversized keys', () => {
    expect(isOwnedConsignmentPhotoKey(null, OWNER)).toBe(false);
    expect(isOwnedConsignmentPhotoKey(42, OWNER)).toBe(false);
    expect(isOwnedConsignmentPhotoKey({}, OWNER)).toBe(false);
    expect(
      isOwnedConsignmentPhotoKey(`${consignmentPhotoPrefix(OWNER)}${'a'.repeat(300)}.jpg`, OWNER)
    ).toBe(false);
  });
});
