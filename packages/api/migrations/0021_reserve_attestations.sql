-- ============================================
-- 0021 Reserve attestations (ADR 002, phase 1)
-- Periodic, signed, hash-chained statements of the reserve. No token moves
-- on-chain: the chain only receives a digest, so this phase carries no custody
-- and no regulatory exposure.
--
-- Each attestation embeds the previous digest, so the sequence is append-only:
-- rewriting an old attestation breaks every later digest. Anchoring ONE digest
-- externally therefore covers all the history behind it.
-- ============================================

CREATE TABLE IF NOT EXISTS reserve_attestations (
  id TEXT PRIMARY KEY,
  -- Monotonic, gapless. UNIQUE is what makes a concurrent double-issue fail
  -- rather than fork the chain.
  sequence INTEGER NOT NULL UNIQUE,
  previous_digest TEXT,            -- NULL only for the genesis attestation
  digest TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,           -- canonical JSON, the exact bytes hashed

  signature TEXT,                  -- compact JWS over the digest
  signing_key_id TEXT,

  -- Anchoring is a later, separate step: an attestation exists and is verifiable
  -- before it ever reaches a chain.
  anchor_chain TEXT,
  anchor_tx_hash TEXT,
  anchored_at TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reserve_attestations_created ON reserve_attestations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reserve_attestations_anchor ON reserve_attestations(anchored_at);

INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('attestation_public_jwk', '', 'Clé publique (JWK JSON) de vérification des attestations de réserve');
