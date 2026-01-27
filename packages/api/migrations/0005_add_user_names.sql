-- Migration: Add first_name and last_name columns to users table
-- Date: 2026-01-26

-- Add first_name column
ALTER TABLE users ADD COLUMN first_name TEXT;

-- Add last_name column
ALTER TABLE users ADD COLUMN last_name TEXT;

-- Create index for name search
CREATE INDEX IF NOT EXISTS idx_users_names ON users(first_name, last_name);
