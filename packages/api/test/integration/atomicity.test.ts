/**
 * Integration tests against a REAL SQLite (node:sqlite) that enforces the
 * production CHECK constraints and gives db.batch() genuine transaction
 * semantics. Unlike the mocked-D1 unit tests, these prove the atomicity,
 * rollback and invariant guarantees the financial flows depend on.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { WalletService, raisonDeLEchec } from '../../src/services/wallet.service';
import { PaymentService, type WebhookPayload } from '../../src/services/payment.service';
import { createTestD1, seedWallet, seedStock, type TestD1 } from '../helpers/real-d1';
import { createMockKVNamespace } from '../setup';

const asD1 = (db: TestD1) => db as unknown as D1Database;

function getWallet(db: TestD1, id: string) {
  return db.sqlite.prepare('SELECT cash_balance, token_balance FROM wallets WHERE id = ?').get(id) as
    | { cash_balance: number; token_balance: number }
    | undefined;
}
function getStock(db: TestD1) {
  return db.sqlite.prepare("SELECT total_allocated, tokens_issued FROM gold_stock WHERE id = 'main'").get() as
    | { total_allocated: number; tokens_issued: number }
    | undefined;
}
function getTx(db: TestD1, id: string) {
  return db.sqlite.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
}

describe('Atomicity & invariants (real D1)', () => {
  let db: TestD1;
  let wallet: WalletService;

  beforeEach(() => {
    db = createTestD1();
    seedStock(db, { totalAllocated: 100, tokensIssued: 0 });
    seedWallet(db, { id: 'w1', userId: 'u1', cash: 1_000_000, tokens: 0 });
    wallet = new WalletService(asD1(db));
  });

  // ─── BUY ────────────────────────────────────────────────
  describe('executeBuyAtomic', () => {
    it('commits stock reservation + cash debit + token credit + transaction together', async () => {
      const r = await wallet.executeBuyAtomic({
        transactionId: 'tx1', userId: 'u1', walletId: 'w1',
        tokenAmount: 1, cashAmount: 53634, total: 53634, pricePerGram: 53634, fees: 0,
      });
      expect(r.ok).toBe(true);
      expect(getWallet(db, 'w1')).toEqual({ cash_balance: 1_000_000 - 53634, token_balance: 1 });
      expect(getStock(db)!.tokens_issued).toBe(1);
      expect(getTx(db, 'tx1')).toMatchObject({ status: 'COMPLETED', type: 'BUY' });
    });

    it('rolls back entirely and reports INSUFFICIENT_BALANCE when cash is short', async () => {
      const r = await wallet.executeBuyAtomic({
        transactionId: 'tx2', userId: 'u1', walletId: 'w1',
        tokenAmount: 1, cashAmount: 2_000_000, total: 2_000_000, pricePerGram: 2_000_000, fees: 0,
      });
      expect(r).toEqual({ ok: false, reason: 'INSUFFICIENT_BALANCE' });
      // Nothing changed anywhere.
      expect(getWallet(db, 'w1')).toEqual({ cash_balance: 1_000_000, token_balance: 0 });
      expect(getStock(db)!.tokens_issued).toBe(0);
      expect(getTx(db, 'tx2')).toBeUndefined();
    });

    it('rolls back and reports INSUFFICIENT_STOCK when stock is short', async () => {
      const r = await wallet.executeBuyAtomic({
        transactionId: 'tx3', userId: 'u1', walletId: 'w1',
        tokenAmount: 200, cashAmount: 100, total: 100, pricePerGram: 0.5, fees: 0,
      });
      expect(r).toEqual({ ok: false, reason: 'INSUFFICIENT_STOCK' });
      expect(getStock(db)!.tokens_issued).toBe(0);
      expect(getWallet(db, 'w1')!.cash_balance).toBe(1_000_000);
    });
  });

  // ─── LE MOTIF NE DEPEND PLUS DU TEXTE DE L'ERREUR ───────
  describe("pourquoi un lot a echoue", () => {
    /**
     * Le motif etait deduit du MESSAGE de l'erreur :
     *
     *     if (msg.includes('tokens_issued') || msg.includes('total_allocated'))
     *
     * Cela tient tant que SQLite recopie l'expression de la contrainte. Nommer
     * celle-ci — chose banale dans une migration — donne « CHECK constraint
     * failed: stock_couvert », et `INSUFFICIENT_STOCK` devenait silencieusement
     * `CONFLICT` : le titulaire s'entendait dire « reessayez » alors qu'il n'y
     * avait pas assez d'or (ADR 023).
     */
    /**
     * Testee DIRECTEMENT, et non a travers `executeBuyAtomic` : celui-ci fait un
     * controle prealable en JavaScript qui court-circuite avant la contrainte,
     * si bien qu'un test passant par lui n'atteindrait jamais cette fonction et
     * passerait au vert sans rien verifier.
     */
    it('reconnait le manque de stock sans lire le message', async () => {
      const d = createTestD1();
      seedStock(d, { totalAllocated: 100, tokensIssued: 95 });
      seedWallet(d, { id: 'w', userId: 'u', cash: 1_000_000, tokens: 0 });

      const motif = await raisonDeLEchec(asD1(d), { walletId: 'w', stockDemandeG: 50, besoinEspeces: 1 });

      expect(motif).toBe('INSUFFICIENT_STOCK');
    });

    it('distingue le solde du stock', async () => {
      const d = createTestD1();
      seedStock(d, { totalAllocated: 1000, tokensIssued: 0 });
      seedWallet(d, { id: 'w', userId: 'u', cash: 10, tokens: 0 });

      const motif = await raisonDeLEchec(asD1(d), { walletId: 'w', stockDemandeG: 1, besoinEspeces: 5_000 });

      expect(motif).toBe('INSUFFICIENT_BALANCE');
    });

    it('ne depend pas du texte de l erreur, donc une contrainte NOMMEE ne change rien', async () => {
      // Le motif etait deduit du message : nommer la contrainte donnait
      // « CHECK constraint failed: stock_couvert », et `INSUFFICIENT_STOCK`
      // devenait silencieusement `CONFLICT`. Ici aucun message n'est lu.
      const d = createTestD1();
      seedStock(d, { totalAllocated: 10, tokensIssued: 10 });
      seedWallet(d, { id: 'w', userId: 'u', cash: 1_000_000, tokens: 0 });

      const motif = await raisonDeLEchec(asD1(d), { walletId: 'w', stockDemandeG: 1, besoinEspeces: 1 });

      expect(motif).toBe('INSUFFICIENT_STOCK');
    });

    it("rend CONFLICT quand l'etat autorisait pourtant l'operation", async () => {
      // Chemin complet : ni le stock ni le solde ne manquent, l'echec vient
      // d'ailleurs — et c'est bien un conflit, pas un manque qu'on aurait
      // invente.
      const d = createTestD1();
      seedStock(d, { totalAllocated: 1000, tokensIssued: 0 });
      seedWallet(d, { id: 'w', userId: 'u', cash: 1_000_000, tokens: 0 });
      const w = new WalletService(asD1(d));

      // Un identifiant de transaction deja pris : le lot echoue sur la cle.
      await w.executeBuyAtomic({
        transactionId: 'doublon', userId: 'u', walletId: 'w',
        tokenAmount: 1, cashAmount: 1, total: 1, pricePerGram: 1, fees: 0,
      });
      const r = await w.executeBuyAtomic({
        transactionId: 'doublon', userId: 'u', walletId: 'w',
        tokenAmount: 1, cashAmount: 1, total: 1, pricePerGram: 1, fees: 0,
      });

      expect(r).toEqual({ ok: false, reason: 'CONFLICT' });
    });
  });

  // ─── STOCK INVARIANT ────────────────────────────────────
  it('never lets tokens_issued exceed total_allocated (invariant under sequential claims)', async () => {
    const d = createTestD1();
    seedStock(d, { totalAllocated: 2, tokensIssued: 0 });
    seedWallet(d, { id: 'w', userId: 'u', cash: 1_000_000, tokens: 0 });
    const w = new WalletService(asD1(d));

    const first = await w.executeBuyAtomic({ transactionId: 'a', userId: 'u', walletId: 'w', tokenAmount: 2, cashAmount: 1, total: 1, pricePerGram: 0.5, fees: 0 });
    expect(first.ok).toBe(true);
    const second = await w.executeBuyAtomic({ transactionId: 'b', userId: 'u', walletId: 'w', tokenAmount: 1, cashAmount: 1, total: 1, pricePerGram: 1, fees: 0 });
    expect(second).toEqual({ ok: false, reason: 'INSUFFICIENT_STOCK' });

    const stock = d.sqlite.prepare("SELECT total_allocated, tokens_issued FROM gold_stock WHERE id='main'").get() as { total_allocated: number; tokens_issued: number };
    expect(stock.tokens_issued).toBe(2);
    expect(stock.tokens_issued).toBeLessThanOrEqual(stock.total_allocated);
  });

  // ─── SELL ───────────────────────────────────────────────
  describe('executeSellAtomic', () => {
    beforeEach(() => {
      // give the user tokens and align issued stock
      db.sqlite.prepare("UPDATE wallets SET token_balance = 5, cash_balance = 0 WHERE id='w1'").run();
      db.sqlite.prepare("UPDATE gold_stock SET tokens_issued = 5 WHERE id='main'").run();
    });

    it('debits tokens, credits net cash and releases stock atomically', async () => {
      const r = await wallet.executeSellAtomic({
        transactionId: 's1', userId: 'u1', walletId: 'w1',
        tokenAmount: 2, cashAmount: 102000, total: 100000, pricePerGram: 51000, fees: 2000,
      });
      expect(r.ok).toBe(true);
      expect(getWallet(db, 'w1')).toEqual({ cash_balance: 100000, token_balance: 3 });
      expect(getStock(db)!.tokens_issued).toBe(3);
    });

    it('rolls back and reports INSUFFICIENT_BALANCE when tokens are short', async () => {
      const r = await wallet.executeSellAtomic({
        transactionId: 's2', userId: 'u1', walletId: 'w1',
        tokenAmount: 10, cashAmount: 1, total: 1, pricePerGram: 0.1, fees: 0,
      });
      expect(r).toEqual({ ok: false, reason: 'INSUFFICIENT_BALANCE' });
      expect(getWallet(db, 'w1')).toEqual({ cash_balance: 0, token_balance: 5 });
      expect(getStock(db)!.tokens_issued).toBe(5);
    });
  });

  // ─── WITHDRAWAL ─────────────────────────────────────────
  describe('executeWithdrawalAtomic', () => {
    beforeEach(() => {
      db.sqlite.prepare("UPDATE wallets SET cash_balance = 100000 WHERE id='w1'").run();
    });

    it('debits cash and records transaction + withdrawal atomically', async () => {
      const r = await wallet.executeWithdrawalAtomic({
        transactionId: 'wtx1', withdrawalId: 'wd1', userId: 'u1', walletId: 'w1',
        amount: 50000, fees: 500, netAmount: 49500, method: 'orange_money', phoneNumber: '+22670000000',
        paymentReference: '+22670000000',
      });
      expect(r.ok).toBe(true);
      expect(getWallet(db, 'w1')!.cash_balance).toBe(50000);
      expect(getTx(db, 'wtx1')).toMatchObject({ type: 'WITHDRAWAL', status: 'PENDING' });
      const wd = db.sqlite.prepare('SELECT * FROM withdrawals WHERE id = ?').get('wd1');
      expect(wd).toBeTruthy();
    });

    it('rolls back and reports INSUFFICIENT_BALANCE when balance is short', async () => {
      const r = await wallet.executeWithdrawalAtomic({
        transactionId: 'wtx2', withdrawalId: 'wd2', userId: 'u1', walletId: 'w1',
        amount: 200000, fees: 0, netAmount: 200000, method: 'orange_money', phoneNumber: '+22670000000',
      });
      expect(r).toEqual({ ok: false, reason: 'INSUFFICIENT_BALANCE' });
      expect(getWallet(db, 'w1')!.cash_balance).toBe(100000);
      expect(getTx(db, 'wtx2')).toBeUndefined();
    });
  });

  // ─── RAW BATCH ROLLBACK (the mechanism the flows rely on) ─
  it('db.batch is all-or-nothing: a CHECK violation rolls back earlier statements', async () => {
    db.sqlite.prepare("UPDATE wallets SET cash_balance = 100 WHERE id='w1'").run();
    await expect(
      db.batch([
        db.prepare(
          `INSERT INTO transactions (id, user_id, wallet_id, type, status, cash_amount) VALUES ('rb','u1','w1','FEE','COMPLETED', 1)`
        ),
        db.prepare(`UPDATE wallets SET cash_balance = cash_balance - ? WHERE id = ?`).bind(200, 'w1'),
      ])
    ).rejects.toThrow();
    // The insert from the first statement must have been rolled back.
    expect(getTx(db, 'rb')).toBeUndefined();
    expect(getWallet(db, 'w1')!.cash_balance).toBe(100);
  });
});

