/**
 * A minimal, REAL D1-compatible database backed by Node's built-in `node:sqlite`.
 *
 * The rest of the test suite mocks D1 (batch is a no-op, run() always returns
 * changes:1, no CHECK constraints), so it cannot validate the atomicity /
 * rollback / invariant guarantees the financial flows rely on. This adapter runs
 * the SAME SQL the services emit against a real SQLite engine that enforces the
 * production CHECK constraints and gives `db.batch()` genuine all-or-nothing
 * transaction semantics — so tests can prove those guarantees.
 *
 * It implements just enough of the D1Database surface used by the services:
 * prepare().bind().first()/all()/run() and batch() (atomic).
 */
import { createRequire } from 'node:module';

// Load node:sqlite via createRequire so Vite/Vitest doesn't try to statically
// resolve it (it's newer than Vite's built-in module list).
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

class TestPreparedStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = []
  ) {}

  bind(...args: unknown[]): TestPreparedStatement {
    return new TestPreparedStatement(this.db, this.sql, args);
  }

  async first<T = unknown>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...(this.params as never[]));
    return (row ?? null) as T | null;
  }

  async all<T = unknown>(): Promise<{ results: T[]; meta: { changes: number }; success: boolean }> {
    const rows = this.db.prepare(this.sql).all(...(this.params as never[]));
    return { results: rows as T[], meta: { changes: 0 }, success: true };
  }

  async run(): Promise<{ meta: { changes: number; last_row_id: number }; success: boolean }> {
    const info = this.db.prepare(this.sql).run(...(this.params as never[]));
    return {
      meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
      success: true,
    };
  }
}

