-- Migration 0008: Certificates table for verification
-- Stores issued certificates with verification codes

CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  verification_code TEXT NOT NULL UNIQUE,
  token_balance REAL NOT NULL,
  user_name TEXT NOT NULL,
  user_email TEXT NOT NULL,
  kyc_level TEXT NOT NULL DEFAULT 'BASIC',
  status TEXT NOT NULL DEFAULT 'VALID' CHECK(status IN ('VALID', 'REVOKED', 'EXPIRED')),
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  revoked_at TEXT,
  revocation_reason TEXT,
  verification_count INTEGER NOT NULL DEFAULT 0,
  last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_certificates_user_id ON certificates(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_certificates_verification_code ON certificates(verification_code);
CREATE INDEX IF NOT EXISTS idx_certificates_status ON certificates(status);
