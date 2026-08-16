/**
 * Frais de garde à Dubaï.
 *
 * Le cas qui compte n'est pas le raffineur qui paie, c'est celui qui NE PEUT
 * PAS payer : il a livré du métal, pas de l'argent, et son solde espèces est
 * vide. Le frais doit alors devenir une dette lisible (ADR 005) — jamais
 * disparaître, jamais forcer le solde sous zéro.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { StorageFeeService, dailyStorageFeeXof } from '../../src/services/storage-fee.service';
import { createTestD1, seedWallet, type TestD1 } from '../helpers/real-d1';

const asD1 = (db: TestD1) => db as unknown as D1Database;
const USER = 'refiner-1';
const WALLET = 'wallet-1';
const PRICE = 53_000;
const RATE = 0.005;

/** 100 g x 53 000 x 0,5 % / 365 = 73 XOF */
const DAILY = 73;

function seedRefiner(db: TestD1, userId = USER) {
  db.sqlite
    .prepare(
      `INSERT INTO producer_profiles (id, user_id, entity_type, legal_name, representative_name)
       VALUES (?, ?, 'REFINER', 'Raffinerie test', 'Représentant')`
    )
    .run(`p-${userId}`, userId);
}

function wallet(db: TestD1, id = WALLET) {
  return db.sqlite
    .prepare('SELECT token_balance, cash_balance FROM wallets WHERE id = ?')
    .get(id) as { token_balance: number; cash_balance: number };
}

describe('dailyStorageFeeXof', () => {
  it('est Actual/365 sur la valeur au comptant de l’or gardé', () => {
    expect(dailyStorageFeeXof({ storedG: 100, pricePerGram: PRICE, annualRate: RATE })).toBe(DAILY);
  });

  it('ne facture rien sans or, sans prix ou sans taux', () => {
    expect(dailyStorageFeeXof({ storedG: 0, pricePerGram: PRICE, annualRate: RATE })).toBe(0);
    expect(dailyStorageFeeXof({ storedG: 100, pricePerGram: 0, annualRate: RATE })).toBe(0);
    expect(dailyStorageFeeXof({ storedG: 100, pricePerGram: PRICE, annualRate: 0 })).toBe(0);
  });
});

