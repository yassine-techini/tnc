/**
 * Two-step settlement: advance on arrival in Dubai, balance at outturn.
 *
 * The property that matters most here is that the producer is paid the right
 * amount ONCE, and that the reserve invariant holds at every intermediate step —
 * including between the advance and the outturn, which is a window that did not
 * exist before.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConsignmentService } from '../../src/services/consignment.service';
import { SettlementService, type AdvanceTerms } from '../../src/services/settlement.service';
import { createTestD1, seedStock, type TestD1 } from '../helpers/real-d1';

const asD1 = (db: TestD1) => db as unknown as D1Database;
const PRODUCER = 'prod-1';
const FORWARDER = { id: 'adm-f', role: 'TRANSITAIRE' };
const AUDITOR = { id: 'adm-d', role: 'DUBAI_VALIDATOR' };

const TOKEN_TERMS: AdvanceTerms = { percent: 0.75, currency: 'TOKENS', haircut: 0.9, pricePerGram: 53_000 };

function stock(db: TestD1) {
  return db.sqlite
    .prepare("SELECT total_allocated, tokens_issued FROM gold_stock WHERE id='main'")
    .get() as { total_allocated: number; tokens_issued: number };
}

function wallet(db: TestD1) {
  const r = db.sqlite
    .prepare('SELECT token_balance, cash_balance FROM wallets WHERE user_id = ?')
    .get(PRODUCER) as { token_balance: number; cash_balance: number } | undefined;
  return r ?? { token_balance: 0, cash_balance: 0 };
}

describe('Settlement (real D1)', () => {
  let db: TestD1;
  let consignments: ConsignmentService;
  let settlement: SettlementService;

  beforeEach(() => {
    db = createTestD1();
    seedStock(db, { totalAllocated: 0, tokensIssued: 0 });
    consignments = new ConsignmentService(asD1(db));
    settlement = new SettlementService(asD1(db));
  });

  const arrived = async () => {
    const lot = await consignments.create({
      producerId: PRODUCER,
      weightDeclaredG: 1000,
      purityDeclared: 0.916,
      goldType: 'nuggets',
    });
    await consignments.forwarderValidate(lot.id, FORWARDER);
    await consignments.startTransit(lot.id, FORWARDER);
    await consignments.arriveDubai(lot.id, FORWARDER);
    return lot;
  };

  it('computes the advance conservatively, on purity and a haircut', () => {
    // 1000 g declared at 0.916, 10% haircut, 75% advance.
    expect(settlement.advanceWeight(1000, 0.916, TOKEN_TERMS)).toBeCloseTo(618.3, 3);
  });

  it('a token advance allocates the gold it issues, keeping the invariant true', async () => {
    const lot = await arrived();
    const r = await settlement.payAdvance(lot.id, TOKEN_TERMS);

    expect(r.ok).toBe(true);
    expect(r.tokensG).toBeCloseTo(618.3, 3);

    const s = stock(db);
    // Allocated AND issued together: the metal is in the vault, counted
    // conservatively, and the claims against it never exceed it.
    expect(s.total_allocated).toBeCloseTo(618.3, 3);
    expect(s.tokens_issued).toBeCloseTo(618.3, 3);
    expect(s.tokens_issued).toBeLessThanOrEqual(s.total_allocated);
    expect(wallet(db).token_balance).toBeCloseTo(618.3, 3);
  });

  it('a cash advance issues no token at all', async () => {
    const lot = await arrived();
    const r = await settlement.payAdvance(lot.id, { ...TOKEN_TERMS, currency: 'CASH' });

    expect(r.ok).toBe(true);
    expect(r.tokensG).toBe(0);
    expect(r.cashXof).toBe(Math.round(618.3 * 53_000));

    const s = stock(db);
    expect(s.tokens_issued).toBe(0);
    expect(s.total_allocated).toBe(0);
    expect(wallet(db).cash_balance).toBe(r.cashXof);
  });

  it('pays the advance once, however many times it is called', async () => {
    const lot = await arrived();
    expect((await settlement.payAdvance(lot.id, TOKEN_TERMS)).ok).toBe(true);

    const second = await settlement.payAdvance(lot.id, TOKEN_TERMS);
    expect(second).toMatchObject({ ok: false, error: 'ALREADY_PAID' });
    expect(wallet(db).token_balance).toBeCloseTo(618.3, 3);
  });

  it('refuses an advance before the lot has arrived', async () => {
    const lot = await consignments.create({
      producerId: PRODUCER,
      weightDeclaredG: 1000,
      purityDeclared: 0.916,
      goldType: 'bar',
    });
    expect(await settlement.payAdvance(lot.id, TOKEN_TERMS)).toMatchObject({
      ok: false,
      error: 'WRONG_STATUS',
    });
    expect(stock(db).tokens_issued).toBe(0);
  });

  it('outturn pays only the BALANCE, never the advance a second time', async () => {
    const lot = await arrived();
    await settlement.payAdvance(lot.id, TOKEN_TERMS); // 618.300 g

    // Assay comes in at 900 g; at 100% share the producer is owed 900 total.
    const r = await consignments.auditValidate(lot.id, AUDITOR, {
      refinedWeightG: 900,
      producerShare: 1,
    });
    expect(r.ok).toBe(true);

    // 900 owed - 618.300 advanced = 281.700 paid now.
    const final = await consignments.getById(lot.id);
    expect(final!.producer_tokens_credited).toBeCloseTo(281.7, 3);
    expect(wallet(db).token_balance).toBeCloseTo(900, 3);

    // And the reserve holds exactly the refined weight: the advance allocated
    // its share, outturn allocated the rest.
    const s = stock(db);
    expect(s.total_allocated).toBeCloseTo(900, 3);
    expect(s.tokens_issued).toBeCloseTo(900, 3);
    expect(s.tokens_issued).toBeLessThanOrEqual(s.total_allocated);
  });

  it('never claws back when the assay comes in under the advance', async () => {
    // Free stock the platform can draw on. It is now REQUIRED in this case:
    // the advance allocated 618.3 g on the declared weight, refining confirms
    // only 500, and the 118.3 g difference has to be backed by real gold the
    // platform already holds (ADR 006). Without it the audit is refused, which
    // is the subject of the next test.
    db.sqlite.prepare("UPDATE gold_stock SET total_allocated = 500 WHERE id = 'main'").run();

    const lot = await arrived();
    await settlement.payAdvance(lot.id, TOKEN_TERMS); // 618.300 g

    // A disappointing outturn: less than what was advanced.
    const r = await consignments.auditValidate(lot.id, AUDITOR, {
      refinedWeightG: 500,
      producerShare: 1,
    });
    expect(r.ok).toBe(true);

    // Nothing further is paid, and nothing is taken back: an over-advance is a
    // commercial matter, not something to settle by debiting a wallet.
    expect((await consignments.getById(lot.id))!.producer_tokens_credited).toBe(0);
    expect(wallet(db).token_balance).toBeCloseTo(618.3, 3);

    const s = stock(db);
    expect(s.tokens_issued).toBeLessThanOrEqual(s.total_allocated);
    // And the gold refining never confirmed is OUT of the reserve. Previously
    // the allocation was clamped at zero, so 118.3 phantom grams stayed in
    // total_allocated and /reserve overstated the physical backing — the
    // invariant held only because the advance had inflated both sides of it.
    expect(s.total_allocated).toBeCloseTo(1000, 3);
  });

  it('refuses the audit when the platform cannot cover a short assay', async () => {
    // No free stock: honouring the 618.3 g already issued would mean claiming
    // backing that does not exist.
    const lot = await arrived();
    await settlement.payAdvance(lot.id, TOKEN_TERMS);

    const r = await consignments.auditValidate(lot.id, AUDITOR, {
      refinedWeightG: 500,
      producerShare: 1,
    });

    // Fail-closed: claims that cannot be backed are not issued. The admin has
    // to allocate stock first, and being told so is useful information.
    expect(r.ok).toBe(false);
    expect((await consignments.getById(lot.id))!.status).toBe('ARRIVED_DUBAI');
    expect(wallet(db).token_balance).toBeCloseTo(618.3, 3);
  });

  it('a cash advance leaves the full token payout at outturn', async () => {
    const lot = await arrived();
    await settlement.payAdvance(lot.id, { ...TOKEN_TERMS, currency: 'CASH' });

    await consignments.auditValidate(lot.id, AUDITOR, { refinedWeightG: 900, producerShare: 1 });

    // No token was advanced, so the whole 900 g is credited now.
    expect((await consignments.getById(lot.id))!.producer_tokens_credited).toBeCloseTo(900, 3);
    expect(wallet(db).token_balance).toBeCloseTo(900, 3);
  });

  it('refuses terms that make no sense rather than paying something arbitrary', async () => {
    const lot = await arrived();
    for (const terms of [
      { ...TOKEN_TERMS, percent: 0 },
      { ...TOKEN_TERMS, percent: 1.5 },
      { ...TOKEN_TERMS, haircut: 0 },
      { ...TOKEN_TERMS, currency: 'CASH' as const, pricePerGram: 0 },
    ]) {
      expect(await settlement.payAdvance(lot.id, terms)).toMatchObject({
        ok: false,
        error: 'INVALID_TERMS',
      });
    }
    expect(stock(db).tokens_issued).toBe(0);
  });
});
