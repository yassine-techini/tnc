-- Staging seed data with demo accounts
-- This file contains test data for the staging environment

-- ============================================
-- DEMO USERS (with known passwords for testing)
-- Password for all: Demo2024!
-- Argon2id hash generated with proper salt
-- ============================================

-- Demo user - Standard level (can trade)
INSERT OR REPLACE INTO users (
  id, email, phone, password_hash, kyc_level, kyc_status,
  country, email_verified, phone_verified, first_name, last_name,
  two_factor_secret, created_at, updated_at
) VALUES (
  'demo-user-standard-001',
  'demo@tnc.trading',
  '+22670000001',
  '$argon2id$v=19$m=65536,t=3,p=4$c3RhZ2luZ3NhbHQxMjM$K8Hs5PO5mNjMQWBL3VTyM5GQhPqJQUVvBpNqzxE6Aw0',
  'STANDARD',
  'APPROVED',
  'BF',
  1,
  1,
  'Jean',
  'Demo',
  NULL,
  datetime('now'),
  datetime('now')
);

-- Demo user - Verified level (full access)
INSERT OR REPLACE INTO users (
  id, email, phone, password_hash, kyc_level, kyc_status,
  country, email_verified, phone_verified, first_name, last_name,
  two_factor_secret, created_at, updated_at
) VALUES (
  'demo-user-verified-001',
  'verified@tnc.trading',
  '+22670000002',
  '$argon2id$v=19$m=65536,t=3,p=4$c3RhZ2luZ3NhbHQxMjM$K8Hs5PO5mNjMQWBL3VTyM5GQhPqJQUVvBpNqzxE6Aw0',
  'VERIFIED',
  'APPROVED',
  'BF',
  1,
  1,
  'Marie',
  'Verified',
  NULL,
  datetime('now'),
  datetime('now')
);

-- ============================================
-- DEMO WALLETS
-- ============================================

INSERT OR REPLACE INTO wallets (id, user_id, token_balance, cash_balance, created_at, updated_at)
VALUES
  ('wallet-demo-standard', 'demo-user-standard-001', 25.5, 750000, datetime('now'), datetime('now')),
  ('wallet-demo-verified', 'demo-user-verified-001', 150.0, 3500000, datetime('now'), datetime('now'));

-- ============================================
-- DEMO ADMIN (Password: AdminDemo2024!)
-- ============================================

INSERT OR REPLACE INTO admins (
  id, email, password_hash, name, role, active,
  two_factor_secret, created_at, updated_at
) VALUES (
  'demo-admin-001',
  'admin@tnc.trading',
  '$argon2id$v=19$m=65536,t=3,p=4$YWRtaW5zYWx0MTIz$jNHPqO8x5K6WdGv2LbVm3YPQfMkJRUVwCpMsyxF7Bw4',
  'Admin Demo',
  'SUPER_ADMIN',
  1,
  NULL,
  datetime('now'),
  datetime('now')
);

-- ============================================
-- DEMO STATE USERS (Password: StateDemo2024!)
-- Role: STATE_OPERATOR (stored in admins table)
-- ============================================

INSERT OR REPLACE INTO admins (
  id, email, password_hash, name, role, active,
  two_factor_secret, created_at, updated_at
) VALUES (
  'demo-state-mines-001',
  'etat@mines.gov.bf',
  '$argon2id$v=19$m=65536,t=3,p=4$c3RhdGVzYWx0MTIz$mOIQrP9y6L7XeHw3McWn4ZQRgNlKSUVxDqNtyxG8Cx5',
  'Agent Mines Demo',
  'STATE_OPERATOR',
  1,
  NULL,
  datetime('now'),
  datetime('now')
);

INSERT OR REPLACE INTO admins (
  id, email, password_hash, name, role, active,
  two_factor_secret, created_at, updated_at
) VALUES (
  'demo-state-finances-001',
  'etat@finances.gov.bf',
  '$argon2id$v=19$m=65536,t=3,p=4$c3RhdGVzYWx0MTIz$mOIQrP9y6L7XeHw3McWn4ZQRgNlKSUVxDqNtyxG8Cx5',
  'Agent Finances Demo',
  'STATE_OPERATOR',
  1,
  NULL,
  datetime('now'),
  datetime('now')
);

