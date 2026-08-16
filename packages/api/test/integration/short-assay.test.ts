/**
 * Essai ressortant SOUS l'acompte.
 *
 * Décision commerciale : aucune reprise, le producteur garde l'acompte
 * (ADR 006). La conséquence est comptable et c'est elle qui est testée ici :
 * l'acompte avait alloué un poids que l'affinage n'a pas confirmé, et ce
 * fantôme doit sortir de `total_allocated`, sans quoi la réserve publique
 * surestime l'or physique.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SettlementService } from '../../src/services/settlement.service';
import { ConsignmentService } from '../../src/services/consignment.service';
import { createTestD1, seedStock, seedWallet, type TestD1 } from '../helpers/real-d1';

const asD1 = (db: TestD1) => db as unknown as D1Database;
const LOT = 'lot-1';
const PRODUCER = 'producer-1';

const TERMS = { percent: 0.75, haircut: 0.9, currency: 'TOKENS' as const, pricePerGram: 53_000 };
/** 1000 g x 0,92 de pureté x 0,90 de décote x 0,75 = 621 g. */
const ADVANCE = 621;

function stock(db: TestD1) {
  return db.sqlite
    .prepare("SELECT total_allocated, tokens_issued FROM gold_stock WHERE id='main'")
    .get() as { total_allocated: number; tokens_issued: number };
}

function balance(db: TestD1) {
  const r = db.sqlite
    .prepare('SELECT token_balance FROM wallets WHERE id = ?')
    .get('w1') as { token_balance: number };
  return r.token_balance;
}

function seedLot(db: TestD1) {
  db.sqlite
    .prepare(
      `INSERT INTO gold_consignments
         (id, reference, producer_id, weight_declared_g, purity_declared, gold_type, status, arrived_dubai_at)
       VALUES (?, 'CONS-TEST', ?, 1000, 0.92, 'nuggets', 'ARRIVED_DUBAI', datetime('now'))`
    )
    .run(LOT, PRODUCER);
}

describe('essai sous l’acompte', () => {
  let db: TestD1;

  beforeEach(() => {
    db = createTestD1();
    seedWallet(db, { id: 'w1', userId: PRODUCER, tokens: 0 });
    seedLot(db);
  });

  it('ne reprend rien au producteur', async () => {
    // Du stock libre pour absorber l'écart (voir le test suivant).
    seedStock(db, { totalAllocated: 500, tokensIssued: 0 });
    await new SettlementService(asD1(db)).payAdvance(LOT, TERMS);

    const result = await new ConsignmentService(asD1(db)).auditValidate(LOT, { id: 'admin-1', role: 'ADMIN' }, { refinedWeightG: 500, producerShare: 1 });

    expect(result.ok).toBe(true);
    // La décision : l'acompte reste acquis, rien de plus n'est versé.
    expect(balance(db)).toBe(ADVANCE);
  });

  it('sort de la réserve l’or que l’affinage n’a pas confirmé', async () => {
    seedStock(db, { totalAllocated: 500, tokensIssued: 0 });
    await new SettlementService(asD1(db)).payAdvance(LOT, TERMS);
    // L'acompte a alloué 621 g sur la foi du poids déclaré.
    expect(stock(db)).toMatchObject({ total_allocated: 500 + ADVANCE, tokens_issued: ADVANCE });

    await new ConsignmentService(asD1(db)).auditValidate(LOT, { id: 'admin-1', role: 'ADMIN' }, { refinedWeightG: 500, producerShare: 1 });

    // 500 g seulement sont arrivés : les 121 g fantômes sortent de l'allocation.
    // Sans cela, /reserve annoncerait 1121 g adossés pour 1000 g réels.
    const after = stock(db);
    expect(after.total_allocated).toBe(1000);
    expect(after.tokens_issued).toBe(ADVANCE);
    expect(after.tokens_issued).toBeLessThanOrEqual(after.total_allocated);
  });

  it('refuse l’audit quand la plateforme ne peut pas couvrir l’écart', async () => {
    // Aucun stock libre : les 621 tokens déjà émis ne seraient adossés que par
    // les 500 g arrivés.
    seedStock(db, { totalAllocated: 0, tokensIssued: 0 });
    await new SettlementService(asD1(db)).payAdvance(LOT, TERMS);

    const result = await new ConsignmentService(asD1(db)).auditValidate(LOT, { id: 'admin-1', role: 'ADMIN' }, { refinedWeightG: 500, producerShare: 1 });

    // Fail-closed : on n'émet pas de créances qu'on ne peut pas adosser.
    expect(result.ok).toBe(false);

    // Et rien n'a bougé : ni le lot, ni le stock, ni le portefeuille.
    expect(stock(db)).toMatchObject({ total_allocated: ADVANCE, tokens_issued: ADVANCE });
    expect(balance(db)).toBe(ADVANCE);
    const lot = db.sqlite
      .prepare('SELECT status, refined_weight_g FROM gold_consignments WHERE id = ?')
      .get(LOT) as { status: string; refined_weight_g: number | null };
    expect(lot.status).toBe('ARRIVED_DUBAI');
    expect(lot.refined_weight_g).toBeNull();
  });

  it('reste inchangé quand l’essai dépasse l’acompte', async () => {
    seedStock(db, { totalAllocated: 0, tokensIssued: 0 });
    await new SettlementService(asD1(db)).payAdvance(LOT, TERMS);

    await new ConsignmentService(asD1(db)).auditValidate(LOT, { id: 'admin-1', role: 'ADMIN' }, { refinedWeightG: 910, producerShare: 1 });

    // Le cas normal : le solde est le dû moins l'acompte, l'allocation suit le
    // poids réellement affiné.
    expect(balance(db)).toBe(910);
    expect(stock(db)).toMatchObject({ total_allocated: 910, tokens_issued: 910 });
  });

  it('traite un essai exactement égal à l’acompte sans rien déplacer', async () => {
    seedStock(db, { totalAllocated: 0, tokensIssued: 0 });
    await new SettlementService(asD1(db)).payAdvance(LOT, TERMS);

    const result = await new ConsignmentService(asD1(db)).auditValidate(LOT, { id: 'admin-1', role: 'ADMIN' }, { refinedWeightG: ADVANCE, producerShare: 1 });

    expect(result.ok).toBe(true);
    expect(balance(db)).toBe(ADVANCE);
    expect(stock(db)).toMatchObject({ total_allocated: ADVANCE, tokens_issued: ADVANCE });
  });
});
