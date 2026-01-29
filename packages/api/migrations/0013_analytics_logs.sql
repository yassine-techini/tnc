-- Migration: Analytics and Logs Infrastructure
-- Date: 2026-01-29
-- Description: Tables for log indexing, alert rules, and analytics snapshots

-- ============================================
-- Log Index Table (for fast log search)
-- ============================================
CREATE TABLE IF NOT EXISTS log_index (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    log_date TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error', 'fatal')),
    category TEXT NOT NULL,
    action TEXT,
    user_id TEXT,
    request_id TEXT,
    entity_type TEXT,
    entity_id TEXT,
    r2_key TEXT NOT NULL,
    r2_offset INTEGER,
    message_preview TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_log_index_date ON log_index(log_date);
CREATE INDEX IF NOT EXISTS idx_log_index_timestamp ON log_index(timestamp);
CREATE INDEX IF NOT EXISTS idx_log_index_user ON log_index(user_id, log_date);
CREATE INDEX IF NOT EXISTS idx_log_index_request ON log_index(request_id);
CREATE INDEX IF NOT EXISTS idx_log_index_category ON log_index(category, log_date);
CREATE INDEX IF NOT EXISTS idx_log_index_level ON log_index(level, log_date);
CREATE INDEX IF NOT EXISTS idx_log_index_action ON log_index(action, log_date);
CREATE INDEX IF NOT EXISTS idx_log_index_entity ON log_index(entity_type, entity_id, log_date);

-- ============================================
-- Alert Rules Table
-- ============================================
CREATE TABLE IF NOT EXISTS alert_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    metric TEXT NOT NULL,
    operator TEXT NOT NULL CHECK (operator IN ('>', '<', '>=', '<=', '==', '!=')),
    threshold REAL NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    cooldown_minutes INTEGER NOT NULL DEFAULT 15,
    notify_email INTEGER NOT NULL DEFAULT 1,
    notify_sms INTEGER NOT NULL DEFAULT 0,
    notify_webhook TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_triggered_at TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(enabled);
CREATE INDEX IF NOT EXISTS idx_alert_rules_metric ON alert_rules(metric);

-- ============================================
-- Alerts History Table
-- ============================================
CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    rule_id TEXT REFERENCES alert_rules(id) ON DELETE SET NULL,
    rule_name TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    message TEXT NOT NULL,
    current_value REAL,
    threshold REAL,
    triggered_at TEXT NOT NULL,
    acknowledged INTEGER NOT NULL DEFAULT 0,
    acknowledged_by TEXT,
    acknowledged_at TEXT,
    resolved INTEGER NOT NULL DEFAULT 0,
    resolved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(resolved, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_rule ON alerts(rule_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity, triggered_at DESC);

-- ============================================
-- Analytics Snapshots Table
-- ============================================
CREATE TABLE IF NOT EXISTS analytics_snapshots (
    id TEXT PRIMARY KEY,
    snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('5min', 'hourly', 'daily', 'weekly', 'monthly')),
    metrics TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_type_time ON analytics_snapshots(snapshot_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_timestamp ON analytics_snapshots(timestamp DESC);

-- ============================================
-- Default Alert Rules
-- ============================================
INSERT OR IGNORE INTO alert_rules (id, name, description, metric, operator, threshold, severity, cooldown_minutes, notify_email, notify_sms, notify_webhook) VALUES
    ('rule_high_error_rate', 'Taux d''erreur élevé', 'Alerte si le taux d''erreur dépasse 5% sur 5 minutes', 'errorRateLast5Min', '>', 5, 'critical', 15, 1, 1, NULL),
    ('rule_low_stock_coverage', 'Couverture stock faible', 'Alerte si la couverture or descend sous 1.05', 'goldStockCoverage', '<', 1.05, 'critical', 60, 1, 1, NULL),
    ('rule_critical_stock', 'Stock critique', 'Alerte urgente si couverture sous 1.01', 'goldStockCoverage', '<', 1.01, 'critical', 5, 1, 1, NULL),
    ('rule_transaction_spike', 'Pic de transactions', 'Alerte si plus de 100 transactions en 5 minutes', 'transactionsLast5Min', '>', 100, 'warning', 30, 1, 0, NULL),
    ('rule_kyc_backlog', 'File KYC importante', 'Alerte si plus de 20 KYC en attente', 'pendingKyc', '>', 20, 'warning', 60, 1, 0, NULL),
    ('rule_withdrawal_backlog', 'Retraits en attente', 'Alerte si plus de 10 retraits en attente', 'pendingWithdrawals', '>', 10, 'warning', 30, 1, 0, NULL),
    ('rule_high_failure_rate', 'Taux d''échec élevé', 'Alerte si taux d''échec transactions > 10%', 'transactionFailureRate', '>', 10, 'critical', 15, 1, 1, NULL);
