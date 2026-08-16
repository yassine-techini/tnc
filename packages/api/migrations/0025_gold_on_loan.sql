-- ============================================
-- 0025 Distinguish vaulted gold from gold on loan
--
-- The lease product (6%/yr) is funded by LENDING the gold out. That gold leaves
-- the vault while the tokens claiming it stay in circulation, so
-- `total_allocated` stops meaning "gold we hold" and starts meaning "gold we own
-- or have lent".
--
-- The invariant is not abandoned, it is refined. `tokens_issued <=
-- total_allocated` still says every token is backed by owned gold. What it never
-- said, and now must, is how much of that gold is physically present:
--
--     vaulted = total_allocated - on_loan
--
-- This matters because the two carry different risk. Vaulted gold is there.
-- Lent gold depends on a counterparty returning it, and a Proof of Reserve that
-- reported 100% coverage without disclosing the split would be telling a third
-- party — the State, a citizen, an auditor — something materially incomplete.
-- ============================================

ALTER TABLE gold_stock ADD COLUMN gold_on_loan REAL NOT NULL DEFAULT 0;

-- Counterparties holding lent gold. Populated by the lease product (phase 3);
-- created now so the attestation payload can quote it from its first version and
-- the hash chain never has to change shape.
CREATE TABLE IF NOT EXISTS gold_loans (
  id TEXT PRIMARY KEY,
  counterparty TEXT NOT NULL,
  weight_g REAL NOT NULL CHECK (weight_g > 0),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  due_at TEXT,
  returned_at TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETURNED', 'DEFAULTED')),
  reference TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gold_loans_status ON gold_loans(status);
