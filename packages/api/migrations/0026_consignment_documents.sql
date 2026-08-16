-- ============================================
-- 0026 Origin documents attached to a lot
--
-- The "certified route" pitch rests on being able to say where a lot came from
-- and under what authority it was mined. Photos alone do not establish that:
-- a certificate of origin and a mining declaration do.
--
-- Stored like KYB documents — encrypted at rest, fail-closed, keys scoped to the
-- producer — rather than in the `photos` JSON array, because these are typed
-- legal documents with an issuer and a number, not illustrations.
-- ============================================

CREATE TABLE IF NOT EXISTS consignment_documents (
  id TEXT PRIMARY KEY,
  consignment_id TEXT NOT NULL REFERENCES gold_consignments(id) ON DELETE CASCADE,

  doc_type TEXT NOT NULL CHECK (doc_type IN (
    'CERTIFICATE_OF_ORIGIN',   -- certificat d'origine
    'MINING_DECLARATION',      -- déclaration minière
    'TRANSPORT_DOCUMENT',      -- lettre de transport / connaissement
    'ASSAY_REPORT',            -- rapport d'essai
    'OTHER'
  )),
  -- Issuer and reference as printed on the document, so a controller can match
  -- the record against the paper without opening the file.
  issuer TEXT,
  reference TEXT,
  issued_at TEXT,

  r2_key TEXT NOT NULL UNIQUE,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_consignment_documents_consignment
  ON consignment_documents(consignment_id);
CREATE INDEX IF NOT EXISTS idx_consignment_documents_type
  ON consignment_documents(doc_type);

-- Origin captured on the lot itself. `origin_verified` records HOW the position
-- was obtained: a device fix is evidence, a hand-typed zone is a declaration.
-- Conflating the two would let a manual entry pass for a GPS reading.
ALTER TABLE gold_consignments ADD COLUMN origin_zone TEXT;
ALTER TABLE gold_consignments ADD COLUMN origin_verified INTEGER NOT NULL DEFAULT 0;
