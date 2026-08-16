-- ============================================
-- 0028 Gold lease positions and exit orders
--
-- A holder may put grams into a lease instead of holding them idle. The yield is
-- funded by LENDING the gold out, so opening a position increases
-- `gold_stock.gold_on_loan` — which the reserve attestation already discloses,
-- names the counterparty for, and warns about on /reserve.
--
-- THREE DESIGN POINTS.
--
-- 1. Leased grams LEAVE the wallet and live in the position. If they stayed in
--    `token_balance` the holder could sell gold that is already lent out, which
--    is precisely the double-claim this codebase refuses everywhere else.
--
-- 2. Yield accrues in XOF, never in tokens. A token represents gold and nothing
--    else; paying yield in tokens would issue claims with no metal behind them.
--
-- 3. Exit settles at T+n business days because unwinding a loan takes time. The
--    delay is the recall period, not an arbitrary number.
-- ============================================

CREATE TABLE IF NOT EXISTS lease_positions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  wallet_id TEXT NOT NULL REFERENCES wallets(id),

  principal_g REAL NOT NULL CHECK (principal_g > 0),
  /** Annual rate as a fraction, frozen at opening so a config change is not retroactive. */
  annual_rate REAL NOT NULL CHECK (annual_rate >= 0),

  /** Yield accumulated so far, in XOF. Never a token amount. */
  accrued_xof REAL NOT NULL DEFAULT 0 CHECK (accrued_xof >= 0),
  /** Day already accounted for, so a job re-run cannot pay the same day twice. */
  last_accrued_on TEXT,

  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXITING', 'CLOSED')),

  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lease_positions_user ON lease_positions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_lease_positions_status ON lease_positions(status);

-- Daily accrual trail: one row per position per day, so the yield paid at exit
-- can be reconstructed line by line rather than trusted as a running total.
CREATE TABLE IF NOT EXISTS lease_accruals (
  id TEXT PRIMARY KEY,
  position_id TEXT NOT NULL REFERENCES lease_positions(id) ON DELETE CASCADE,
  accrual_date TEXT NOT NULL,
  principal_g REAL NOT NULL,
  price_per_gram REAL NOT NULL,
  annual_rate REAL NOT NULL,
  amount_xof REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- One accrual per position per day. This UNIQUE is what makes the job safe to
  -- re-run: a duplicate fails the insert instead of paying twice.
  UNIQUE (position_id, accrual_date)
);

CREATE TABLE IF NOT EXISTS lease_exit_orders (
  id TEXT PRIMARY KEY,
  position_id TEXT NOT NULL UNIQUE REFERENCES lease_positions(id),
  user_id TEXT NOT NULL REFERENCES users(id),

  principal_g REAL NOT NULL,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  /** Business-day settlement date — the loan recall period. */
  settles_on TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SETTLED', 'FAILED')),
  settled_at TEXT,
  price_per_gram REAL,
  proceeds_xof REAL,
  yield_xof REAL,
  failure_reason TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lease_exit_orders_pending ON lease_exit_orders(status, settles_on);

INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('lease_annual_rate', '0.06', 'Taux annuel de la location d''or (fraction, ex. 0.06 = 6 %/an)'),
    ('lease_exit_settlement_days', '3', 'Délai de règlement en jours ouvrés pour une sortie de location'),
    ('lease_min_grams', '1', 'Montant minimum en grammes pour ouvrir une position de location');
