-- Le schema refusait les documents que la configuration declare — constat AI.
--
-- `country_config.id_document_types` decrit les pieces acceptees pays par pays.
-- La colonne qui les recoit etait figee sur celles d'un seul :
--
--     CHECK (document_type IN ('CNIB', 'PASSPORT', 'PERMIT', 'CEDEAO'))
--
-- Confronte aux valeurs deja semees : `CNI` — la carte nationale de la Cote
-- d'Ivoire, du Mali et du Senegal — etait refusee, et sur les quatre documents
-- ougandais seul le passeport passait. Un Ougandais sans passeport ne pouvait
-- pas faire de KYC du tout.
--
-- La contrainte est anterieure a `country_config` : le travail par pays a ete
-- fait, la colonne qu'il alimente est restee derriere.
--
-- POURQUOI PAS UNE LISTE PLUS LARGE. Enumerer l'union de tous les pays ramenerait
-- une migration a chaque nouveau pays, ce qui est exactement ce que
-- `country_config` existe pour eviter. Et un CHECK ne peut pas interroger une
-- autre table.
--
-- Ce qui reste dans la base est ce qui vaut pour TOUS les pays : un jeton non
-- vide, en majuscules, sans espace. L'appartenance a la liste du pays est
-- verifiee au depot, la ou le pays de l'utilisateur est connu, avec un message
-- qui NOMME les documents acceptes.

CREATE TABLE kyc_documents_new (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    /**
     * Le type declare par le pays de l'utilisateur (`country_config`).
     * La base garde la FORME ; l'appartenance est verifiee au depot.
     */
    document_type TEXT NOT NULL CHECK (
      length(document_type) BETWEEN 2 AND 40
      AND document_type = upper(document_type)
      AND instr(document_type, ' ') = 0
    ),
    document_number TEXT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    date_of_birth TEXT NOT NULL,
    nationality TEXT NOT NULL,
    address TEXT,
    city TEXT,
    front_image_url TEXT NOT NULL,
    back_image_url TEXT,
    selfie_url TEXT NOT NULL,
    status TEXT DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'PROCESSING', 'VERIFIED', 'REJECTED')),
    provider_job_id TEXT,
    provider_result TEXT, -- JSON
    rejection_reason TEXT,
    reviewed_by TEXT REFERENCES admins(id),
    reviewed_at TEXT,
    document_expiry_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO kyc_documents_new
  SELECT id, user_id, document_type, document_number, first_name, last_name,
         date_of_birth, nationality, address, city, front_image_url,
         back_image_url, selfie_url, status, provider_job_id, provider_result,
         rejection_reason, reviewed_by, reviewed_at, document_expiry_date,
         created_at, updated_at
  FROM kyc_documents;

DROP TABLE kyc_documents;
ALTER TABLE kyc_documents_new RENAME TO kyc_documents;

CREATE INDEX IF NOT EXISTS idx_kyc_documents_user ON kyc_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_documents_status ON kyc_documents(status);
