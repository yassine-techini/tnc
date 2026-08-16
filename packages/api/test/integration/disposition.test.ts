/**
 * Répartition d'un lot : vendre / louer / stocker, éventuellement les trois.
 *
 * Ce qui compte ici n'est pas qu'une répartition simple fonctionne, mais que
 * l'or ne puisse ni se dupliquer ni disparaître entre les trois destinations —
 * et qu'une exécution partielle reste visible plutôt que silencieuse.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DispositionService, checkSplit } from '../../src/services/disposition.service';
import { createTestD1, seedStock, seedWallet, type TestD1 } from '../helpers/real-d1';

const asD1 = (db: TestD1) => db as unknown as D1Database;
const USER = 'refiner-1';
const WALLET = 'wallet-1';
const LOT = 'lot-1';
const PRICE = 53_000;

const terms = {
  sellPricePerGram: PRICE,
  leaseAnnualRate: 0.06,
  leaseMinimumG: 1,
};

function wallet(db: TestD1) {
  return db.sqlite
    .prepare('SELECT token_balance, cash_balance FROM wallets WHERE id = ?')
    .get(WALLET) as { token_balance: number; cash_balance: number };
}

function stock(db: TestD1) {
  return db.sqlite
    .prepare("SELECT total_allocated, tokens_issued, gold_on_loan FROM gold_stock WHERE id='main'")
    .get() as { total_allocated: number; tokens_issued: number; gold_on_loan: number };
}

describe('checkSplit', () => {
  it('accepte une répartition qui couvre exactement le lot', () => {
    expect(checkSplit({ sellG: 300, leaseG: 400, storeG: 210 }, 910)).toMatchObject({
      valid: true,
      totalG: 910,
    });
  });

  it('accepte une destination unique', () => {
    expect(checkSplit({ sellG: 0, leaseG: 0, storeG: 910 }, 910).valid).toBe(true);
    expect(checkSplit({ sellG: 910, leaseG: 0, storeG: 0 }, 910).valid).toBe(true);
  });

  it("refuse un reliquat, dans un sens comme dans l'autre", () => {
    // Un reliquat implicite obligerait à décider en silence ce que devient de
    // l'or dont personne ne saurait s'il est vendu, loué ou gardé.
    expect(checkSplit({ sellG: 300, leaseG: 400, storeG: 200 }, 910)).toMatchObject({
      valid: false,
      error: 'SPLIT_MISMATCH',
    });
    expect(checkSplit({ sellG: 300, leaseG: 400, storeG: 300 }, 910).error).toBe('SPLIT_MISMATCH');
  });

  it('refuse une part négative', () => {
    // Sans cela, -100 en vente « financerait » 100 de plus en location.
    expect(checkSplit({ sellG: -100, leaseG: 1010, storeG: 0 }, 910)).toMatchObject({
      valid: false,
      error: 'NEGATIVE_SHARE',
    });
  });

  it('tolère le milligramme, pas davantage', () => {
    expect(checkSplit({ sellG: 303.333, leaseG: 303.333, storeG: 303.334 }, 910).valid).toBe(true);
    expect(checkSplit({ sellG: 300, leaseG: 400, storeG: 209.99 }, 910).valid).toBe(false);
  });

  it('refuse de répartir un lot sans rien de crédité', () => {
    expect(checkSplit({ sellG: 0, leaseG: 0, storeG: 0 }, 0)).toMatchObject({
      valid: false,
      error: 'NOTHING_CREDITED',
    });
  });
});

describe('DispositionService (real D1)', () => {
  let db: TestD1;
  let svc: DispositionService;

  beforeEach(() => {
    db = createTestD1();
    // 910 g crédités au raffineur après essai.
    seedStock(db, { totalAllocated: 2000, tokensIssued: 910 });
    seedWallet(db, { id: WALLET, userId: USER, tokens: 910 });
    svc = new DispositionService(asD1(db));
  });

  it('exécute les trois destinations en une instruction', async () => {
    const r = await svc.dispose({
      consignmentId: LOT,
      userId: USER,
      split: { sellG: 300, leaseG: 400, storeG: 210 },
      creditedG: 910,
      ...terms,
    });

    expect(r.ok).toBe(true);
    expect(r.disposition).toMatchObject({
      status: 'EXECUTED',
      sell_status: 'DONE',
      lease_status: 'DONE',
    });

    const w = wallet(db);
    // 300 vendus (sortis), 400 loués (sortis), 210 gardés.
    expect(w.token_balance).toBe(210);
    expect(w.cash_balance).toBe(300 * PRICE);
    expect(stock(db).gold_on_loan).toBe(400);
  });

  it("ne crée ni ne détruit d'or au-delà de ce que chaque jambe fait", async () => {
    const before = stock(db);
    await svc.dispose({
      consignmentId: LOT,
      userId: USER,
      split: { sellG: 300, leaseG: 400, storeG: 210 },
      creditedG: 910,
      ...terms,
    });
    const after = stock(db);

    // La vente retire ses tokens de la circulation ; la location n'en retire
    // aucun, elle déplace le métal hors du coffre.
    expect(after.tokens_issued).toBe(before.tokens_issued - 300);
    expect(after.total_allocated).toBe(before.total_allocated);
    expect(after.tokens_issued).toBeLessThanOrEqual(after.total_allocated);
  });

  it('accepte un lot entièrement mis en stockage sans rien exécuter', async () => {
    const r = await svc.dispose({
      consignmentId: LOT,
      userId: USER,
      split: { sellG: 0, leaseG: 0, storeG: 910 },
      creditedG: 910,
      ...terms,
    });

    // Le stockage n'est pas une absence d'action : c'est une intention
    // enregistrée, et c'est elle qui déclenchera les frais de garde.
    expect(r.disposition).toMatchObject({
      status: 'EXECUTED',
      sell_status: 'NONE',
      lease_status: 'NONE',
      store_g: 910,
    });
    expect(wallet(db).token_balance).toBe(910);
    expect(stock(db).gold_on_loan).toBe(0);
  });

  it('refuse de répartir deux fois le même lot', async () => {
    await svc.dispose({
      consignmentId: LOT,
      userId: USER,
      split: { sellG: 0, leaseG: 0, storeG: 910 },
      creditedG: 910,
      ...terms,
    });

    // Sinon le raffineur disposerait deux fois du même or.
    const second = await svc.dispose({
      consignmentId: LOT,
      userId: USER,
      split: { sellG: 910, leaseG: 0, storeG: 0 },
      creditedG: 910,
      ...terms,
    });
    expect(second).toMatchObject({ ok: false, error: 'ALREADY_DISPOSED' });
    expect(wallet(db).token_balance).toBe(910);
  });

  it('refuse avant d’exécuter quoi que ce soit si le solde ne suffit pas', async () => {
    db.sqlite.prepare('UPDATE wallets SET token_balance = 100 WHERE id = ?').run(WALLET);

    const r = await svc.dispose({
      consignmentId: LOT,
      userId: USER,
      split: { sellG: 300, leaseG: 400, storeG: 210 },
      creditedG: 910,
      ...terms,
    });

    expect(r).toMatchObject({ ok: false, error: 'INSUFFICIENT_BALANCE' });
    // Rien n'a bougé, et aucune instruction n'a été enregistrée à moitié.
    expect(wallet(db).token_balance).toBe(100);
    expect(await svc.getByConsignment(LOT)).toBeNull();
  });

  it('refuse une vente sans prix plutôt que de vendre à zéro', async () => {
    const r = await svc.dispose({
      consignmentId: LOT,
      userId: USER,
      split: { sellG: 300, leaseG: 0, storeG: 610 },
      creditedG: 910,
      ...terms,
      sellPricePerGram: 0,
    });

    expect(r).toMatchObject({ ok: false, error: 'NO_PRICE' });
    expect(wallet(db).cash_balance).toBe(0);
  });

  it('laisse une exécution partielle visible au lieu de la taire', async () => {
    // La location est sous le minimum : sa jambe échoue, la vente réussit.
    const r = await svc.dispose({
      consignmentId: LOT,
      userId: USER,
      split: { sellG: 300, leaseG: 0.5, storeG: 609.5 },
      creditedG: 910,
      ...terms,
      leaseMinimumG: 1,
    });

    expect(r.disposition).toMatchObject({
      status: 'PARTIAL',
      sell_status: 'DONE',
      lease_status: 'FAILED',
    });
    expect(r.disposition!.failure_reason).toContain('location');
    // La vente a bien eu lieu — on ne la défait pas pour cacher l'échec voisin.
    expect(wallet(db).cash_balance).toBe(300 * PRICE);
    expect(stock(db).gold_on_loan).toBe(0);
  });

  it('trace la vente avec des identifiants réels, pas seulement un statut', async () => {
    const r = await svc.dispose({
      consignmentId: LOT,
      userId: USER,
      split: { sellG: 300, leaseG: 0, storeG: 610 },
      creditedG: 910,
      ...terms,
    });

    const d = r.disposition!;
    expect(d.sell_price_per_gram).toBe(PRICE);
    expect(d.sell_proceeds_xof).toBe(300 * PRICE);

    // La transaction citée existe vraiment et porte le bon montant.
    const tx = db.sqlite
      .prepare('SELECT type, token_amount, cash_amount, status FROM transactions WHERE id = ?')
      .get(d.sell_transaction_id) as Record<string, unknown>;
    expect(tx).toMatchObject({ type: 'SELL', token_amount: 300, status: 'COMPLETED' });
  });

  it('trace la position de location créée', async () => {
    const r = await svc.dispose({
      consignmentId: LOT,
      userId: USER,
      split: { sellG: 0, leaseG: 400, storeG: 510 },
      creditedG: 910,
      ...terms,
    });

    const position = db.sqlite
      .prepare('SELECT principal_g, annual_rate, status FROM lease_positions WHERE id = ?')
      .get(r.disposition!.lease_position_id) as Record<string, unknown>;
    expect(position).toMatchObject({ principal_g: 400, annual_rate: 0.06, status: 'ACTIVE' });
  });

  it('inscrit la répartition à la piste d’audit', async () => {
    await svc.dispose({
      consignmentId: LOT,
      userId: USER,
      split: { sellG: 300, leaseG: 400, storeG: 210 },
      creditedG: 910,
      ...terms,
    });

    const log = db.sqlite
      .prepare("SELECT new_value FROM audit_logs WHERE action = 'LOT_DISPOSED'")
      .get() as { new_value: string };
    expect(JSON.parse(log.new_value)).toMatchObject({
      consignmentId: LOT,
      sellG: 300,
      leaseG: 400,
      storeG: 210,
    });
  });

  it('ne rejoue pas une jambe déjà exécutée', async () => {
    const r = await svc.dispose({
      consignmentId: LOT,
      userId: USER,
      split: { sellG: 300, leaseG: 400, storeG: 210 },
      creditedG: 910,
      ...terms,
    });

    // Reprendre une répartition déjà faite ne doit pas vendre une seconde fois.
    await svc.execute(r.disposition!.id, {
      userId: USER,
      walletId: WALLET,
      sellG: 300,
      leaseG: 400,
      ...terms,
    });

    expect(wallet(db).token_balance).toBe(210);
    expect(wallet(db).cash_balance).toBe(300 * PRICE);
    expect(stock(db).gold_on_loan).toBe(400);
  });

  it('liste les répartitions du raffineur', async () => {
    await svc.dispose({
      consignmentId: LOT,
      userId: USER,
      split: { sellG: 0, leaseG: 0, storeG: 910 },
      creditedG: 910,
      ...terms,
    });
    const list = await svc.listForUser(USER);
    expect(list).toHaveLength(1);
    expect(await svc.listForUser('someone-else')).toHaveLength(0);
  });
});
