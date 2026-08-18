/**
 * Répartition d'un lot : vendre / louer / stocker.
 *
 * Un raffineur peut combiner les trois sur un même lot. Le service valide la
 * répartition, puis exécute chaque jambe en DÉLÉGUANT au chemin existant :
 * `WalletService.executeSellAtomic` pour la vente, `LeaseService.open` pour la
 * location. Rien de financier n'est réécrit ici — l'ADR 004 a déjà tranché que
 * dupliquer une écriture financière est le meilleur moyen d'en faire diverger
 * les deux copies.
 *
 * CONSÉQUENCE ASSUMÉE : l'exécution n'est pas un seul batch atomique. Chaque
 * jambe porte son statut, donc une exécution partielle est **visible et
 * reprenable** plutôt que silencieuse. Le solde est vérifié avant de commencer,
 * si bien que le seul échec réaliste est une action concurrente — et c'est
 * précisément le cas qu'un statut par jambe rend lisible.
 *
 * « Stocker » n'exécute rien : les grammes restent au portefeuille. Ce n'est pas
 * une absence d'action pour autant — c'est une intention enregistrée, et c'est
 * elle qui déclenche les frais de garde.
 */

import { LeaseService } from './lease.service';
import { WalletService } from './wallet.service';

const g = (n: number) => Math.round(n * 1000) / 1000;
const xof = (n: number) => Math.round(n);

export type LegStatus = 'NONE' | 'PENDING' | 'DONE' | 'FAILED';

export interface DispositionRow {
  id: string;
  consignment_id: string;
  user_id: string;
  total_g: number;
  sell_g: number;
  lease_g: number;
  store_g: number;
  status: 'PENDING' | 'EXECUTED' | 'PARTIAL' | 'FAILED';
  sell_status: LegStatus;
  lease_status: LegStatus;
  sell_transaction_id: string | null;
  sell_price_per_gram: number | null;
  sell_proceeds_xof: number | null;
  lease_position_id: string | null;
  failure_reason: string | null;
  created_at: string;
  executed_at: string | null;
}

export interface DispositionSplit {
  sellG: number;
  leaseG: number;
  storeG: number;
}

export type DispositionError =
  | 'NOT_FOUND'
  | 'NOT_SETTLED'
  | 'ALREADY_DISPOSED'
  | 'NOTHING_CREDITED'
  | 'NEGATIVE_SHARE'
  | 'SPLIT_MISMATCH'
  | 'INSUFFICIENT_BALANCE'
  | 'NO_PRICE'
  | 'NO_WALLET'
  | 'CONFLICT';

export interface SplitCheck {
  valid: boolean;
  error: DispositionError | null;
  /** Somme des trois parts, arrondie au milligramme. */
  totalG: number;
}

/**
 * Valider une répartition contre le poids crédité.
 *
 * La somme doit couvrir **exactement** le lot. Accepter un reliquat implicite
 * obligerait à décider en silence ce qu'il devient — et le silence, ici, veut
 * dire de l'or dont personne ne sait s'il est vendu, loué ou gardé.
 */
export function checkSplit(split: DispositionSplit, creditedG: number): SplitCheck {
  const sellG = g(split.sellG);
  const leaseG = g(split.leaseG);
  const storeG = g(split.storeG);

  if (sellG < 0 || leaseG < 0 || storeG < 0) {
    return { valid: false, error: 'NEGATIVE_SHARE', totalG: 0 };
  }

  const totalG = g(sellG + leaseG + storeG);
  if (!(creditedG > 0)) return { valid: false, error: 'NOTHING_CREDITED', totalG };
  // Tolérance au milligramme : c'est l'unité de compte de la plateforme, pas une
  // marge d'erreur.
  if (Math.abs(totalG - g(creditedG)) > 0.0005) {
    return { valid: false, error: 'SPLIT_MISMATCH', totalG };
  }

  return { valid: true, error: null, totalG };
}

export interface DispositionResult {
  ok: boolean;
  disposition: DispositionRow | null;
  error: DispositionError | null;
}

export class DispositionService {
  constructor(private db: D1Database) {}

