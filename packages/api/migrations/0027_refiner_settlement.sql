-- ============================================
-- 0027 Refiner corridor and two-step settlement
--
-- Two additions for the refiner track:
--
-- 1. A REFINER entity type with its corridor (origin -> destination), because a
--    refiner is not a producer: it does not extract, it receives and refines.
--
-- 2. Settlement in two steps — an advance when the lot is received in Dubai,
--    the balance at outturn (audit validation).
--
-- THE INVARIANT PROBLEM, and how it is handled.
--
-- Gold is allocated to the reserve at audit validation. Paying an ADVANCE IN
-- TOKENS at arrival would therefore mint claims against gold not yet counted,
-- breaking `tokens_issued <= total_allocated` — the invariant everything else in
-- this codebase protects.
--
-- So a token advance allocates its own weight at the same moment. That is
-- honest: at ARRIVED_DUBAI the metal is physically in the vault and its receipt
-- verified. It is counted conservatively (the advance share only), and the
-- remainder is allocated at outturn once assayed. Every intermediate state keeps
-- the invariant true.
--
-- An advance in XOF raises none of this: no token is issued.
-- ============================================

PRAGMA foreign_keys = OFF;

-- SQLite cannot ALTER a CHECK, so producer_profiles is rebuilt to admit REFINER.
CREATE TABLE producer_profiles_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('INDIVIDUAL', 'COOPERATIVE', 'COMPANY', 'REFINER')),

  legal_name TEXT NOT NULL,
  registration_number TEXT,
  mining_authorization TEXT,
  tax_id TEXT,

  address TEXT,
  city TEXT,
  region TEXT,
  country TEXT NOT NULL DEFAULT 'BF',

  -- Corridor: where the metal comes from, where it is refined. Only meaningful
  -- for a REFINER; NULL for the extraction-side profiles.
  corridor_origin_country TEXT,
  corridor_destination_country TEXT,

  representative_name TEXT NOT NULL,
  representative_role TEXT,
  representative_phone TEXT,

  documents TEXT,

  status TEXT NOT NULL DEFAULT 'SUBMITTED'
    CHECK (status IN ('SUBMITTED', 'PROCESSING', 'VERIFIED', 'REJECTED')),
  rejection_reason TEXT,
  reviewed_by TEXT REFERENCES admins(id),
  reviewed_at TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO producer_profiles_new (
  id, user_id, entity_type, legal_name, registration_number, mining_authorization,
  tax_id, address, city, region, country, representative_name, representative_role,
  representative_phone, documents, status, rejection_reason, reviewed_by, reviewed_at,
  created_at, updated_at
)
SELECT
  id, user_id, entity_type, legal_name, registration_number, mining_authorization,
  tax_id, address, city, region, country, representative_name, representative_role,
  representative_phone, documents, status, rejection_reason, reviewed_by, reviewed_at,
  created_at, updated_at
FROM producer_profiles;

DROP TABLE producer_profiles;
ALTER TABLE producer_profiles_new RENAME TO producer_profiles;

CREATE INDEX IF NOT EXISTS idx_producer_profiles_status ON producer_profiles(status);
CREATE INDEX IF NOT EXISTS idx_producer_profiles_entity ON producer_profiles(entity_type);

PRAGMA foreign_keys = ON;

-- Settlement state carried on the lot itself.
ALTER TABLE gold_consignments ADD COLUMN advance_tokens_g REAL;
ALTER TABLE gold_consignments ADD COLUMN advance_cash_xof REAL;
ALTER TABLE gold_consignments ADD COLUMN advance_paid_at TEXT;
ALTER TABLE gold_consignments ADD COLUMN advance_price_per_gram REAL;
ALTER TABLE gold_consignments ADD COLUMN balance_tokens_g REAL;
ALTER TABLE gold_consignments ADD COLUMN balance_cash_xof REAL;
ALTER TABLE gold_consignments ADD COLUMN balance_paid_at TEXT;

INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('settlement_advance_percent', '0.75', "Part du lot versée en acompte à la réception à Dubaï (0..1)"),
    ('settlement_advance_currency', 'TOKENS', "Devise de l'acompte : TOKENS ou XOF"),
    ('settlement_advance_haircut', '0.90', "Décote appliquée au poids déclaré pour estimer l'acompte (prudence avant essai)");
