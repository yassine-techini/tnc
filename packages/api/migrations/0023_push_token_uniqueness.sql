-- ============================================
-- 0023 Push token uniqueness
-- push_tokens exists since 0001 but nothing ever wrote to it, so there was no
-- constraint keeping a token unique. Registering the same device twice would
-- have delivered every notification twice, and a device re-used by a second
-- account would have kept notifying the first one.
--
-- A push token identifies an app installation, not a person: it belongs to
-- exactly one row, and re-registering it moves it to the current user.
-- ============================================

-- Defensive: the table should be empty, but never create a unique index over
-- duplicates. Keeps the most recently updated row for each token.
DELETE FROM push_tokens
WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY token ORDER BY updated_at DESC, rowid DESC) AS rn
    FROM push_tokens
  ) WHERE rn = 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_tokens_token ON push_tokens(token);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_active ON push_tokens(user_id, active);
