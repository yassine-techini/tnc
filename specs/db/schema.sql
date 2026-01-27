-- TNC Trading - Schema Cloudflare D1
-- Version: 1.0.1
-- Charset: UTF-8
-- Note: Tables ordered by dependencies

-- ============================================
-- ADMIN (must be created first for FK references)
-- ============================================

CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'KYC_REVIEWER', 'FINANCE', 'SUPPORT', 'STATE_OPERATOR')),
    password_hash TEXT,
    cloudflare_access_id TEXT,
    two_factor_enabled INTEGER DEFAULT 1,
    two_factor_secret TEXT,
    active INTEGER DEFAULT 1,
    last_login_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email);
CREATE INDEX IF NOT EXISTS idx_admins_role ON admins(role);

-- ============================================
-- USERS & AUTHENTICATION
-- ============================================

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email_verified INTEGER DEFAULT 0,
    phone_verified INTEGER DEFAULT 0,
    country TEXT NOT NULL DEFAULT 'BF',
    kyc_level TEXT DEFAULT 'BASIC' CHECK (kyc_level IN ('BASIC', 'STANDARD', 'VERIFIED')),
    kyc_status TEXT DEFAULT 'PENDING' CHECK (kyc_status IN ('PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'EXPIRED')),
    two_factor_enabled INTEGER DEFAULT 0,
    two_factor_secret TEXT,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TEXT,
    last_login_at TEXT,
    -- Suspension fields
    suspended INTEGER DEFAULT 0,
    suspended_at TEXT,
    suspended_until TEXT,
    suspension_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_kyc_status ON users(kyc_status);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL,
    device_info TEXT,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS verification_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('EMAIL', 'PHONE', 'PASSWORD_RESET', '2FA_SETUP')),
    identifier TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_verification_codes_identifier ON verification_codes(identifier, type);

CREATE TABLE IF NOT EXISTS recovery_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON recovery_codes(user_id);

-- ============================================
-- KYC DOCUMENTS
-- ============================================

CREATE TABLE IF NOT EXISTS kyc_documents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL CHECK (document_type IN ('CNIB', 'PASSPORT', 'PERMIT', 'CEDEAO')),
    document_number TEXT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    date_of_birth TEXT NOT NULL,
    nationality TEXT NOT NULL,
    address TEXT,
    city TEXT,
    front_image_url TEXT NOT NULL,
    back_image_url TEXT,
    selfie_url TEXT NOT NULL,
    status TEXT DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'PROCESSING', 'VERIFIED', 'REJECTED')),
    provider_job_id TEXT,
    provider_result TEXT,
    rejection_reason TEXT,
    reviewed_by TEXT REFERENCES admins(id),
    reviewed_at TEXT,
    document_expiry_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kyc_documents_user ON kyc_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_documents_status ON kyc_documents(status);

-- ============================================
-- WALLETS
-- ============================================

CREATE TABLE IF NOT EXISTS wallets (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_balance REAL DEFAULT 0 CHECK (token_balance >= 0),
    cash_balance REAL DEFAULT 0 CHECK (cash_balance >= 0),
    total_bought REAL DEFAULT 0,
    total_spent REAL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);

-- ============================================
-- MARKETPLACE & PRICING
-- ============================================

CREATE TABLE IF NOT EXISTS gold_prices (
    id TEXT PRIMARY KEY,
    price_usd REAL NOT NULL,
    price_xof REAL NOT NULL,
    exchange_rate REAL NOT NULL,
    spread_buy REAL NOT NULL DEFAULT 0.02,
    spread_sell REAL NOT NULL DEFAULT 0.02,
    buy_price REAL NOT NULL,
    sell_price REAL NOT NULL,
    source TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gold_prices_timestamp ON gold_prices(timestamp);

CREATE TABLE IF NOT EXISTS gold_stock (
    id TEXT PRIMARY KEY DEFAULT 'main',
    total_allocated REAL NOT NULL DEFAULT 0,
    tokens_issued REAL NOT NULL DEFAULT 0,
    low_stock_threshold REAL DEFAULT 0.1,
    last_audit_date TEXT,
    last_audit_result TEXT,
    audited_by TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (tokens_issued <= total_allocated)
);

CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL')),
    token_amount REAL NOT NULL,
    cash_amount REAL NOT NULL,
    price_per_gram REAL NOT NULL,
    fees REAL NOT NULL,
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'USED', 'EXPIRED')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quotes_user ON quotes(user_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_expires ON quotes(expires_at);

-- ============================================
-- TRANSACTIONS (after wallets and quotes)
-- ============================================

CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    wallet_id TEXT NOT NULL REFERENCES wallets(id),
    quote_id TEXT REFERENCES quotes(id),
    type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL', 'FEE')),
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')),
    token_amount REAL,
    cash_amount REAL NOT NULL,
    price_per_gram REAL,
    fees REAL DEFAULT 0,
    payment_method TEXT,
    payment_reference TEXT,
    payout_method TEXT,
    payout_reference TEXT,
    failure_reason TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_wallet ON transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);

