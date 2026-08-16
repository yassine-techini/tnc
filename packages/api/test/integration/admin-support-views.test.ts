/**
 * Ce que le back-office peut voir des nouvelles opérations financières.
 *
 * Une répartition PARTIAL veut dire qu'une jambe a échoué : le producteur le
 * voit s'il regarde, la plateforme n'avait aucun moyen de l'apprendre. Un échec
 * d'argent que personne ne surveille se découvre par un appel au support, ou
 * jamais.
 *
 * Ces tests portent sur les REQUÊTES elles-mêmes, exécutées sur un vrai moteur :
 * une vue de support qui compile mais renvoie la mauvaise ligne est pire
 * qu'absente, puisqu'on la croit.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1, seedWallet, type TestD1 } from '../helpers/real-d1';

const OUTSTANDING = `
  SELECT f.user_id,
         COUNT(*) AS days_outstanding,
         SUM(f.amount_xof) AS total_xof,
         MIN(f.accrual_date) AS oldest,
         MAX(f.accrual_date) AS newest,
         w.cash_balance,
         w.token_balance
  FROM storage_fee_accruals f
  LEFT JOIN wallets w ON w.user_id = f.user_id
  WHERE f.status = 'OUTSTANDING'
  GROUP BY f.user_id
  ORDER BY total_xof DESC
  LIMIT 200`;

const NEEDS_ATTENTION = `
  SELECT d.*, c.reference, c.producer_id
  FROM lot_dispositions d
  LEFT JOIN gold_consignments c ON c.id = d.consignment_id
  WHERE d.status IN ('PARTIAL', 'FAILED', 'PENDING')
  ORDER BY d.created_at DESC
  LIMIT ? OFFSET ?`;

function seedDisposition(db: TestD1, id: string, status: string, lot = `lot-${id}`) {
  db.sqlite
    .prepare(
      `INSERT INTO gold_consignments
         (id, reference, producer_id, weight_declared_g, purity_declared, gold_type, status)
       VALUES (?, ?, 'prod-1', 1000, 0.92, 'nuggets', 'AUDIT_VALIDATED')`
    )
    .run(lot, `CONS-${id.toUpperCase()}`);
  db.sqlite
    .prepare(
      `INSERT INTO lot_dispositions
         (id, consignment_id, user_id, total_g, sell_g, lease_g, store_g, status)
       VALUES (?, ?, 'prod-1', 100, 50, 30, 20, ?)`
    )
    .run(id, lot, status);
}

function seedFee(db: TestD1, userId: string, date: string, amount: number, status = 'OUTSTANDING') {
  db.sqlite
    .prepare(
      `INSERT INTO storage_fee_accruals
         (id, user_id, accrual_date, stored_g, price_per_gram, annual_rate, amount_xof, status)
       VALUES (?, ?, ?, 100, 53000, 0.005, ?, ?)`
    )
    .run(`${userId}-${date}`, userId, date, amount, status);
}

describe('vues de support', () => {
  let db: TestD1;

  beforeEach(() => {
    db = createTestD1();
  });

  describe('répartitions à traiter', () => {
    it('remonte les répartitions incomplètes et tait celles qui ont abouti', () => {
      seedDisposition(db, 'd-ok', 'EXECUTED');
      seedDisposition(db, 'd-partial', 'PARTIAL');
      seedDisposition(db, 'd-failed', 'FAILED');

      const rows = db.sqlite.prepare(NEEDS_ATTENTION).all(50, 0) as Array<{ id: string }>;
      // Lister aussi les succès noierait les quelques lignes qui demandent une
      // intervention.
      expect(rows.map((r) => r.id).sort()).toEqual(['d-failed', 'd-partial']);
    });

    it('rattache la référence du lot, pas seulement un identifiant technique', () => {
      seedDisposition(db, 'd-partial', 'PARTIAL');
      const row = db.sqlite.prepare(NEEDS_ATTENTION).get(50, 0) as { reference: string };
      // Le producteur appelle en citant sa référence, pas un UUID.
      expect(row.reference).toBe('CONS-D-PARTIAL');
    });

    it('reste lisible si le lot a disparu', () => {
      // LEFT JOIN volontaire : une répartition orpheline doit rester visible,
      // sinon le cas le plus anormal serait le seul invisible.
      db.sqlite
        .prepare(
          `INSERT INTO lot_dispositions
             (id, consignment_id, user_id, total_g, sell_g, lease_g, store_g, status)
           VALUES ('orphan', 'lot-disparu', 'prod-1', 100, 50, 30, 20, 'PARTIAL')`
        )
        .run();

      const rows = db.sqlite.prepare(NEEDS_ATTENTION).all(50, 0) as Array<{ reference: string | null }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].reference).toBeNull();
    });
  });

  describe('arriérés de frais de garde', () => {
    it('agrège par détenteur, du plus gros au plus petit', () => {
      seedWallet(db, { id: 'w1', userId: 'u1', tokens: 100, cash: 0 });
      seedWallet(db, { id: 'w2', userId: 'u2', tokens: 500, cash: 0 });
      seedFee(db, 'u1', '2026-08-14', 73);
      seedFee(db, 'u1', '2026-08-15', 73);
      seedFee(db, 'u2', '2026-08-15', 365);

      const rows = db.sqlite.prepare(OUTSTANDING).all() as Array<{
        user_id: string;
        days_outstanding: number;
        total_xof: number;
        oldest: string;
      }>;

      expect(rows[0]).toMatchObject({ user_id: 'u2', total_xof: 365, days_outstanding: 1 });
      expect(rows[1]).toMatchObject({ user_id: 'u1', total_xof: 146, days_outstanding: 2 });
      // La date la plus ancienne dit depuis quand ça dure.
      expect(rows[1].oldest).toBe('2026-08-14');
    });

    it('ignore les frais déjà prélevés', () => {
      seedWallet(db, { id: 'w1', userId: 'u1', tokens: 100, cash: 0 });
      seedFee(db, 'u1', '2026-08-14', 73, 'PAID');
      seedFee(db, 'u1', '2026-08-15', 73);

      const rows = db.sqlite.prepare(OUTSTANDING).all() as Array<{ total_xof: number }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].total_xof).toBe(73);
    });

    it('joint le solde espèces, qui distingue un débiteur d’un job en panne', () => {
      // Un arriéré sur un compte approvisionné n'est pas un impayé commercial :
      // c'est le prélèvement qui n'a pas tourné. Sans cette colonne, les deux
      // situations se ressemblent.
      seedWallet(db, { id: 'w1', userId: 'u1', tokens: 100, cash: 1_000_000 });
      seedFee(db, 'u1', '2026-08-15', 73);

      const row = db.sqlite.prepare(OUTSTANDING).get() as { cash_balance: number };
      expect(row.cash_balance).toBe(1_000_000);
    });

    it('ne renvoie rien quand tout est à jour', () => {
      seedWallet(db, { id: 'w1', userId: 'u1', tokens: 100, cash: 0 });
      seedFee(db, 'u1', '2026-08-15', 73, 'PAID');
      expect(db.sqlite.prepare(OUTSTANDING).all()).toEqual([]);
    });
  });
});
