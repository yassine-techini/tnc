-- Migration 0009: RBAC (admin permissions) + Integrations management
-- =================================================================

-- Admin permission overrides (supplements role-based defaults)
CREATE TABLE IF NOT EXISTS admin_permissions (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id),
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  granted INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(admin_id, module, action)
);
CREATE INDEX IF NOT EXISTS idx_admin_permissions_admin ON admin_permissions(admin_id);

-- Third-party service integrations configuration
CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  config TEXT DEFAULT '{}',
  last_tested_at TEXT,
  last_test_result TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT REFERENCES admins(id)
);

-- Seed integrations with all providers (disabled by default)
INSERT OR IGNORE INTO integrations (id, provider, display_name, category, enabled, config) VALUES
  ('int_orange',   'orange_money',    'Orange Money',    'payment',      0, '{"merchant_id":"","callback_url":""}'),
  ('int_moov',     'moov_money',      'Moov Money',      'payment',      0, '{"merchant_id":"","callback_url":""}'),
  ('int_cinetpay', 'cinetpay',        'CinetPay',        'payment',      0, '{"site_id":"","callback_url":""}'),
  ('int_stripe',   'stripe',          'Stripe',          'payment',      0, '{"callback_url":""}'),
  ('int_twilio',   'twilio',          'Twilio',          'notification', 0, '{"phone_number":""}'),
  ('int_resend',   'resend',          'Resend',          'notification', 0, '{"from_email":"noreply@tnc-trading.com"}'),
  ('int_sendgrid', 'sendgrid',        'SendGrid',        'notification', 0, '{"from_email":"noreply@tnc-trading.com"}'),
  ('int_fcm',      'fcm',             'Firebase Cloud Messaging', 'notification', 0, '{}'),
  ('int_smile',    'smile_identity',  'Smile Identity',  'kyc',          0, '{"partner_id":"","callback_url":"","environment":"sandbox"}'),
  ('int_goldapi',  'gold_api',        'GoldAPI',         'market',       0, '{}');