CREATE TABLE IF NOT EXISTS withdrawals (
    id TEXT PRIMARY KEY,
    transaction_id TEXT UNIQUE NOT NULL REFERENCES transactions(id),
    method TEXT NOT NULL CHECK (method IN ('orange_money', 'moov_money', 'bank')),
    amount REAL NOT NULL,
    fees REAL NOT NULL,
    net_amount REAL NOT NULL,
    phone_number TEXT,
    bank_account TEXT,
    bank_name TEXT,
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED')),
    provider_reference TEXT,
    failure_reason TEXT,
    approved_by TEXT REFERENCES admins(id),
    approved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_transaction ON withdrawals(transaction_id);

-- ============================================
-- AUDIT & REPORTING
-- ============================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    admin_id TEXT REFERENCES admins(id),
    user_id TEXT REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    old_value TEXT,
    new_value TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_admin ON audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS proof_of_reserve (
    id TEXT PRIMARY KEY,
    report_date TEXT NOT NULL,
    total_gold_allocated REAL NOT NULL,
    tokens_issued REAL NOT NULL,
    coverage_ratio REAL NOT NULL,
    auditor_name TEXT,
    auditor_signature TEXT,
    report_url TEXT,
    verified_by TEXT REFERENCES admins(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_por_date ON proof_of_reserve(report_date);

-- ============================================
-- NOTIFICATIONS
-- ============================================

CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('TRANSACTION', 'KYC', 'SECURITY', 'MARKETING', 'SYSTEM')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data TEXT,
    read INTEGER DEFAULT 0,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(user_id, read);

CREATE TABLE IF NOT EXISTS push_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
    device_id TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);

-- ============================================
-- PRICE ALERTS
-- ============================================

CREATE TABLE IF NOT EXISTS price_alerts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL CHECK (alert_type IN ('ABOVE', 'BELOW')),
    target_price REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'XOF' CHECK (currency IN ('XOF', 'USD')),
    notification_method TEXT NOT NULL DEFAULT 'PUSH' CHECK (notification_method IN ('PUSH', 'EMAIL', 'SMS', 'ALL')),
    is_active INTEGER DEFAULT 1,
    triggered INTEGER DEFAULT 0,
    triggered_at TEXT,
    triggered_price REAL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_price_alerts_user ON price_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_active ON price_alerts(is_active, triggered);
CREATE INDEX IF NOT EXISTS idx_price_alerts_type ON price_alerts(alert_type, target_price);

-- ============================================
-- CONFIGURATION
-- ============================================

CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_by TEXT REFERENCES admins(id),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Insert default configuration
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('spread_buy', '0.02', 'Spread achat (2%)'),
    ('spread_sell', '0.02', 'Spread vente (2%)'),
    ('storage_fee_annual', '0.005', 'Frais de garde annuels (0.5%)'),
    ('withdrawal_fee_mobile', '0.01', 'Frais retrait Mobile Money (1%)'),
    ('withdrawal_fee_bank', '0.005', 'Frais retrait bancaire (0.5%)'),
    ('withdrawal_min_mobile', '500', 'Retrait min Mobile Money (XOF)'),
    ('withdrawal_min_bank', '1000', 'Retrait min bancaire (XOF)'),
    ('quote_validity_seconds', '60', 'Validite devis (secondes)'),
    ('session_timeout_minutes', '30', 'Timeout session (minutes)'),
    ('login_max_attempts', '5', 'Tentatives de connexion max'),
    ('lockout_duration_minutes', '15', 'Duree de blocage (minutes)'),
    ('kyc_standard_daily_buy', '100', 'Limite achat/jour Standard (g)'),
    ('kyc_standard_monthly_buy', '500', 'Limite achat/mois Standard (g)'),
    ('kyc_verified_daily_buy', '1000', 'Limite achat/jour Verified (g)'),
    ('kyc_verified_monthly_buy', '5000', 'Limite achat/mois Verified (g)'),
    ('maintenance_mode', '0', 'Mode maintenance (0/1)');

-- Insert initial gold stock record
INSERT OR IGNORE INTO gold_stock (id, total_allocated, tokens_issued) VALUES ('main', 1000, 0);

-- ============================================
-- VIEWS
-- ============================================

CREATE VIEW IF NOT EXISTS v_user_summary AS
SELECT
    u.id,
    u.email,
    u.phone,
    u.country,
    u.kyc_level,
    u.kyc_status,
    u.created_at,
    w.token_balance,
    w.cash_balance,
    w.total_bought,
    w.total_spent,
    CASE WHEN w.total_bought > 0 THEN w.total_spent / w.total_bought ELSE 0 END as avg_buy_price
FROM users u
LEFT JOIN wallets w ON u.id = w.user_id;

CREATE VIEW IF NOT EXISTS v_daily_stats AS
SELECT
    date(created_at) as date,
    type,
    COUNT(*) as count,
    SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
    SUM(CASE WHEN status = 'COMPLETED' THEN token_amount ELSE 0 END) as total_tokens,
    SUM(CASE WHEN status = 'COMPLETED' THEN cash_amount ELSE 0 END) as total_cash
FROM transactions
GROUP BY date(created_at), type;

CREATE VIEW IF NOT EXISTS v_kyc_pending AS
SELECT
    k.*,
    u.email,
    u.phone,
    u.created_at as user_created_at
FROM kyc_documents k
JOIN users u ON k.user_id = u.id
WHERE k.status = 'SUBMITTED'
ORDER BY k.created_at ASC;
