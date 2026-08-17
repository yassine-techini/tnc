/**
 * Conservation de la valeur — constats P et Q du cinquième audit.
 *
 * Deux chemins déplaçaient de l'argent en plusieurs validations distinctes :
 *
 *   P. Le rappel de paiement marquait la transaction `COMPLETED`, validait, puis
 *      créditait le portefeuille. Un échec entre les deux laissait une
 *      transaction qui dit « fait » face à un solde qui n'a pas bougé.
 *
 *   Q. Le rejet d'un retrait remboursait, marquait la transaction, marquait le
 *      retrait. La garde amont était LUE avant d'écrire : un remboursement passé
 *      suivi d'un marquage échoué laissait la transaction `PENDING`, et la
 *      reprise remboursait une seconde fois.
 *
 * Ces tests tournent contre un vrai SQLite : `batch()` y a de vraies sémantiques
 * tout-ou-rien, et les contraintes `CHECK` s'appliquent réellement.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1, seedWallet, type TestD1 } from '../helpers/real-d1';

const asD1 = (db: TestD1) => db as unknown as D1Database;

const solde = (db: TestD1, id: string) =>
  (db.sqlite.prepare('SELECT cash_balance FROM wallets WHERE id = ?').get(id) as { cash_balance: number })
    .cash_balance;

const statutTx = (db: TestD1, id: string) =>
  (db.sqlite.prepare('SELECT status FROM transactions WHERE id = ?').get(id) as { status: string }).status;

const statutRetrait = (db: TestD1, id: string) =>
  (db.sqlite.prepare('SELECT status FROM withdrawals WHERE transaction_id = ?').get(id) as { status: string })
    .status;

function semerTransaction(
  db: TestD1,
  p: { id: string; type: string; status: string; cash: number; fees?: number }
) {
  db.sqlite
    .prepare(
      `INSERT INTO transactions (id, user_id, wallet_id, type, status, cash_amount, fees)
       VALUES (?, 'u1', 'w1', ?, ?, ?, ?)`
    )
    .run(p.id, p.type, p.status, p.cash, p.fees ?? 0);
}

function semerRetrait(db: TestD1, txId: string, montant: number) {
  db.sqlite
    .prepare(
      `INSERT INTO withdrawals (id, transaction_id, method, amount, fees, net_amount, status)
       VALUES (?, ?, 'orange_money', ?, 0, ?, 'PENDING')`
    )
    .run(`wd_${txId}`, txId, montant, montant);
}

/** Le lot du rappel de paiement, tel que la route le construit désormais. */
async function crediterDepot(db: TestD1, txId: string, net: number) {
  const d1 = asD1(db);
  return d1.batch([
    d1
      .prepare(
        `UPDATE wallets SET cash_balance = cash_balance + ?, updated_at = datetime('now')
         WHERE user_id = 'u1'
           AND EXISTS (SELECT 1 FROM transactions WHERE id = ? AND status != 'COMPLETED')`
      )
      .bind(net, txId),
    d1
      .prepare(
        `UPDATE transactions SET status = 'COMPLETED', completed_at = datetime('now')
         WHERE id = ? AND status != 'COMPLETED'`
      )
      .bind(txId),
  ]);
}

/** Le lot du rejet de retrait, tel que la route le construit désormais. */
async function rejeterRetrait(db: TestD1, txId: string, montant: number) {
  const d1 = asD1(db);
  return d1.batch([
    d1
      .prepare(
        `UPDATE wallets SET cash_balance = cash_balance + ?, updated_at = datetime('now')
         WHERE user_id = 'u1'
           AND EXISTS (SELECT 1 FROM transactions WHERE id = ? AND status = 'PENDING')`
      )
      .bind(montant, txId),
    d1
      .prepare(
        `UPDATE withdrawals SET status = 'REJECTED', failure_reason = ?, completed_at = datetime('now')
         WHERE transaction_id = ?
           AND EXISTS (SELECT 1 FROM transactions WHERE id = ? AND status = 'PENDING')`
      )
      .bind('Rejeté', txId, txId),
    d1
      .prepare(
        `UPDATE transactions SET status = 'CANCELLED', failure_reason = ?, completed_at = datetime('now')
         WHERE id = ? AND status = 'PENDING'`
      )
      .bind('Rejeté', txId),
  ]);
}

