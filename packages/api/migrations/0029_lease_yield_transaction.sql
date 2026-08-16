-- ============================================
-- 0029 Transaction type LEASE_YIELD
--
-- The lease yield is paid in XOF into the cash balance. It needs to appear in
-- the transaction history like any other movement of money — a holder who sees
-- their cash balance rise must be able to find out why.
--
-- It is deliberately NOT a DEPOSIT: a deposit is money the holder brought in,
-- a yield is money the platform owes them. Conflating the two would corrupt
-- every report that sums deposits.
--
-- Same rebuild as 0018: SQLite cannot ALTER a CHECK constraint, and enforcement
-- has to be off across the rebuild because withdrawals.transaction_id references
-- transactions(id) (`defer_foreign_keys` does not help — verified).
-- ============================================

PRAGMA foreign_keys = OFF;

-- v_daily_stats selects FROM transactions; SQLite validates views on schema
-- change, so it is dropped and recreated identically.
DROP VIEW IF EXISTS v_daily_stats;

CREATE TABLE transactions_new (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    wallet_id TEXT NOT NULL REFERENCES wallets(id),
    quote_id TEXT REFERENCES quotes(id),
    type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL', 'FEE', 'CONSIGNMENT', 'LEASE_YIELD')),
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

INSERT INTO transactions_new (
    id, user_id, wallet_id, quote_id, type, status, token_amount, cash_amount,
    price_per_gram, fees, payment_method, payment_reference, payout_method,
    payout_reference, failure_reason, metadata, created_at, completed_at, updated_at
)
SELECT
    id, user_id, wallet_id, quote_id, type, status, token_amount, cash_amount,
    price_per_gram, fees, payment_method, payment_reference, payout_method,
    payout_reference, failure_reason, metadata, created_at, completed_at, updated_at
FROM transactions;

DROP TABLE transactions;
ALTER TABLE transactions_new RENAME TO transactions;

-- Every index that existed on the old table (0001, 0007, 0014, 0018).
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_wallet ON transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_user_type_status ON transactions(user_id, type, status);
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user_completed_at ON transactions(user_id, completed_at DESC);

-- Recreated verbatim from 0001.
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

PRAGMA foreign_keys = ON;
