/**
 * Ajustement de la réserve — la garde d'invariant et l'atomicité de sa trace.
 *
 * La route `POST /admin/stock/adjust` calculait `total_allocated + amount` et
 * écrivait sans vérifier que le total reste au-dessus des tokens émis. La base
 * rattrapait (`CHECK (tokens_issued <= total_allocated)`), donc rien ne pouvait
 * être corrompu — mais l'administrateur lisait « erreur interne » au lieu du
 * plancher qu'il ne peut pas franchir.
 *
 * Ces tests tournent contre un vrai SQLite : la contrainte est réellement
 * appliquée et `batch()` a de vraies sémantiques tout-ou-rien.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { beforeEach, describe, expect, it } from 'vitest';
import { verifierAjustementStock } from '../../src/lib/stock-invariant';
import { createTestD1, seedStock, type TestD1 } from '../helpers/real-d1';

const asD1 = (db: TestD1) => db as unknown as D1Database;

const lireStock = (db: TestD1) =>
  db.sqlite
    .prepare("SELECT total_allocated, tokens_issued FROM gold_stock WHERE id = 'main'")
    .get() as { total_allocated: number; tokens_issued: number };

const compterAudits = (db: TestD1) =>
  (db.sqlite.prepare("SELECT COUNT(*) as n FROM audit_logs WHERE action = 'STOCK_ADJUST'").get() as {
    n: number;
  }).n;

/**
 * Applique la vraie règle puis écrit comme la route : ajustement et trace dans
 * le MÊME lot. Seule l'écriture est reproduite ici ; la décision, elle, vient de
 * `verifierAjustementStock`, donc un changement de règle casse ces tests.
 */
async function ajusterStock(db: TestD1, amount: number, adminId = 'adm_1') {
  const d1 = asD1(db);
  const stock = await d1
    .prepare('SELECT id, total_allocated, tokens_issued FROM gold_stock ORDER BY updated_at DESC LIMIT 1')
    .first<{ id: string; total_allocated: number; tokens_issued: number }>();

  // La VRAIE regle, celle que la route appelle — pas une copie.
  const verdict = verifierAjustementStock(amount, stock);
  if (!verdict.ok) {
    return { refuse: true as const, code: verdict.code, tokensIssued: verdict.details?.tokensIssued };
  }
  const newTotal = verdict.newTotal;

  await d1.batch([
    d1
      .prepare("UPDATE gold_stock SET total_allocated = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(newTotal, stock!.id),
    d1
      .prepare(
        "INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
      )
      .bind(crypto.randomUUID(), adminId, 'STOCK_ADJUST', 'stock', 'main', JSON.stringify({ amount, newTotal })),
  ]);

  return { refuse: false as const, newTotal };
}

describe("Garde d'invariant sur la réserve", () => {
  let db: TestD1;

  beforeEach(() => {
    db = createTestD1();
    seedStock(db, { totalAllocated: 100, tokensIssued: 80 });
  });

  it('accepte une allocation supplémentaire', async () => {
    const r = await ajusterStock(db, 50);

    expect(r.refuse).toBe(false);
    expect(lireStock(db).total_allocated).toBe(150);
  });

  it('accepte une réduction qui reste au-dessus des tokens émis', async () => {
    const r = await ajusterStock(db, -20);

    expect(r.refuse).toBe(false);
    expect(lireStock(db).total_allocated).toBe(80);
  });

  it('accepte de descendre EXACTEMENT au niveau des tokens émis', async () => {
    // La borne est incluse : 80 g alloués pour 80 g émis reste cohérent, il ne
    // reste simplement plus rien de disponible.
    const r = await ajusterStock(db, -20);

    expect(r.refuse).toBe(false);
    const stock = lireStock(db);
    expect(stock.total_allocated - stock.tokens_issued).toBe(0);
  });

  it('refuse de descendre sous les tokens émis, avec un code explicite', async () => {
    const r = await ajusterStock(db, -30);

    // Avant : la contrainte SQL levait, et la route renvoyait « erreur interne ».
    expect(r.refuse).toBe(true);
    expect(r).toMatchObject({ code: 'STOCK_BELOW_ISSUED', tokensIssued: 80 });
  });

  it('ne modifie rien quand elle refuse', async () => {
    await ajusterStock(db, -30);

    expect(lireStock(db).total_allocated).toBe(100);
    expect(compterAudits(db)).toBe(0);
  });

  it('refuse un montant nul ou non fini', () => {
    // `NaN` est `typeof 'number'` : sans le controle de finitude, un montant
    // corrompu passerait la validation de type.
    expect(verifierAjustementStock(0, { total_allocated: 100, tokens_issued: 80 }).code).toBe(
      'INVALID_INPUT'
    );
    expect(verifierAjustementStock(Number.NaN, { total_allocated: 100, tokens_issued: 80 }).code).toBe(
      'INVALID_INPUT'
    );
    expect(verifierAjustementStock('50', { total_allocated: 100, tokens_issued: 80 }).code).toBe(
      'INVALID_INPUT'
    );
  });

  it("laisse la contrainte de la base comme dernier rempart", async () => {
    // La garde applicative peut etre contournee par un autre chemin ; la base,
    // non. On verifie que le rempart existe vraiment et n'est pas theorique.
    expect(() =>
      db.sqlite.prepare("UPDATE gold_stock SET total_allocated = 10 WHERE id = 'main'").run()
    ).toThrow();
  });
});

describe('Trace de l’ajustement', () => {
  let db: TestD1;

  beforeEach(() => {
    db = createTestD1();
    seedStock(db, { totalAllocated: 100, tokensIssued: 80 });
  });

  it('écrit la trace en même temps que l’ajustement', async () => {
    await ajusterStock(db, 25);

    expect(lireStock(db).total_allocated).toBe(125);
    expect(compterAudits(db)).toBe(1);
  });

  it('n’ajuste pas la réserve si la trace ne peut pas être écrite', async () => {
    const d1 = asD1(db);
    const stock = await d1
      .prepare("SELECT id, total_allocated FROM gold_stock WHERE id = 'main'")
      .first<{ id: string; total_allocated: number }>();

    // Trace volontairement invalide (colonne inexistante) : le lot doit tout
    // annuler. C'etaient deux `.run()` successifs — un echec entre les deux
    // ajustait la reserve nationale sans laisser de trace de qui l'avait fait.
    await expect(
      d1.batch([
        d1
          .prepare("UPDATE gold_stock SET total_allocated = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(200, stock!.id),
        d1.prepare('INSERT INTO audit_logs (colonne_inexistante) VALUES (?)').bind('x'),
      ])
    ).rejects.toThrow();

    expect(lireStock(db).total_allocated).toBe(100);
    expect(compterAudits(db)).toBe(0);
  });
});
