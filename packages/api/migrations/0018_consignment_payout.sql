-- ============================================
-- 0018 Producer payout in tokens
-- The Dubai audit validation credits the producer's wallet with tokens
-- (1 token = 1 g of refined gold) instead of leaving the allocated weight
-- entirely to the platform. Paying in grams removes any need to fix a gold
-- price or a valuation date for the lot.
-- ============================================

-- 1. New transaction type CONSIGNMENT. SQLite cannot ALTER a CHECK constraint,
--    so `transactions` is rebuilt preserving every column, row and index.
--    withdrawals.transaction_id references transactions(id): with foreign keys
--    enforced, DROP TABLE performs an implicit DELETE that violates it and
--    aborts the migration. `defer_foreign_keys` does NOT help — verified against
--    a real SQLite engine, it fails identically inside and outside an explicit
--    transaction. Enforcement has to be off across the rebuild; ids are
--    preserved, so every reference resolves again once the rename lands.
PRAGMA foreign_keys = OFF;

-- v_daily_stats (0001) selects FROM transactions. SQLite validates views when the
-- schema changes, so dropping the table under it aborts the migration. Dropped
-- here and recreated identically at the end.
DROP VIEW IF EXISTS v_daily_stats;

CREATE TABLE transactions_new (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    wallet_id TEXT NOT NULL REFERENCES wallets(id),
    quote_id TEXT REFERENCES quotes(id),
    type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL', 'FEE', 'CONSIGNMENT')),
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

-- Every index that existed on the old table (0001, 0007, 0014).
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

-- 2. Share of the refined weight paid to the producer, as a fraction of 0..1.
--    Default 1.0 — the producer receives the whole refined weight and the
--    platform earns on the buy/sell spread only. Lower it to fund transport and
--    refining out of the lot itself; the remainder stays as sellable free stock.
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('consignment_producer_share', '1.0', 'Part du poids raffiné créditée au producteur en tokens (0..1)');
