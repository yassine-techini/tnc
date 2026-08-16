/**
 * Gold lease positions.
 *
 * Three properties are load-bearing and tested as such: leased grams leave the
 * wallet (so they cannot also be sold), the gold is registered as lent (so the
 * reserve attestation discloses it), and accrual cannot pay the same day twice.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LeaseService, type LeaseExitOrderRow } from '../../src/services/lease.service';
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

function cash(db: TestD1): number {
  const r = db.sqlite.prepare('SELECT cash_balance FROM wallets WHERE id = ?').get(WALLET) as {
    cash_balance: number;
  };
  return r.cash_balance;
}

function orderFor(db: TestD1, positionId: string): LeaseExitOrderRow {
  return db.sqlite
    .prepare('SELECT * FROM lease_exit_orders WHERE position_id = ?')
    .get(positionId) as LeaseExitOrderRow;
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

  describe('exit settlement (ADR 004: the gold comes back, it is not sold)', () => {
    async function openAndExit(grams = 100, days = ['2026-08-16', '2026-08-17']) {
      const r = await svc.open(USER, grams, RATE, 1);
      for (const day of days) {
        await svc.accrueDay((await svc.getById(r.position!.id))!, day, PRICE);
      }
      await svc.requestExit(r.position!.id, USER, 3, new Date('2026-08-13T10:00:00Z'));
      return { positionId: r.position!.id, order: orderFor(db, r.position!.id) };
    }

    it('returns the grams, pays the yield in XOF and closes the position', async () => {
      const { positionId, order } = await openAndExit();
      const result = await svc.settleExit(order, PRICE);

      expect(result).toMatchObject({ ok: true, principalG: 100, yieldXof: 1742 });
      // The gold is back and spendable.
      expect(balance(db)).toBe(500);
      // It is back in the vault, so the disclosure stops flagging it.
      expect(stock(db).gold_on_loan).toBe(0);
      // The yield is money, on the cash side.
      expect(cash(db)).toBe(1742);
      expect((await svc.getById(positionId))!.status).toBe('CLOSED');
    });

    it('is the exact inverse of opening — no token created or destroyed', async () => {
      const before = stock(db);
      const { order } = await openAndExit();
      await svc.settleExit(order, PRICE);
      const after = stock(db);

      expect(after.tokens_issued).toBe(before.tokens_issued);
      expect(after.total_allocated).toBe(before.total_allocated);
      expect(after.gold_on_loan).toBe(before.gold_on_loan);
      expect(after.tokens_issued).toBeLessThanOrEqual(after.total_allocated);
    });

    it('records the yield as LEASE_YIELD, not as a deposit', async () => {
      const { order } = await openAndExit();
      await svc.settleExit(order, PRICE);

      const tx = db.sqlite
        .prepare('SELECT type, cash_amount, token_amount, status FROM transactions WHERE user_id = ?')
        .all(USER) as { type: string; cash_amount: number; token_amount: number | null; status: string }[];

      // A deposit is money the holder brought in; conflating the two would
      // corrupt every report that sums deposits.
      expect(tx).toHaveLength(1);
      expect(tx[0]).toMatchObject({ type: 'LEASE_YIELD', cash_amount: 1742, status: 'COMPLETED' });
      // The yield is XOF. It must not carry a token amount.
      expect(tx[0].token_amount).toBeNull();
    });

    it('settles once even if the job runs twice', async () => {
      const { order } = await openAndExit();
      expect((await svc.settleExit(order, PRICE)).ok).toBe(true);

      // Same order replayed — the guard must stop everything, not just the flip.
      const replay = await svc.settleExit(order, PRICE);
      expect(replay.ok).toBe(false);
      expect(balance(db)).toBe(500); // not 600
      expect(cash(db)).toBe(1742); // not 3484
      expect(stock(db).gold_on_loan).toBe(0);
    });

    it('settles a position that never accrued, without a phantom transaction', async () => {
      const { order } = await openAndExit(100, []);
      const result = await svc.settleExit(order, PRICE);

      expect(result).toMatchObject({ ok: true, principalG: 100, yieldXof: 0 });
      expect(balance(db)).toBe(500);
      expect(cash(db)).toBe(0);
      // No money moved, so no money movement is recorded.
      const count = db.sqlite
        .prepare('SELECT COUNT(*) c FROM transactions WHERE user_id = ?')
        .get(USER) as { c: number };
      expect(count.c).toBe(0);
    });

    it('records the spot value for the statement without selling anything', async () => {
      const { order } = await openAndExit();
      await svc.settleExit(order, PRICE);

      const settled = db.sqlite
        .prepare('SELECT * FROM lease_exit_orders WHERE id = ?')
        .get(order.id) as LeaseExitOrderRow;
      expect(settled.status).toBe('SETTLED');
      expect(settled.price_per_gram).toBe(PRICE);
      expect(settled.proceeds_xof).toBe(100 * PRICE);
      expect(settled.yield_xof).toBe(1742);
      // Informational only: the grams are in the wallet, not sold.
      expect(balance(db)).toBe(500);
    });

    it('still returns the gold when no price is available', async () => {
      const { order } = await openAndExit(100, []);
      // A missing price must not strand a holder's gold in a lease.
      const result = await svc.settleExit(order, 0);
      expect(result.ok).toBe(true);
      expect(balance(db)).toBe(500);
    });

    it('lists orders only once they are due', async () => {
      await openAndExit(100, []);
      expect(await svc.dueExitOrders(new Date('2026-08-17T12:00:00Z'))).toHaveLength(0);
      expect(await svc.dueExitOrders(new Date('2026-08-18T00:00:00Z'))).toHaveLength(1);
    });

    it('drops a settled order out of the due list', async () => {
      const { order } = await openAndExit(100, []);
      await svc.settleExit(order, PRICE);
      expect(await svc.dueExitOrders(new Date('2026-08-25T00:00:00Z'))).toHaveLength(0);
    });

    it('marks an unsettleable order FAILED instead of retrying it forever', async () => {
      const { order } = await openAndExit(100, []);
      await svc.failExit(order.id, 'NOT_ACTIVE');

      const failed = orderFor(db, order.position_id);
      expect(failed).toMatchObject({ status: 'FAILED', failure_reason: 'NOT_ACTIVE' });
      expect(await svc.dueExitOrders(new Date('2026-08-25T00:00:00Z'))).toHaveLength(0);
    });
  });
});
