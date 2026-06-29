-- ============================================
-- 0016 Per-user token invalidation epoch
-- ============================================
-- Stores the instant before which any previously-issued refresh token is no
-- longer accepted. Set on logout, password reset/change, and "revoke all
-- sessions". NULL means "never invalidated". This gives immediate, stateless
-- revocation of refresh tokens (previously a stolen refresh token stayed valid
-- for its full lifetime even after logout/reset).

ALTER TABLE users ADD COLUMN tokens_invalid_before TEXT;