  async getByConsignment(consignmentId: string): Promise<DispositionRow | null> {
    const row = await this.db
      .prepare('SELECT * FROM lot_dispositions WHERE consignment_id = ?')
      .bind(consignmentId)
      .first<DispositionRow>();
    return row || null;
  }

  async getById(id: string): Promise<DispositionRow | null> {
    const row = await this.db
      .prepare('SELECT * FROM lot_dispositions WHERE id = ?')
      .bind(id)
      .first<DispositionRow>();
    return row || null;
  }

  async listForUser(userId: string): Promise<DispositionRow[]> {
    const rows = await this.db
      .prepare('SELECT * FROM lot_dispositions WHERE user_id = ? ORDER BY created_at DESC')
      .bind(userId)
      .all<DispositionRow>();
    return rows.results || [];
  }

  /**
   * Répartir un lot déjà réglé.
   *
   * Ordre : enregistrer l'instruction, puis exécuter. L'instruction survit à
   * l'échec d'une jambe, ce qui est tout l'intérêt — sinon un échec effacerait
   * jusqu'à la trace de ce que le raffineur avait demandé.
   */
  async dispose(p: {
    consignmentId: string;
    userId: string;
    split: DispositionSplit;
    creditedG: number;
    sellPricePerGram: number;
    leaseAnnualRate: number;
    leaseMinimumG: number;
  }): Promise<DispositionResult> {
    const fail = (error: DispositionError): DispositionResult => ({
      ok: false,
      disposition: null,
      error,
    });

    const check = checkSplit(p.split, p.creditedG);
    if (!check.valid) return fail(check.error!);

    const sellG = g(p.split.sellG);
    const leaseG = g(p.split.leaseG);
    const storeG = g(p.split.storeG);

    if (sellG > 0 && !(p.sellPricePerGram > 0)) return fail('NO_PRICE');

    const wallet = await this.db
      .prepare('SELECT id, token_balance FROM wallets WHERE user_id = ?')
      .bind(p.userId)
      .first<{ id: string; token_balance: number }>();
    if (!wallet) return fail('NO_WALLET');

    // Vérifié avant de commencer : mieux vaut refuser l'instruction entière que
    // d'exécuter une jambe puis buter sur la suivante.
    //
    // La comparaison était écrite `token_balance + 0.0005 < …` : une tolérance
    // d'un demi-milligramme, posée ici parce que la dérive flottante s'y était
    // manifestée. C'était le SEUL endroit à la porter, alors que la vente et la
    // mise en location comparaient sans indulgence. Les soldes étant désormais
    // quantifiés à l'écriture (ADR 013), la comparaison exacte est correcte —
    // et une tolérance résiduelle masquerait un retour de la dérive.
    if (wallet.token_balance < g(sellG + leaseG)) {
      return fail('INSUFFICIENT_BALANCE');
    }

    const dispositionId = crypto.randomUUID();
    try {
      await this.db
        .prepare(
          `INSERT INTO lot_dispositions
             (id, consignment_id, user_id, total_g, sell_g, lease_g, store_g,
              status, sell_status, lease_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`
        )
        .bind(
          dispositionId,
          p.consignmentId,
          p.userId,
          check.totalG,
          sellG,
          leaseG,
          storeG,
          sellG > 0 ? 'PENDING' : 'NONE',
          leaseG > 0 ? 'PENDING' : 'NONE'
        )
        .run();
    } catch {
      // UNIQUE(consignment_id) : répartir deux fois le même lot reviendrait à
      // disposer deux fois du même or.
      return fail('ALREADY_DISPOSED');
    }

    await this.execute(dispositionId, {
      userId: p.userId,
      walletId: wallet.id,
      sellG,
      leaseG,
      sellPricePerGram: p.sellPricePerGram,
      leaseAnnualRate: p.leaseAnnualRate,
      leaseMinimumG: p.leaseMinimumG,
    });

    const disposition = await this.getById(dispositionId);
    if (!disposition) return fail('CONFLICT');
    return { ok: disposition.status !== 'FAILED', disposition, error: null };
  }

