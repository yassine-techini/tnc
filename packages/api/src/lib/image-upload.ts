/**
 * Upload helpers shared by the KYC and consignment photo endpoints.
 *
 * `file.type` on a multipart part is just a header the client wrote — it is not
 * evidence of anything. These helpers decide the content type from the bytes.
 */

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/**
 * Identify an image from its magic bytes. Returns null for anything that is not
 * a JPEG, PNG or WebP — including a file whose declared MIME type says otherwise.
 */
export function sniffImageType(buf: ArrayBuffer): AllowedImageType | null {
  const b = new Uint8Array(buf);
  if (b.length < 12) return null;

  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

/**
 * Same as sniffImageType, plus PDF — company records (RCCM extract, mining
 * authorization, articles of association) are normally PDFs, not photos.
 */
export function sniffDocumentType(buf: ArrayBuffer): AllowedImageType | 'application/pdf' | null {
  const b = new Uint8Array(buf);
  // PDF: "%PDF-"
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) {
    return 'application/pdf';
  }
  return sniffImageType(buf);
}

/** File extension matching a sniffed type — never derived from the client filename. */
export function extensionFor(type: AllowedImageType | 'application/pdf'): string {
  return type === 'image/jpeg'
    ? 'jpg'
    : type === 'image/png'
      ? 'png'
      : type === 'application/pdf'
        ? 'pdf'
        : 'webp';
}

/** The R2 key prefix a producer's consignment photos must live under. */
export function consignmentPhotoPrefix(producerId: string): string {
  return `consignments/${producerId}/`;
}

/**
 * Whether an R2 key is one this producer may reference or read.
 *
 * Photo keys travel through the client (upload returns a key, submission sends it
 * back), so they are untrusted input: without this check a producer could
 * reference `kyc/<someone-else>/...` and stream it back out of the same bucket.
 * `..` is rejected so a key can never climb out of its own prefix.
 */
export function isOwnedConsignmentPhotoKey(key: unknown, producerId: string): key is string {
  return isOwnedKey(key, consignmentPhotoPrefix(producerId));
}

/** The R2 key prefix a producer's KYB documents must live under. */
export function producerDocumentPrefix(producerId: string): string {
  return `producers/${producerId}/`;
}

/** Whether an R2 key is a KYB document this producer may reference or read. */
export function isOwnedProducerDocumentKey(key: unknown, producerId: string): key is string {
  return isOwnedKey(key, producerDocumentPrefix(producerId));
}

/** The R2 key prefix a producer's lot origin documents must live under. */
export function consignmentDocumentPrefix(producerId: string): string {
  return `consignment-docs/${producerId}/`;
}

/** Whether an R2 key is a lot document this producer may reference or read. */
export function isOwnedConsignmentDocumentKey(key: unknown, producerId: string): key is string {
  return isOwnedKey(key, consignmentDocumentPrefix(producerId));
}

function isOwnedKey(key: unknown, prefix: string): key is string {
  return (
    typeof key === 'string' && key.length <= 256 && key.startsWith(prefix) && !key.includes('..')
  );
}
