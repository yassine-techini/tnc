-- Add suspension columns to users table
-- Referenced by admin.ts suspend/unsuspend endpoints

ALTER TABLE users ADD COLUMN suspended INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN suspended_at TEXT;
ALTER TABLE users ADD COLUMN suspended_until TEXT;
ALTER TABLE users ADD COLUMN suspension_reason TEXT;
