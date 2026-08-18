/**
 * Frais de garde à Dubaï, prélevés en XOF.
 *
 * DEUX RÈGLES, chacune fermant une façon de se tromper :
 *
 *  1. Seul l'or RÉELLEMENT GARDÉ est facturé. L'or en location n'est pas dans
 *     le coffre et rémunère déjà son détenteur ; le facturer serait prélever
 *     deux fois le même gramme. Comme la location sort les grammes du
 *     portefeuille, `token_balance` EST le poids gardé — rien à soustraire.
 *
 *  2. Un frais que le solde espèces ne couvre pas est enregistré IMPAYÉ, jamais
 *     perdu ni imposé (ADR 005). `cash_balance >= 0` est une contrainte CHECK :
 *     forcer le prélèvement ferait échouer l'écriture, et l'assouplir
 *     relâcherait un garde-fou qui protège bien plus que la facturation.
 *
 * L'accrual est idempotent par jour — `UNIQUE (user_id, accrual_date)` — donc
 * rejouer le job ne facture pas deux fois, qu'il ait payé ou non.
 */

const xof = (n: number) => Math.round(n);

export interface StorageFeeRow {
  id: string;
  user_id: string;
  accrual_date: string;
  stored_g: number;
  price_per_gram: number;
  annual_rate: number;
  amount_xof: number;
  status: 'PAID' | 'OUTSTANDING';
  paid_at: string | null;
  transaction_id: string | null;
}

export interface StorageFeeHolder {
  user_id: string;
  wallet_id: string;
  stored_g: number;
}

/** Un jour de garde, Actual/365 sur la valeur au comptant de l'or gardé. */
export function dailyStorageFeeXof(input: {
  storedG: number;
  pricePerGram: number;
  annualRate: number;
}): number {
  if (!(input.storedG > 0) || !(input.pricePerGram > 0) || !(input.annualRate > 0)) return 0;
  return xof((input.storedG * input.pricePerGram * input.annualRate) / 365);
}

export class StorageFeeService {
  constructor(private db: D1Database) {}

  /**
   * Détenteurs à facturer pour `date`.
   *
   * `appliesTo` vaut 'REFINER' par défaut : un investisseur particulier finance
   * déjà la plateforme par le spread d'achat et de vente. L'étendre à tous est
   * une décision produit, pas technique — d'où une clé de configuration plutôt
   * qu'une constante.
   */
  async holdersToCharge(date: string, appliesTo = 'REFINER'): Promise<StorageFeeHolder[]> {
    const scope =
      appliesTo === 'ALL'
        ? ''
        : `AND EXISTS (
             SELECT 1 FROM producer_profiles p
             WHERE p.user_id = w.user_id AND p.entity_type = 'REFINER'
           )`;

    const rows = await this.db
      .prepare(
        `SELECT w.user_id, w.id AS wallet_id, w.token_balance AS stored_g
         FROM wallets w
         WHERE w.token_balance > 0
           ${scope}
           AND NOT EXISTS (
             SELECT 1 FROM storage_fee_accruals f
             WHERE f.user_id = w.user_id AND f.accrual_date = ?
           )
         ORDER BY w.user_id`
      )
      .bind(date)
      .all<StorageFeeHolder>();
    return rows.results || [];
  }

  /**
   * Facturer un jour de garde, et le régler tout de suite si le solde le permet.
   *
   * L'insertion est séparée du règlement : le frais est DÛ dès qu'il est
   * calculé, qu'il soit payable ou non. Insérer et payer dans un même batch
   * ferait disparaître le frais quand le solde manque, c'est-à-dire dans le cas
   * le plus fréquent pour un raffineur qui livre du métal et non de l'argent.
   */
  async accrueDay(
    holder: StorageFeeHolder,
    date: string,
    pricePerGram: number,
    annualRate: number
  ): Promise<{ accrued: boolean; amountXof: number; paid: boolean }> {
    const amountXof = dailyStorageFeeXof({
      storedG: holder.stored_g,
      pricePerGram,
      annualRate,
    });
    if (amountXof <= 0) return { accrued: false, amountXof: 0, paid: false };

    const id = crypto.randomUUID();
    try {
      await this.db
        .prepare(
          `INSERT INTO storage_fee_accruals
             (id, user_id, accrual_date, stored_g, price_per_gram, annual_rate, amount_xof, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'OUTSTANDING')`
        )
        .bind(id, holder.user_id, date, holder.stored_g, pricePerGram, annualRate, amountXof)
        .run();
    } catch {
      // Jour déjà facturé : rejouer le job ne facture pas deux fois.
      return { accrued: false, amountXof: 0, paid: false };
    }

    const paid = await this.settleOne(id, holder.user_id, holder.wallet_id, amountXof);
    return { accrued: true, amountXof, paid };
  }