export class TestD1 {
  readonly sqlite: DatabaseSync;

  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
  }

  exec(sql: string): void {
    this.sqlite.exec(sql);
  }

  prepare(sql: string): TestPreparedStatement {
    return new TestPreparedStatement(this.sqlite, sql);
  }

  /** Atomic, all-or-nothing — mirrors D1's implicit transaction. */
  async batch(stmts: TestPreparedStatement[]): Promise<unknown[]> {
    this.sqlite.exec('BEGIN');
    try {
      const results: unknown[] = [];
      for (const s of stmts) results.push(await s.run());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (e) {
      try { this.sqlite.exec('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    }
  }
}

/**
 * Schema subset with the SAME columns and CHECK constraints as
 * migrations/0001_initial_schema.sql for the tables the financial flows touch.
 * Foreign keys are intentionally omitted (SQLite leaves them off by default),
 * so rows can be seeded without the full relational graph.
 */
const SCHEMA = `
CREATE TABLE wallets (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  token_balance REAL DEFAULT 0 CHECK (token_balance >= 0),
  cash_balance REAL DEFAULT 0 CHECK (cash_balance >= 0),
  total_bought REAL DEFAULT 0,
  total_spent REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE gold_stock (
  id TEXT PRIMARY KEY DEFAULT 'main',
  total_allocated REAL NOT NULL DEFAULT 0,
  tokens_issued REAL NOT NULL DEFAULT 0,
  gold_on_loan REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (tokens_issued <= total_allocated)
);
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('BUY','SELL','DEPOSIT','WITHDRAWAL','FEE','CONSIGNMENT','LEASE_YIELD')),
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED','CANCELLED')),
  token_amount REAL,
  cash_amount REAL NOT NULL,
  price_per_gram REAL,
  fees REAL DEFAULT 0,
  payment_method TEXT,
  payment_reference TEXT,
  -- Present in production since 0001/0018; missing here until a statement that
  -- writes them failed against the harness only. The harness has to mirror the
  -- real schema or it certifies queries production would reject.
  quote_id TEXT,
  payout_method TEXT,
  payout_reference TEXT,
  metadata TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE withdrawals (
  id TEXT PRIMARY KEY,
  transaction_id TEXT UNIQUE NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('orange_money','moov_money','bank')),
  amount REAL NOT NULL,
  fees REAL NOT NULL,
  net_amount REAL NOT NULL,
  phone_number TEXT,
  bank_account TEXT,
  bank_name TEXT,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','PROCESSING','COMPLETED','FAILED','REJECTED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  admin_id TEXT,
  action TEXT,
  entity_type TEXT,
  entity_id TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE gold_consignments (
  id TEXT PRIMARY KEY,
  reference TEXT UNIQUE NOT NULL,
  producer_id TEXT NOT NULL,
  weight_declared_g REAL NOT NULL CHECK (weight_declared_g > 0),
  purity_declared REAL NOT NULL CHECK (purity_declared > 0 AND purity_declared <= 1),
  gold_type TEXT NOT NULL CHECK (gold_type IN ('nuggets','powder','bar')),
  origin_country TEXT DEFAULT 'BF',
  origin_gps_lat REAL,
  origin_gps_lng REAL,
  photos TEXT,
  estimated_value_xof REAL,
  status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','FORWARDER_VALIDATED','IN_TRANSIT','ARRIVED_DUBAI','AUDIT_VALIDATED','REJECTED')),
  forwarder_id TEXT,
  forwarder_validated_at TEXT,
  transit_started_at TEXT,
  arrived_dubai_at TEXT,
  refined_weight_g REAL,
  producer_tokens_credited REAL,
  refinery_lot TEXT,
  lbma_certificate TEXT,
  audited_by TEXT,
  audited_at TEXT,
  rejection_reason TEXT,
  advance_tokens_g REAL,
  advance_cash_xof REAL,
  advance_paid_at TEXT,
  advance_price_per_gram REAL,
  balance_tokens_g REAL,
  balance_cash_xof REAL,
  balance_paid_at TEXT,
  origin_zone TEXT,
  origin_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE consignment_documents (
  id TEXT PRIMARY KEY,
  consignment_id TEXT NOT NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('CERTIFICATE_OF_ORIGIN','MINING_DECLARATION','TRANSPORT_DOCUMENT','ASSAY_REPORT','OTHER')),
  issuer TEXT,
  reference TEXT,
  issued_at TEXT,
  r2_key TEXT NOT NULL UNIQUE,
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('TRANSACTION','KYC','SECURITY','MARKETING','SYSTEM')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data TEXT,
  read INTEGER DEFAULT 0,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE push_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('ios','android','web')),
  device_id TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE lease_positions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  principal_g REAL NOT NULL CHECK (principal_g > 0),
  annual_rate REAL NOT NULL CHECK (annual_rate >= 0),
  accrued_xof REAL NOT NULL DEFAULT 0 CHECK (accrued_xof >= 0),
  last_accrued_on TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXITING','CLOSED')),
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE lease_accruals (
  id TEXT PRIMARY KEY,
  position_id TEXT NOT NULL,
  accrual_date TEXT NOT NULL,
  principal_g REAL NOT NULL,
  price_per_gram REAL NOT NULL,
  annual_rate REAL NOT NULL,
  amount_xof REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (position_id, accrual_date)
);
CREATE TABLE lease_exit_orders (
  id TEXT PRIMARY KEY,
  position_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  principal_g REAL NOT NULL,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  settles_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SETTLED','FAILED')),
  settled_at TEXT,
  price_per_gram REAL,
  proceeds_xof REAL,
  yield_xof REAL,
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE gold_loans (
  id TEXT PRIMARY KEY,
  counterparty TEXT NOT NULL,
  weight_g REAL NOT NULL CHECK (weight_g > 0),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  due_at TEXT,
  returned_at TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETURNED','DEFAULTED')),
  reference TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE reserve_attestations (
  id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL UNIQUE,
  previous_digest TEXT,
  digest TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  signature TEXT,
  signing_key_id TEXT,
  anchor_chain TEXT,
  anchor_tx_hash TEXT,
  anchored_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  kyc_level TEXT DEFAULT 'BASIC' CHECK (kyc_level IN ('BASIC','STANDARD','VERIFIED')),
  kyc_status TEXT DEFAULT 'PENDING' CHECK (kyc_status IN ('PENDING','SUBMITTED','APPROVED','REJECTED','EXPIRED')),
  role TEXT NOT NULL DEFAULT 'investor',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE certificates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  verification_code TEXT NOT NULL UNIQUE,
  token_balance REAL NOT NULL,
  -- 0030: grams in an open lease. Stored, not recomputed, so an old
  -- certificate reproduces exactly as it was issued.
  leased_balance REAL NOT NULL DEFAULT 0,
  user_name TEXT NOT NULL,
  user_email TEXT NOT NULL,
  kyc_level TEXT NOT NULL DEFAULT 'BASIC',
  status TEXT NOT NULL DEFAULT 'VALID' CHECK(status IN ('VALID','REVOKED','EXPIRED')),
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  revoked_at TEXT,
  revocation_reason TEXT,
  verification_count INTEGER NOT NULL DEFAULT 0,
  last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE producer_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('INDIVIDUAL','COOPERATIVE','COMPANY','REFINER')),
  legal_name TEXT NOT NULL,
  registration_number TEXT,
  mining_authorization TEXT,
  tax_id TEXT,
  address TEXT,
  city TEXT,
  region TEXT,
  country TEXT NOT NULL DEFAULT 'BF',
  -- Corridor (0027): only meaningful for a REFINER.
  corridor_origin_country TEXT,
  corridor_destination_country TEXT,
  representative_name TEXT NOT NULL,
  representative_role TEXT,
  representative_phone TEXT,
  documents TEXT,
  status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','PROCESSING','VERIFIED','REJECTED')),
  rejection_reason TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE consignment_events (
  id TEXT PRIMARY KEY,
  consignment_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_id TEXT,
  actor_role TEXT,
  note TEXT,
  gps_lat REAL,
  gps_lng REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export function createTestD1(): TestD1 {
  const db = new TestD1();
  db.exec(SCHEMA);
  return db;
}

/** Seed a wallet row. */
export function seedWallet(
  db: TestD1,
  p: { id: string; userId: string; cash?: number; tokens?: number }
): void {
  db.sqlite.prepare(
    `INSERT INTO wallets (id, user_id, cash_balance, token_balance) VALUES (?, ?, ?, ?)`
  ).run(p.id, p.userId, p.cash ?? 0, p.tokens ?? 0);
}

/** Seed the singleton gold stock row. */
export function seedStock(db: TestD1, p: { totalAllocated: number; tokensIssued?: number }): void {
  db.sqlite.prepare(
    `INSERT INTO gold_stock (id, total_allocated, tokens_issued) VALUES ('main', ?, ?)`
  ).run(p.totalAllocated, p.tokensIssued ?? 0);
}