describe('P — Rappel de paiement : créditer et compléter ensemble', () => {
  let db: TestD1;

  beforeEach(() => {
    db = createTestD1();
    seedWallet(db, { id: 'w1', userId: 'u1', cash: 100_000 });
    semerTransaction(db, { id: 'tx1', type: 'DEPOSIT', status: 'PENDING', cash: 50_000, fees: 500 });
  });

  it('crédite le portefeuille et complète la transaction', async () => {
    await crediterDepot(db, 'tx1', 49_500);

    expect(solde(db, 'w1')).toBe(149_500);
    expect(statutTx(db, 'tx1')).toBe('COMPLETED');
  });

  it('ne crédite pas deux fois un rappel rejoué', async () => {
    await crediterDepot(db, 'tx1', 49_500);
    const resultats = await crediterDepot(db, 'tx1', 49_500);

    // La garde `status != 'COMPLETED'` est portée par les DEUX instructions :
    // le second passage ne touche aucune ligne, donc ne crédite rien.
    expect(solde(db, 'w1')).toBe(149_500);
    expect(resultats[resultats.length - 1].meta.changes).toBe(0);
  });

  it('signale par meta.changes qu il n a rien fait', async () => {
    await crediterDepot(db, 'tx1', 49_500);
    const resultats = await crediterDepot(db, 'tx1', 49_500);

    // C'est ce zéro qui permet à la route de répondre « déjà traité » plutôt que
    // de renotifier le client une seconde fois.
    expect(resultats[resultats.length - 1].meta.changes).toBe(0);
  });

  it("ne complète rien si le crédit ne peut pas être écrit", async () => {
    const d1 = asD1(db);

    // Crédit volontairement invalide : le lot doit tout annuler. Avant, les deux
    // écritures étaient validées séparément et la transaction restait complétée.
    await expect(
      d1.batch([
        d1.prepare('UPDATE wallets SET colonne_inexistante = ? WHERE user_id = ?').bind(1, 'u1'),
        d1.prepare("UPDATE transactions SET status = 'COMPLETED' WHERE id = ?").bind('tx1'),
      ])
    ).rejects.toThrow();

    expect(statutTx(db, 'tx1')).toBe('PENDING');
    expect(solde(db, 'w1')).toBe(100_000);
  });
});

describe('Q — Rejet de retrait : rembourser une seule fois', () => {
  let db: TestD1;

  beforeEach(() => {
    db = createTestD1();
    seedWallet(db, { id: 'w1', userId: 'u1', cash: 20_000 });
    semerTransaction(db, { id: 'tx2', type: 'WITHDRAWAL', status: 'PENDING', cash: 30_000 });
    semerRetrait(db, 'tx2', 30_000);
  });

  it('rembourse, annule la transaction et rejette le retrait', async () => {
    await rejeterRetrait(db, 'tx2', 30_000);

    expect(solde(db, 'w1')).toBe(50_000);
    expect(statutTx(db, 'tx2')).toBe('CANCELLED');
    expect(statutRetrait(db, 'tx2')).toBe('REJECTED');
  });

  it('ne rembourse pas deux fois un rejet rejoué', async () => {
    await rejeterRetrait(db, 'tx2', 30_000);
    const resultats = await rejeterRetrait(db, 'tx2', 30_000);

    // Le scénario réel : le remboursement passait, le marquage échouait, la
    // transaction restait `PENDING`, et la reprise franchissait la garde amont.
    expect(solde(db, 'w1')).toBe(50_000);
    expect(resultats[resultats.length - 1].meta.changes).toBe(0);
  });

  it('laisse tout intact quand une instruction du lot échoue', async () => {
    const d1 = asD1(db);

    await expect(
      d1.batch([
        d1
          .prepare("UPDATE wallets SET cash_balance = cash_balance + ? WHERE user_id = 'u1'")
          .bind(30_000),
        d1.prepare('UPDATE withdrawals SET colonne_inexistante = ? WHERE transaction_id = ?').bind(1, 'tx2'),
        d1.prepare("UPDATE transactions SET status = 'CANCELLED' WHERE id = ?").bind('tx2'),
      ])
    ).rejects.toThrow();

    expect(solde(db, 'w1')).toBe(20_000);
    expect(statutTx(db, 'tx2')).toBe('PENDING');
    expect(statutRetrait(db, 'tx2')).toBe('PENDING');
  });
});

describe('Le contrat de lot gardé', () => {
  it("n'interrompt pas un lot quand une instruction ne touche aucune ligne", async () => {
    const db = createTestD1();
    seedWallet(db, { id: 'w1', userId: 'u1', cash: 1000 });
    const d1 = asD1(db);

    // C'est LA raison pour laquelle chaque instruction doit porter la garde :
    // une mise à jour qui ne matche rien n'est pas une erreur et ne fait pas
    // échouer le lot. Sans garde partout, la seconde s'exécuterait quand même.
    const resultats = await d1.batch([
      d1.prepare("UPDATE wallets SET cash_balance = 999 WHERE user_id = 'inconnu'").bind(),
      d1.prepare("UPDATE wallets SET cash_balance = cash_balance + 1 WHERE user_id = 'u1'").bind(),
    ]);

    expect(resultats[0].meta.changes).toBe(0);
    expect(resultats[1].meta.changes).toBe(1);
    expect(solde(db, 'w1')).toBe(1001);
  });
});