// ─── WEBHOOK IDEMPOTENCY ──────────────────────────────────
describe('processWebhook idempotency (real D1)', () => {
  it('credits a deposit exactly once (net amount) and treats replays as already processed', async () => {
    const db = createTestD1();
    seedWallet(db, { id: 'w1', userId: 'u1', cash: 0 });
    // The transaction id doubles as the order reference so a replay stays
    // findable (processWebhook rewrites payment_reference on first process).
    db.sqlite
      .prepare(
        `INSERT INTO transactions (id, user_id, wallet_id, type, status, cash_amount, fees, payment_reference)
         VALUES ('dep-ref-1','u1','w1','DEPOSIT','PENDING', 100000, 0, 'dep-ref-1')`
      )
      .run();

    const kv = createMockKVNamespace();
    const payment = new PaymentService(asD1(db), kv, {} as never);

    const webhook: WebhookPayload = {
      provider: 'orange_money', transactionId: 'ext-1', status: 'SUCCESS',
      amount: 100000, currency: 'XOF', reference: 'dep-ref-1',
      timestamp: '2026-01-01T00:00:00Z', signature: '', raw: {},
    };

    const first = await payment.processWebhook(webhook);
    expect(first.success).toBe(true);
    expect(getWallet(db, 'w1')!.cash_balance).toBe(100000);

    const second = await payment.processWebhook(webhook);
    expect(second).toMatchObject({ success: true, alreadyProcessed: true });
    // Not credited twice.
    expect(getWallet(db, 'w1')!.cash_balance).toBe(100000);
  });
});
