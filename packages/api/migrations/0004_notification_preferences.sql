-- Notification Preferences & Price Alerts Migration

-- User notification preferences
CREATE TABLE IF NOT EXISTS notification_preferences (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email INTEGER NOT NULL DEFAULT 1,
    sms INTEGER NOT NULL DEFAULT 1,
    price_alerts INTEGER NOT NULL DEFAULT 0,
    transaction_alerts INTEGER NOT NULL DEFAULT 1,
    marketing_emails INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_user ON notification_preferences(user_id);

-- Price alerts for users
CREATE TABLE IF NOT EXISTS price_alerts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL CHECK (alert_type IN ('ABOVE', 'BELOW')),
    target_price REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'XOF' CHECK (currency IN ('XOF', 'USD')),
    notification_method TEXT NOT NULL DEFAULT 'PUSH' CHECK (notification_method IN ('PUSH', 'EMAIL', 'SMS', 'ALL')),
    is_active INTEGER NOT NULL DEFAULT 1,
    triggered INTEGER NOT NULL DEFAULT 0,
    triggered_at TEXT,
    triggered_price REAL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_price_alerts_user ON price_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_active ON price_alerts(is_active, triggered);
CREATE INDEX IF NOT EXISTS idx_price_alerts_type ON price_alerts(alert_type, target_price);
