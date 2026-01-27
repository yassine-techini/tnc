-- Security Enhancements Migration
-- Banking-grade security features

-- Password history for preventing password reuse
CREATE TABLE IF NOT EXISTS password_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_password_history_user ON password_history(user_id);
CREATE INDEX IF NOT EXISTS idx_password_history_created ON password_history(created_at);

-- Security events log (separate from audit_logs for security-specific events)
CREATE TABLE IF NOT EXISTS security_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    user_id TEXT REFERENCES users(id),
    ip_address TEXT,
    user_agent TEXT,
    identifier TEXT, -- email, phone, or other identifier
    risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
    details TEXT, -- JSON
    success INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_security_events_user ON security_events(user_id);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_security_events_risk ON security_events(risk_level);
CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at);

-- Two-factor authentication backup codes
CREATE TABLE IF NOT EXISTS two_factor_backup_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_2fa_backup_user ON two_factor_backup_codes(user_id);

-- Device trust for 2FA (remembered devices)
CREATE TABLE IF NOT EXISTS trusted_devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_fingerprint TEXT NOT NULL,
    device_name TEXT,
    ip_address TEXT,
    user_agent TEXT,
    last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_fingerprint ON trusted_devices(device_fingerprint);

-- Transaction verification codes for high-value transactions
CREATE TABLE IF NOT EXISTS transaction_verifications (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    verification_type TEXT NOT NULL CHECK (verification_type IN ('2FA', 'SMS', 'EMAIL')),
    code_hash TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'EXPIRED', 'FAILED')),
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tx_verifications_transaction ON transaction_verifications(transaction_id);
CREATE INDEX IF NOT EXISTS idx_tx_verifications_user ON transaction_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_tx_verifications_status ON transaction_verifications(status);

-- Add new security columns to users table
-- Note: SQLite doesn't support ADD COLUMN IF NOT EXISTS, so we'll handle this in application code

-- API keys for programmatic access (future use)
CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    key_prefix TEXT NOT NULL, -- First 8 chars for identification
    permissions TEXT NOT NULL DEFAULT '[]', -- JSON array of permissions
    rate_limit INTEGER DEFAULT 1000, -- Requests per hour
    last_used_at TEXT,
    expires_at TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);

-- Session security enhancements
CREATE TABLE IF NOT EXISTS active_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token_hash TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    device_type TEXT,
    location TEXT, -- Geo-location info
    is_current INTEGER NOT NULL DEFAULT 0,
    last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_active_sessions_token ON active_sessions(session_token_hash);
CREATE INDEX IF NOT EXISTS idx_active_sessions_expires ON active_sessions(expires_at);

-- IP blocklist for detected threats
CREATE TABLE IF NOT EXISTS ip_blocklist (
    id TEXT PRIMARY KEY,
    ip_address TEXT NOT NULL UNIQUE,
    reason TEXT NOT NULL,
    blocked_by TEXT REFERENCES admins(id),
    expires_at TEXT, -- NULL means permanent
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ip_blocklist_ip ON ip_blocklist(ip_address);
CREATE INDEX IF NOT EXISTS idx_ip_blocklist_expires ON ip_blocklist(expires_at);
