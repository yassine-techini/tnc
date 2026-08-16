/**
 * Gold lease positions.
 *
 * Three properties are load-bearing and tested as such: leased grams leave the
 * wallet (so they cannot also be sold), the gold is registered as lent (so the
 * reserve attestation discloses it), and accrual cannot pay the same day twice.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LeaseService } from '../../src/services/lease.service';
import { createTestD1, seedStock, seedWallet, type TestD1 } from '../helpers/real-d1';

const asD1 = (db: TestD1) => db as unknown as D1Database;
const USER = 'user-1';
const WALLET = 'wallet-1';
const RATE = 0.06;
const PRICE = 53_000;

function stock(db: TestD1) {
  return db.sqlite
    .prepare("SELECT total_allocated, tokens_issued, gold_on_loan FROM gold_stock WHERE id='main'")
    .get() as { total_allocated: number; tokens_issued: number; gold_on_loan: number };
}

function balance(db: TestD1): number {
  const r = db.sqlite.prepare('SELECT token_balance FROM wallets WHERE id = ?').get(WALLET) as {
    token_balance: number;
  };
  return r.token_balance;
}

describe('LeaseService (real D1)', () => {
  let db: TestD1;
  let svc: LeaseService;

  beforeEach(() => {
    db = createTestD1();
    seedStock(db, { totalAllocated: 1000, tokensIssued: 500 });
    seedWallet(db, { id: WALLET, userId: USER, tokens: 500 });
    svc = new LeaseService(asD1(db));
  });

  it('moves the grams out of the wallet and registers them as lent', async () => {
    const r = await svc.open(USER, 100, RATE, 1);

    expect(r.ok).toBe(true);
    // Out of the wallet: they cannot also be sold.
    expect(balance(db)).toBe(400);
    // And disclosed as lent, which is what /reserve warns about.
    expect(stock(db).gold_on_loan).toBe(100);
    expect(r.position!.principal_g).toBe(100);
    expect(r.position!.status).toBe('ACTIVE');
  });

  it('freezes the rate at opening, so a config change is not retroactive', async () => {
    const r = await svc.open(USER, 100, 0.06, 1);
    expect(r.position!.annual_rate).toBe(0.06);
  });

  it('refuses to lease more than the wallet holds', async () => {
    const r = await svc.open(USER, 600, RATE, 1);
    expect(r).toMatchObject({ ok: false, error: 'INSUFFICIENT_BALANCE' });
    // Nothing moved, nothing lent.
    expect(balance(db)).toBe(500);
    expect(stock(db).gold_on_loan).toBe(0);
  });

  it('refuses an amount below the minimum', async () => {
    expect(await svc.open(USER, 0.5, RATE, 1)).toMatchObject({ ok: false, error: 'BELOW_MINIMUM' });
    expect(await svc.open(USER, 0, RATE, 1)).toMatchObject({ ok: false, error: 'BELOW_MINIMUM' });
    expect(stock(db).gold_on_loan).toBe(0);
  });

  it('accrues yield in XOF, never in tokens', async () => {
    const r = await svc.open(USER, 100, RATE, 1);
    const accrual = await svc.accrueDay(r.position!, '2026-08-16', PRICE);

    // 100 g x 53 000 XOF x 6% / 365 = 871 XOF
    expect(accrual).toMatchObject({ ok: true, amountXof: 871 });

    const after = await svc.getById(r.position!.id);
    expect(after!.accrued_xof).toBe(871);
    // The token side is untouched: no claim was created by the yield.
    expect(balance(db)).toBe(400);
    expect(stock(db).tokens_issued).toBe(500);
  });

  it('never pays the same day twice, however often the job runs', async () => {
    const r = await svc.open(USER, 100, RATE, 1);

    expect((await svc.accrueDay(r.position!, '2026-08-16', PRICE)).ok).toBe(true);
    // Re-running the job for the same day is a no-op, not a second payment.
    const again = await svc.accrueDay(await svc.getById(r.position!.id) as never, '2026-08-16', PRICE);
    expect(again.ok).toBe(false);

    expect((await svc.getById(r.position!.id))!.accrued_xof).toBe(871);
  });

  it('accumulates across days and keeps a line-by-line trail', async () => {
    const r = await svc.open(USER, 100, RATE, 1);
    for (const day of ['2026-08-16', '2026-08-17', '2026-08-18']) {
      const current = await svc.getById(r.position!.id);
      await svc.accrueDay(current!, day, PRICE);
    }

    expect((await svc.getById(r.position!.id))!.accrued_xof).toBe(871 * 3);
    // The total can be reconstructed rather than trusted.
    const rows = db.sqlite
      .prepare('SELECT COUNT(*) c, SUM(amount_xof) s FROM lease_accruals WHERE position_id = ?')
      .get(r.position!.id) as { c: number; s: number };
    expect(rows).toMatchObject({ c: 3, s: 871 * 3 });
  });

  it('lists positions still owed accrual for a given day', async () => {
    const r = await svc.open(USER, 100, RATE, 1);
    expect(await svc.positionsToAccrue('2026-08-16')).toHaveLength(1);

    await svc.accrueDay(r.position!, '2026-08-16', PRICE);
    expect(await svc.positionsToAccrue('2026-08-16')).toHaveLength(0);
    // The next day it is due again.
    expect(await svc.positionsToAccrue('2026-08-17')).toHaveLength(1);
  });

  it('an exit request stops accrual and settles after the recall period', async () => {
    const r = await svc.open(USER, 100, RATE, 1);
    // Thursday: T+3 business days lands on the following Tuesday.
    const exit = await svc.requestExit(r.position!.id, USER, 3, new Date('2026-08-13T10:00:00Z'));

    expect(exit).toMatchObject({ ok: true, settlesOn: '2026-08-18' });
    expect((await svc.getById(r.position!.id))!.status).toBe('EXITING');
    // An exiting position no longer earns.
    expect(await svc.positionsToAccrue('2026-08-17')).toHaveLength(0);
  });

  it('refuses a second exit request on the same position', async () => {
    const r = await svc.open(USER, 100, RATE, 1);
    await svc.requestExit(r.position!.id, USER, 3);
    expect(await svc.requestExit(r.position!.id, USER, 3)).toMatchObject({
      ok: false,
      error: 'ALREADY_EXITING',
    });
  });

  it('does not let one holder exit another holder position', async () => {
    const r = await svc.open(USER, 100, RATE, 1);
    expect(await svc.requestExit(r.position!.id, 'someone-else', 3)).toMatchObject({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect((await svc.getById(r.position!.id))!.status).toBe('ACTIVE');
  });

  it('keeps the reserve invariant across an opening', async () => {
    await svc.open(USER, 100, RATE, 1);
    const s = stock(db);
    // Lending does not create or destroy claims; it moves metal out of the vault.
    expect(s.tokens_issued).toBeLessThanOrEqual(s.total_allocated);
    expect(s.total_allocated - s.gold_on_loan).toBe(900); // vaulted
  });
});