-- ============================================
-- GOLD STOCK (Initial allocation)
-- ============================================

INSERT OR REPLACE INTO gold_stock (
  id, total_allocated, tokens_issued,
  last_audit_date, last_audit_result, updated_at
) VALUES (
  'main',
  10000.0,
  175.5,
  datetime('now'),
  'Staging demo allocation',
  datetime('now')
);

-- ============================================
-- GOLD PRICES (Recent history)
-- ============================================

INSERT OR REPLACE INTO gold_prices (id, price_usd, price_xof, exchange_rate, buy_price, sell_price, source, timestamp)
VALUES
  ('price-staging-001', 85.00, 52275, 615, 53320, 51229, 'staging-demo', datetime('now', '-7 days')),
  ('price-staging-002', 85.25, 52429, 615, 53477, 51380, 'staging-demo', datetime('now', '-6 days')),
  ('price-staging-003', 84.75, 52121, 615, 53163, 51079, 'staging-demo', datetime('now', '-5 days')),
  ('price-staging-004', 85.50, 52583, 615, 53634, 51530, 'staging-demo', datetime('now', '-4 days')),
  ('price-staging-005', 86.00, 52890, 615, 53948, 51832, 'staging-demo', datetime('now', '-3 days')),
  ('price-staging-006', 85.75, 52736, 615, 53791, 51681, 'staging-demo', datetime('now', '-2 days')),
  ('price-staging-007', 86.25, 53044, 615, 54105, 51983, 'staging-demo', datetime('now', '-1 day')),
  ('price-staging-008', 86.50, 53198, 615, 54261, 52133, 'staging-demo', datetime('now'));

-- ============================================
-- SAMPLE TRANSACTIONS
-- ============================================

INSERT OR REPLACE INTO transactions (
  id, user_id, wallet_id, type, status, token_amount, cash_amount,
  price_per_gram, fees, payment_method, created_at, completed_at, updated_at
) VALUES
  ('tx-demo-001', 'demo-user-standard-001', 'wallet-demo-standard', 'DEPOSIT', 'COMPLETED', NULL, 1000000, NULL, 0, 'orange_money', datetime('now', '-5 days'), datetime('now', '-5 days'), datetime('now', '-5 days')),
  ('tx-demo-002', 'demo-user-standard-001', 'wallet-demo-standard', 'BUY', 'COMPLETED', 25.5, 1369755, 53716, 0, NULL, datetime('now', '-4 days'), datetime('now', '-4 days'), datetime('now', '-4 days')),
  ('tx-demo-003', 'demo-user-verified-001', 'wallet-demo-verified', 'DEPOSIT', 'COMPLETED', NULL, 8500000, NULL, 0, 'moov_money', datetime('now', '-6 days'), datetime('now', '-6 days'), datetime('now', '-6 days')),
  ('tx-demo-004', 'demo-user-verified-001', 'wallet-demo-verified', 'BUY', 'COMPLETED', 150.0, 8100000, 54000, 0, NULL, datetime('now', '-5 days'), datetime('now', '-5 days'), datetime('now', '-5 days'));

-- ============================================
-- CONFIG (Platform settings)
-- ============================================

INSERT OR REPLACE INTO config (key, value, updated_at, updated_by)
VALUES
  ('spread_buy', '0.02', datetime('now'), 'staging-setup'),
  ('spread_sell', '0.02', datetime('now'), 'staging-setup'),
  ('min_buy_grams', '1', datetime('now'), 'staging-setup'),
  ('min_sell_grams', '1', datetime('now'), 'staging-setup'),
  ('quote_validity_seconds', '60', datetime('now'), 'staging-setup'),
  ('maintenance_mode', 'false', datetime('now'), 'staging-setup');
