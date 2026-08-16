/**
 * Origin documents attached to a gold lot.
 *
 * The "certified route" claim rests on being able to say where a lot came from
 * and under what authority it was mined. Photos illustrate; a certificate of
 * origin and a mining declaration establish. These are typed legal documents
 * with an issuer and a number, so they get their own table rather than joining
 * the photo array.
 */
import { z } from 'zod';

export const DOCUMENT_TYPES = [
  'CERTIFICATE_OF_ORIGIN',
  'MINING_DECLARATION',
  'TRANSPORT_DOCUMENT',
  'ASSAY_REPORT',
  'OTHER',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  CERTIFICATE_OF_ORIGIN: "Certificat d'origine",
  MINING_DECLARATION: 'Déclaration minière',
  TRANSPORT_DOCUMENT: 'Document de transport',
  ASSAY_REPORT: "Rapport d'essai",
  OTHER: 'Autre',
};

/** Kept with the service so the wire contract and the consumed type cannot drift. */
export const attachDocumentSchema = z.object({
  docType: z.enum(DOCUMENT_TYPES),
  key: z.string().max(256),
  issuer: z.string().max(150).optional(),
  reference: z.string().max(100).optional(),
  issuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type AttachDocumentInput = z.infer<typeof attachDocumentSchema>;

export interface ConsignmentDocumentRow {
  id: string;
  consignment_id: string;
  doc_type: DocumentType;
  issuer: string | null;
  reference: string | null;
  issued_at: string | null;
  r2_key: string;
  uploaded_by: string;
  created_at: string;
}

export class ConsignmentDocumentService {
  constructor(private db: D1Database) {}

  async attach(
    consignmentId: string,
    uploadedBy: string,
    p: AttachDocumentInput
  ): Promise<ConsignmentDocumentRow | null> {
    const id = crypto.randomUUID();
    try {
      await this.db
        .prepare(
          `INSERT INTO consignment_documents
             (id, consignment_id, doc_type, issuer, reference, issued_at, r2_key, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          consignmentId,
          p.docType,
          p.issuer ?? null,
          p.reference ?? null,
          p.issuedAt ?? null,
          p.key,
          uploadedBy
        )
        .run();
    } catch {
      // r2_key is UNIQUE: attaching the same upload twice is a no-op, not a
      // duplicate row that would double-count the evidence.
      return null;
    }
    return this.getById(id);
  }

  async getById(id: string): Promise<ConsignmentDocumentRow | null> {
    const row = await this.db
      .prepare('SELECT * FROM consignment_documents WHERE id = ?')
      .bind(id)
      .first<ConsignmentDocumentRow>();
    return row || null;
  }

  async listForConsignment(consignmentId: string): Promise<ConsignmentDocumentRow[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM consignment_documents WHERE consignment_id = ?
         ORDER BY created_at ASC`
      )
      .bind(consignmentId)
      .all<ConsignmentDocumentRow>();
    return rows.results || [];
  }

  /**
   * Which required origin documents are missing.
   *
   * Reported rather than enforced at submission: a producer in the field may
   * legitimately photograph the lot before the paperwork is issued. The gap is
   * made visible to the forwarder and to the State instead of blocking the
   * declaration.
   */
  async missingRequired(consignmentId: string): Promise<DocumentType[]> {
    const present = new Set((await this.listForConsignment(consignmentId)).map((d) => d.doc_type));
    const required: DocumentType[] = ['CERTIFICATE_OF_ORIGIN', 'MINING_DECLARATION'];
    return required.filter((t) => !present.has(t));
  }
}
