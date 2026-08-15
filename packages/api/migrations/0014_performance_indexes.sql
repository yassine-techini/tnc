-- Additional performance indexes identified in audit
-- These indexes optimize common query patterns

-- Wallet balance queries (used in buy/sell operations)
CREATE INDEX IF NOT EXISTS idx_wallets_user_token_balance
  ON wallets(user_id, token_balance);

-- Transaction completion queries (dashboard, history)
CREATE INDEX IF NOT EXISTS idx_transactions_user_completed_at
  ON transactions(user_id, completed_at DESC);

-- Withdrawal management (admin panel).
-- `withdrawals` has no user_id — the user is reached through transaction_id — so
-- the original (user_id, status) index aborted this migration. The admin queue is
-- "pending first, newest first", which is what this covers.
CREATE INDEX IF NOT EXISTS idx_withdrawals_status_created
  ON withdrawals(status, created_at DESC);

-- KYC document queries (review process)
CREATE INDEX IF NOT EXISTS idx_kyc_documents_user_created
  ON kyc_documents(user_id, created_at DESC);

-- User filtering by country and KYC status (admin filtering)
CREATE INDEX IF NOT EXISTS idx_users_country_kyc_status
  ON users(country, kyc_status);

-- Session lookups (auth refresh)
CREATE INDEX IF NOT EXISTS idx_sessions_user_expires
  ON sessions(user_id, expires_at);

-- Alerts by state (admin monitoring).
-- `alerts` has no status column — it carries `acknowledged` and `resolved`
-- flags — so the original (status, triggered_at) index aborted this migration.
-- The monitoring view is "unresolved first, most recent first".
CREATE INDEX IF NOT EXISTS idx_alerts_resolved_triggered
  ON alerts(resolved, triggered_at DESC);

-- Audit logs by admin (compliance)
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_created
  ON audit_logs(admin_id, created_at DESC);
