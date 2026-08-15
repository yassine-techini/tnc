-- ============================================
-- 0017 Gold consignment (export) workflow
-- Producer submits a physical gold lot -> Transitaire (freight forwarder)
-- validates the operation -> transport -> ARRIVED_DUBAI -> a separate audit
-- validation allocates the refined weight to gold_stock (tokenizable backing).
-- ============================================

-- 1. Producer role on users. Existing users are investors/buyers ('investor');
--    producers are onboarded with role 'producer'.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'investor';
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 2. Add TRANSITAIRE and DUBAI_VALIDATOR admin roles. SQLite cannot ALTER a
--    CHECK constraint, so the admins table is rebuilt preserving all data.
--
--    Eight columns reference admins(id) — audit_logs.admin_id,
--    kyc_documents.reviewed_by, withdrawals.approved_by, por_reports.verified_by,
--    system_config.updated_by, admin_permissions.admin_id, integrations.updated_by,
--    blocked_ips.blocked_by. With foreign keys enforced, DROP TABLE performs an
--    implicit DELETE and those rows fail the constraint, aborting the migration
--    midway. `defer_foreign_keys` does NOT help — verified against a real SQLite
--    engine, it fails identically inside and outside an explicit transaction.
--    Enforcement has to be off across the rebuild; ids are preserved, so every
--    reference resolves again once the rename lands.
PRAGMA foreign_keys = OFF;

CREATE TABLE admins_new (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'KYC_REVIEWER', 'FINANCE', 'SUPPORT', 'STATE_OPERATOR', 'TRANSITAIRE', 'DUBAI_VALIDATOR')),
  password_hash TEXT,
  cloudflare_access_id TEXT,
  two_factor_enabled INTEGER DEFAULT 1,
  two_factor_secret TEXT,
  active INTEGER DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO admins_new (id, email, name, role, password_hash, cloudflare_access_id, two_factor_enabled, two_factor_secret, active, last_login_at, created_at, updated_at)
  SELECT id, email, name, role, password_hash, cloudflare_access_id, two_factor_enabled, two_factor_secret, active, last_login_at, created_at, updated_at FROM admins;
DROP TABLE admins;
ALTER TABLE admins_new RENAME TO admins;
CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email);
CREATE INDEX IF NOT EXISTS idx_admins_role ON admins(role);

PRAGMA foreign_keys = ON;

-- 3. Consignment (gold lot) with its export state machine.
CREATE TABLE IF NOT EXISTS gold_consignments (
  id TEXT PRIMARY KEY,
  reference TEXT UNIQUE NOT NULL,           -- human ref, e.g. CONS-AB12CD34
  producer_id TEXT NOT NULL REFERENCES users(id),
  weight_declared_g REAL NOT NULL CHECK (weight_declared_g > 0),
  purity_declared REAL NOT NULL CHECK (purity_declared > 0 AND purity_declared <= 1),
  gold_type TEXT NOT NULL CHECK (gold_type IN ('nuggets', 'powder', 'bar')),
  origin_country TEXT DEFAULT 'BF',
  origin_gps_lat REAL,
  origin_gps_lng REAL,
  photos TEXT,                              -- JSON array of R2 keys
  estimated_value_xof REAL,
  status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'FORWARDER_VALIDATED', 'IN_TRANSIT', 'ARRIVED_DUBAI', 'AUDIT_VALIDATED', 'REJECTED')),
  forwarder_id TEXT,                        -- admin (TRANSITAIRE) who validated
  forwarder_validated_at TEXT,
  transit_started_at TEXT,
  arrived_dubai_at TEXT,
  refined_weight_g REAL,                    -- final weight after LBMA refining (set at audit)
  refinery_lot TEXT,
  lbma_certificate TEXT,
  audited_by TEXT,                          -- admin who ran the audit validation
  audited_at TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_consignments_producer ON gold_consignments(producer_id);
CREATE INDEX IF NOT EXISTS idx_consignments_status ON gold_consignments(status);

-- 4. Immutable audit trail of every status transition.
CREATE TABLE IF NOT EXISTS consignment_events (
  id TEXT PRIMARY KEY,
  consignment_id TEXT NOT NULL REFERENCES gold_consignments(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_id TEXT,
  actor_role TEXT,
  note TEXT,
  gps_lat REAL,
  gps_lng REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_consignment_events_consignment ON consignment_events(consignment_id);
