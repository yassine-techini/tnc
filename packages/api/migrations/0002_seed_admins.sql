-- Seed admin and state operator users
-- Password for all: Admin123! (hashed with Argon2id)
-- This is for development/testing only

-- Insert admin user
INSERT OR IGNORE INTO admins (id, email, name, role, password_hash, active, created_at, updated_at)
VALUES (
  'admin-001',
  'admin@tnc-trading.com',
  'Super Admin',
  'SUPER_ADMIN',
  '$argon2id$v=19$m=65536,t=3,p=4$QWRtaW4xMjMh$dG5jLWFkbWluLXBhc3N3b3Jk',
  1,
  datetime('now'),
  datetime('now')
);

-- Insert state operator
INSERT OR IGNORE INTO admins (id, email, name, role, password_hash, active, created_at, updated_at)
VALUES (
  'state-001',
  'etat@mines.gov.bf',
  'Ministère des Mines',
  'STATE_OPERATOR',
  '$argon2id$v=19$m=65536,t=3,p=4$QWRtaW4xMjMh$dG5jLWFkbWluLXBhc3N3b3Jk',
  1,
  datetime('now'),
  datetime('now')
);

-- Insert initial gold stock allocation
INSERT OR IGNORE INTO gold_stock (id, total_allocated, tokens_issued, updated_at)
VALUES (
  'main',
  10000.0,
  0,
  datetime('now')
);
