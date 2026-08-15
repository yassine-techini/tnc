-- ============================================
-- 0019 Producer KYB (know your business)
-- A producer may be an individual orpailleur or a legal entity (cooperative,
-- company). kyc_documents cannot describe an entity: first_name, last_name,
-- date_of_birth, nationality and selfie_url are all NOT NULL there, and the
-- document types are national ID cards. So consigning a lot as a cooperative was
-- impossible — the KYC >= STANDARD gate on submission could never be satisfied.
--
-- A cooperative is a single producer account held by its manager (no per-member
-- access), so this is one profile row per user, not an organisation graph.
-- ============================================

CREATE TABLE IF NOT EXISTS producer_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('INDIVIDUAL', 'COOPERATIVE', 'COMPANY')),

  legal_name TEXT NOT NULL,
  registration_number TEXT,        -- RCCM
  mining_authorization TEXT,       -- autorisation d'exploitation
  tax_id TEXT,                     -- IFU

  address TEXT,
  city TEXT,
  region TEXT,
  country TEXT NOT NULL DEFAULT 'BF',

  representative_name TEXT NOT NULL,
  representative_role TEXT,
  representative_phone TEXT,

  documents TEXT,                  -- JSON array of R2 keys, encrypted at rest

  status TEXT NOT NULL DEFAULT 'SUBMITTED'
    CHECK (status IN ('SUBMITTED', 'PROCESSING', 'VERIFIED', 'REJECTED')),
  rejection_reason TEXT,
  reviewed_by TEXT REFERENCES admins(id),
  reviewed_at TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_producer_profiles_status ON producer_profiles(status);
CREATE INDEX IF NOT EXISTS idx_producer_profiles_entity ON producer_profiles(entity_type);

-- KYC level granted to a producer whose KYB is approved. STANDARD is the lowest
-- level that can sell (KYC_LIMITS), which a producer must be able to do since
-- consignments are paid in tokens.
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('producer_kyb_granted_level', 'STANDARD', 'Niveau KYC accordé à un producteur dont le KYB est validé (STANDARD|VERIFIED)');