  /** Impayés d'un détenteur, du plus ancien au plus récent. */
  async outstandingFor(userId: string): Promise<StorageFeeRow[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM storage_fee_accruals
         WHERE user_id = ? AND status = 'OUTSTANDING'
         ORDER BY accrual_date ASC`
      )
      .bind(userId)
      .all<StorageFeeRow>();
    return rows.results || [];
  }

  async totalOutstandingXof(userId: string): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT COALESCE(SUM(amount_xof), 0) AS total FROM storage_fee_accruals
         WHERE user_id = ? AND status = 'OUTSTANDING'`
      )
      .bind(userId)
      .first<{ total: number }>();
    return xof(row?.total ?? 0);
  }

  /**
   * Régler les impayés d'un détenteur, du plus ancien au plus récent.
   *
   * S'arrête au premier frais que le solde ne couvre pas plutôt que de sauter à
   * un plus petit : un arriéré se solde dans l'ordre où il s'est formé, sinon
   * les vieux impayés ne partent jamais.
   */
  async settleOutstanding(userId: string, walletId: string): Promise<{ paid: number; paidXof: number }> {
    const pending = await this.outstandingFor(userId);
    let paid = 0;
    let paidXof = 0;

    for (const fee of pending) {
      const settled = await this.settleOne(fee.id, userId, walletId, fee.amount_xof);
      if (!settled) break;
      paid++;
      paidXof += fee.amount_xof;
    }

    return { paid, paidXof };
  }

  /**
   * Prélever un frais précis.
   *
   * Contrat de batch gardé, identique au reste du code : CHAQUE instruction
   * porte la même garde `status = 'OUTSTANDING'`, et le passage à PAID vient en
   * dernier — c'est son `changes` qui décide. Sans cela, un job rejoué
   * débiterait une seconde fois un frais déjà réglé, car une UPDATE qui ne
   * touche aucune ligne n'est pas une erreur en SQLite.
   *
   * Le débit lui-même est INCONDITIONNEL sur le montant : si le solde ne suffit
   * pas, `CHECK (cash_balance >= 0)` fait échouer le batch entier et le frais
   * reste impayé. C'est le même mécanisme que `executeWithdrawalAtomic` — une
   * garde `WHERE cash_balance >= ?` se contenterait de ne rien faire, et
   * laisserait la transaction FEE écrite sans débit correspondant.
   */
  private async settleOne(
    feeId: string,
    userId: string,
    walletId: string,
    amountXof: number
  ): Promise<boolean> {
    // Cas courant traité de façon déterministe : un raffineur qui a livré du
    // métal et non de l'argent n'a simplement pas de quoi payer.
    const wallet = await this.db
      .prepare('SELECT cash_balance FROM wallets WHERE id = ?')
      .bind(walletId)
      .first<{ cash_balance: number }>();
    if (!wallet || wallet.cash_balance < amountXof) return false;

    const transactionId = crypto.randomUUID();
    const guard = `EXISTS (SELECT 1 FROM storage_fee_accruals WHERE id = ? AND status = 'OUTSTANDING')`;

    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO transactions
               (id, user_id, wallet_id, type, status, token_amount, cash_amount, metadata, created_at, completed_at, currency)
             SELECT ?, ?, ?, 'FEE', 'COMPLETED', NULL, ?, ?, datetime('now'), datetime('now'),
                    (SELECT currency FROM wallets WHERE id = ?)
             WHERE ${guard}`
          )
          .bind(
            transactionId,
            userId,
            walletId,
            amountXof,
            JSON.stringify({ kind: 'STORAGE_FEE', feeId }),
            walletId,
            feeId
          ),
        this.db
          .prepare(
            `UPDATE wallets SET cash_balance = cash_balance - ?, updated_at = datetime('now')
             WHERE id = ? AND ${guard}`
          )
          .bind(amountXof, walletId, feeId),
        // En dernier, gardé : c'est son `changes` qui décide si le frais est réglé.
        this.db
          .prepare(
            `UPDATE storage_fee_accruals
             SET status = 'PAID', paid_at = datetime('now'), transaction_id = ?
             WHERE id = ? AND status = 'OUTSTANDING'`
          )
          .bind(transactionId, feeId),
      ]);

      const flip = results[results.length - 1] as { meta: { changes: number } };
      return flip.meta.changes > 0;
    } catch {
      // Solde vidé par une opération concurrente : la contrainte CHECK a annulé
      // le batch, le frais reste dû.
      return false;
    }
  }
}