  /**
   * Exécuter les jambes non encore faites.
   *
   * Réentrant : une jambe déjà `DONE` n'est pas rejouée. C'est ce qui rend une
   * exécution partielle reprenable — par un nouvel appel, sans re-saisie du
   * raffineur et sans risque de vendre deux fois.
   */
  async execute(
    dispositionId: string,
    ctx: {
      userId: string;
      walletId: string;
      sellG: number;
      leaseG: number;
      sellPricePerGram: number;
      leaseAnnualRate: number;
      leaseMinimumG: number;
    }
  ): Promise<void> {
    const current = await this.getById(dispositionId);
    if (!current) return;

    const failures: string[] = [];

    // ── Vente ────────────────────────────────────────────────────────────────
    if (current.sell_status === 'PENDING' && ctx.sellG > 0) {
      const wallets = new WalletService(this.db);
      const transactionId = crypto.randomUUID();
      const proceeds = xof(ctx.sellG * ctx.sellPricePerGram);

      const result = await wallets.executeSellAtomic({
        transactionId,
        userId: ctx.userId,
        walletId: ctx.walletId,
        tokenAmount: ctx.sellG,
        cashAmount: proceeds,
        total: proceeds,
        pricePerGram: ctx.sellPricePerGram,
        // Aucun frais spécifique : le spread est déjà dans le prix de vente.
        fees: 0,
      });

      if (result.ok) {
        await this.db
          .prepare(
            `UPDATE lot_dispositions
             SET sell_status = 'DONE', sell_transaction_id = ?, sell_price_per_gram = ?,
                 sell_proceeds_xof = ?
             WHERE id = ? AND sell_status = 'PENDING'`
          )
          .bind(transactionId, ctx.sellPricePerGram, proceeds, dispositionId)
          .run();
      } else {
        failures.push(`vente: ${result.reason}`);
        await this.db
          .prepare(
            `UPDATE lot_dispositions SET sell_status = 'FAILED' WHERE id = ? AND sell_status = 'PENDING'`
          )
          .bind(dispositionId)
          .run();
      }
    }

    // ── Location ─────────────────────────────────────────────────────────────
    if (current.lease_status === 'PENDING' && ctx.leaseG > 0) {
      const leases = new LeaseService(this.db);
      const opened = await leases.open(
        ctx.userId,
        ctx.leaseG,
        ctx.leaseAnnualRate,
        ctx.leaseMinimumG
      );

      if (opened.ok) {
        await this.db
          .prepare(
            `UPDATE lot_dispositions
             SET lease_status = 'DONE', lease_position_id = ?
             WHERE id = ? AND lease_status = 'PENDING'`
          )
          .bind(opened.position.id, dispositionId)
          .run();
      } else {
        failures.push(`location: ${opened.error}`);
        await this.db
          .prepare(
            `UPDATE lot_dispositions SET lease_status = 'FAILED' WHERE id = ? AND lease_status = 'PENDING'`
          )
          .bind(dispositionId)
          .run();
      }
    }

    // ── Statut d'ensemble ────────────────────────────────────────────────────
    const after = await this.getById(dispositionId);
    if (!after) return;

    const legs = [after.sell_status, after.lease_status].filter((s) => s !== 'NONE');
    const allDone = legs.every((s) => s === 'DONE');
    const noneDone = legs.every((s) => s === 'FAILED');

    // Aucune jambe à exécuter (tout en stockage) est un succès, pas un vide :
    // l'intention est enregistrée et les frais de garde s'y appliqueront.
    const status = legs.length === 0 || allDone ? 'EXECUTED' : noneDone ? 'FAILED' : 'PARTIAL';

    await this.db
      .prepare(
        `UPDATE lot_dispositions
         SET status = ?, failure_reason = ?, executed_at = COALESCE(executed_at, datetime('now'))
         WHERE id = ?`
      )
      .bind(status, failures.length ? failures.join(' · ').slice(0, 500) : null, dispositionId)
      .run();

    await this.db
      .prepare(
        `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at)
         VALUES (?, NULL, 'LOT_DISPOSED', 'lot_disposition', ?, ?, datetime('now'))`
      )
      .bind(
        crypto.randomUUID(),
        dispositionId,
        JSON.stringify({
          consignmentId: after.consignment_id,
          sellG: after.sell_g,
          leaseG: after.lease_g,
          storeG: after.store_g,
          status,
        })
      )
      .run();
  }
}