describe('StorageFeeService (real D1)', () => {
  let db: TestD1;
  let svc: StorageFeeService;

  beforeEach(() => {
    db = createTestD1();
    seedWallet(db, { id: WALLET, userId: USER, tokens: 100, cash: 0 });
    seedRefiner(db);
    svc = new StorageFeeService(asD1(db));
  });

  async function holder() {
    return (await svc.holdersToCharge('2026-08-16'))[0];
  }

  it('facture le raffineur sur l’or qu’il garde', async () => {
    db.sqlite.prepare('UPDATE wallets SET cash_balance = 1000 WHERE id = ?').run(WALLET);
    const result = await svc.accrueDay(await holder(), '2026-08-16', PRICE, RATE);

    expect(result).toMatchObject({ accrued: true, amountXof: DAILY, paid: true });
    expect(wallet(db).cash_balance).toBe(1000 - DAILY);
    // L'or n'est pas touché : le frais est en espèces.
    expect(wallet(db).token_balance).toBe(100);
  });

  it('enregistre une dette quand le solde espèces est vide', async () => {
    // Le cas normal : un raffineur a livré du métal, pas de l'argent.
    const result = await svc.accrueDay(await holder(), '2026-08-16', PRICE, RATE);

    expect(result).toMatchObject({ accrued: true, amountXof: DAILY, paid: false });
    expect(await svc.totalOutstandingXof(USER)).toBe(DAILY);
    // Le solde n'est pas passé sous zéro, et le frais n'a pas disparu.
    expect(wallet(db).cash_balance).toBe(0);
  });

  it('ne facture pas l’or en location — il n’est pas dans le coffre', async () => {
    // La location sort les grammes du portefeuille : facturer une garde qui
    // n'a pas lieu reviendrait à prélever deux fois le même gramme.
    db.sqlite.prepare('UPDATE wallets SET token_balance = 40 WHERE id = ?').run(WALLET);
    const h = await holder();

    expect(h.stored_g).toBe(40);
    const result = await svc.accrueDay(h, '2026-08-16', PRICE, RATE);
    expect(result.amountXof).toBe(dailyStorageFeeXof({ storedG: 40, pricePerGram: PRICE, annualRate: RATE }));
  });

  it('ne facture pas deux fois le même jour, même en rejouant le job', async () => {
    db.sqlite.prepare('UPDATE wallets SET cash_balance = 1000 WHERE id = ?').run(WALLET);
    await svc.accrueDay(await holder(), '2026-08-16', PRICE, RATE);

    // Le détenteur ne ressort plus pour ce jour-là.
    expect(await svc.holdersToCharge('2026-08-16')).toHaveLength(0);
    expect(wallet(db).cash_balance).toBe(1000 - DAILY);
    // Et le lendemain il ressort.
    expect(await svc.holdersToCharge('2026-08-17')).toHaveLength(1);
  });

  it('solde l’arriéré dès que le raffineur vend une part de son lot', async () => {
    for (const day of ['2026-08-14', '2026-08-15', '2026-08-16']) {
      await svc.accrueDay(
        { user_id: USER, wallet_id: WALLET, stored_g: 100 },
        day,
        PRICE,
        RATE
      );
    }
    expect(await svc.totalOutstandingXof(USER)).toBe(DAILY * 3);

    // Une vente crédite le solde espèces.
    db.sqlite.prepare('UPDATE wallets SET cash_balance = 1000 WHERE id = ?').run(WALLET);
    const settled = await svc.settleOutstanding(USER, WALLET);

    expect(settled).toMatchObject({ paid: 3, paidXof: DAILY * 3 });
    expect(await svc.totalOutstandingXof(USER)).toBe(0);
    expect(wallet(db).cash_balance).toBe(1000 - DAILY * 3);
  });

  it('règle du plus ancien au plus récent, et s’arrête quand le solde ne suit plus', async () => {
    for (const day of ['2026-08-14', '2026-08-15', '2026-08-16']) {
      await svc.accrueDay({ user_id: USER, wallet_id: WALLET, stored_g: 100 }, day, PRICE, RATE);
    }

    // De quoi payer deux jours seulement.
    db.sqlite.prepare('UPDATE wallets SET cash_balance = ? WHERE id = ?').run(DAILY * 2, WALLET);
    const settled = await svc.settleOutstanding(USER, WALLET);

    expect(settled.paid).toBe(2);
    // Un arriéré se solde dans l'ordre où il s'est formé, sinon les plus vieux
    // impayés ne partent jamais.
    const left = await svc.outstandingFor(USER);
    expect(left).toHaveLength(1);
    expect(left[0].accrual_date).toBe('2026-08-16');
    expect(wallet(db).cash_balance).toBe(0);
  });

  it('ne prélève qu’une fois un frais déjà réglé', async () => {
    db.sqlite.prepare('UPDATE wallets SET cash_balance = 1000 WHERE id = ?').run(WALLET);
    await svc.accrueDay(await holder(), '2026-08-16', PRICE, RATE);

    // Rejouer le règlement : la garde doit tout arrêter, pas seulement la
    // dernière instruction.
    await svc.settleOutstanding(USER, WALLET);
    expect(wallet(db).cash_balance).toBe(1000 - DAILY);

    const feeTx = db.sqlite
      .prepare("SELECT COUNT(*) c FROM transactions WHERE type = 'FEE' AND user_id = ?")
      .get(USER) as { c: number };
    expect(feeTx.c).toBe(1);
  });

  it('inscrit le prélèvement comme une transaction FEE traçable', async () => {
    db.sqlite.prepare('UPDATE wallets SET cash_balance = 1000 WHERE id = ?').run(WALLET);
    await svc.accrueDay(await holder(), '2026-08-16', PRICE, RATE);

    const fee = db.sqlite
      .prepare("SELECT * FROM storage_fee_accruals WHERE user_id = ?")
      .get(USER) as { status: string; transaction_id: string };
    expect(fee.status).toBe('PAID');

    const tx = db.sqlite
      .prepare('SELECT type, cash_amount, token_amount, metadata FROM transactions WHERE id = ?')
      .get(fee.transaction_id) as Record<string, unknown>;
    expect(tx).toMatchObject({ type: 'FEE', cash_amount: DAILY });
    // Le frais est en espèces : aucun montant en tokens.
    expect(tx.token_amount).toBeNull();
    expect(JSON.parse(tx.metadata as string)).toMatchObject({ kind: 'STORAGE_FEE' });
  });

  it('ne facture que les raffineurs par défaut', async () => {
    seedWallet(db, { id: 'wallet-2', userId: 'investor-1', tokens: 500 });

    // Un investisseur particulier finance déjà la plateforme par le spread.
    const holders = await svc.holdersToCharge('2026-08-16');
    expect(holders.map((h) => h.user_id)).toEqual([USER]);

    // L'étendre à tous est une décision produit, faite en configuration.
    const all = await svc.holdersToCharge('2026-08-16', 'ALL');
    expect(all.map((h) => h.user_id).sort()).toEqual(['investor-1', 'refiner-1']);
  });

  it('ignore un portefeuille vide', async () => {
    db.sqlite.prepare('UPDATE wallets SET token_balance = 0 WHERE id = ?').run(WALLET);
    expect(await svc.holdersToCharge('2026-08-16')).toHaveLength(0);
  });
});
