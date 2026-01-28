-- Development seed data
-- This file contains test data for local development
-- WARNING: Do not run this in staging or production environments

-- ============================================
-- SEED USERS (for development/testing only)
-- ============================================

-- Test user with BASIC KYC level
INSERT OR IGNORE INTO users (
  id, email, phone, password_hash, kyc_level, kyc_status,
  country, email_verified, phone_verified, created_at, updated_at
) VALUES (
  'test-user-basic-001',
  'basic@test.local',
  '+22670000001',
  '$argon2id$v=19$m=65536,t=3,p=4$dGVzdHNhbHQxMjM$TESTHASH001', -- Password: Test123!@#
  'BASIC',
  'APPROVED',
  'BF',
  1,
  1,
  datetime('now'),
  datetime('now')
);

-- Test user with STANDARD KYC level
INSERT OR IGNORE INTO users (
  id, email, phone, password_hash, kyc_level, kyc_status,
  country, email_verified, phone_verified, created_at, updated_at
) VALUES (
  'test-user-standard-001',
  'standard@test.local',
  '+22670000002',
  '$argon2id$v=19$m=65536,t=3,p=4$dGVzdHNhbHQxMjM$TESTHASH002', -- Password: Test123!@#
  'STANDARD',
  'APPROVED',
  'BF',
  1,
  1,
  datetime('now'),
  datetime('now')
);

-- Test user with VERIFIED KYC level
INSERT OR IGNORE INTO users (
  id, email, phone, password_hash, kyc_level, kyc_status,
  country, email_verified, phone_verified, created_at, updated_at
) VALUES (
  'test-user-verified-001',
  'verified@test.local',
  '+22670000003',
  '$argon2id$v=19$m=65536,t=3,p=4$dGVzdHNhbHQxMjM$TESTHASH003', -- Password: Test123!@#
  'VERIFIED',
  'APPROVED',
  'BF',
  1,
  1,
  datetime('now'),
  datetime('now')
);

-- ============================================
-- SEED WALLETS
-- ============================================

INSERT OR IGNORE INTO wallets (id, user_id, token_balance, cash_balance, created_at, updated_at)
VALUES
  ('wallet-basic-001', 'test-user-basic-001', 0, 0, datetime('now'), datetime('now')),
  ('wallet-standard-001', 'test-user-standard-001', 10.5, 500000, datetime('now'), datetime('now')),
  ('wallet-verified-001', 'test-user-verified-001', 100.0, 2500000, datetime('now'), datetime('now'));

-- ============================================
-- SEED GOLD STOCK (Initial allocation from State)
-- ============================================

INSERT OR IGNORE INTO gold_stock (
  id, total_allocated, tokens_issued,
  last_audit_date, last_audit_result, updated_at
) VALUES (
  'gold-stock-main',
  10000.0,  -- 10kg allocated by State
  110.5,    -- Total tokens issued (matches sum of wallet balances)
  datetime('now'),
  'Initial allocation validated',
  datetime('now')
);

-- ============================================
-- SEED GOLD PRICES (Historical data for charts)
-- ============================================

INSERT OR IGNORE INTO gold_prices (id, price_usd, price_xof, exchange_rate, buy_price, sell_price, source, timestamp)
VALUES
  ('price-001', 85.00, 52275, 615, 53320, 51229, 'goldapi.io', datetime('now', '-7 days')),
  ('price-002', 85.25, 52429, 615, 53477, 51380, 'goldapi.io', datetime('now', '-6 days')),
  ('price-003', 84.75, 52121, 615, 53163, 51079, 'goldapi.io', datetime('now', '-5 days')),
  ('price-004', 85.50, 52583, 615, 53634, 51530, 'goldapi.io', datetime('now', '-4 days')),
  ('price-005', 86.00, 52890, 615, 53948, 51832, 'goldapi.io', datetime('now', '-3 days')),
  ('price-006', 85.75, 52736, 615, 53791, 51681, 'goldapi.io', datetime('now', '-2 days')),
  ('price-007', 86.25, 53044, 615, 54105, 51983, 'goldapi.io', datetime('now', '-1 day')),
  ('price-008', 86.50, 53198, 615, 54261, 52133, 'goldapi.io', datetime('now'));

-- ============================================
-- SEED TRANSACTIONS (Sample history)
-- ============================================

-- Deposit for standard user
INSERT OR IGNORE INTO transactions (
  id, user_id, wallet_id, type, status, token_amount, cash_amount,
  price_per_gram, fees, payment_method, payment_reference, created_at, completed_at
) VALUES (
  'tx-deposit-001',
  'test-user-standard-001',
  'wallet-standard-001',
  'DEPOSIT',
  'COMPLETED',
  NULL,
  500000,
  NULL,
  0,
  'orange_money',
  'OM-DEP-001',
  datetime('now', '-3 days'),
  datetime('now', '-3 days')
);

-- Buy transaction for standard user
INSERT OR IGNORE INTO transactions (
  id, user_id, wallet_id, type, status, token_amount, cash_amount,
  price_per_gram, fees, payment_method, created_at, completed_at
) VALUES (
  'tx-buy-001',
  'test-user-standard-001',
  'wallet-standard-001',
  'BUY',
  'COMPLETED',
  10.5,
  563835,
  53698,
  0,
  NULL,
  datetime('now', '-2 days'),
  datetime('now', '-2 days')
);

-- Deposit for verified user
INSERT OR IGNORE INTO transactions (
  id, user_id, wallet_id, type, status, token_amount, cash_amount,
  price_per_gram, fees, payment_method, payment_reference, created_at, completed_at
) VALUES (
  'tx-deposit-002',
  'test-user-verified-001',
  'wallet-verified-001',
  'DEPOSIT',
  'COMPLETED',
  NULL,
  5500000,
  NULL,
  0,
  'moov_money',
  'MOOV-DEP-001',
  datetime('now', '-5 days'),
  datetime('now', '-5 days')
);

-- Buy transaction for verified user
INSERT OR IGNORE INTO transactions (
  id, user_id, wallet_id, type, status, token_amount, cash_amount,
  price_per_gram, fees, payment_method, created_at, completed_at
) VALUES (
  'tx-buy-002',
  'test-user-verified-001',
  'wallet-verified-001',
  'BUY',
  'COMPLETED',
  100.0,
  5300000,
  53000,
  0,
  NULL,
  datetime('now', '-4 days'),
  datetime('now', '-4 days')
);

-- ============================================
-- SEED SYSTEM CONFIG
-- ============================================

INSERT OR IGNORE INTO system_config (key, value, updated_at, updated_by)
VALUES
  ('spread_buy', '0.02', datetime('now'), 'system'),
  ('spread_sell', '0.02', datetime('now'), 'system'),
  ('min_buy_grams', '1', datetime('now'), 'system'),
  ('min_sell_grams', '1', datetime('now'), 'system'),
  ('quote_validity_seconds', '60', datetime('now'), 'system'),
  ('maintenance_mode', 'false', datetime('now'), 'system');
