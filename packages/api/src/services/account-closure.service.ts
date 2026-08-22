/**
 * Fermer un compte sans effacer l'histoire — ADR 015.
 *
 * `DELETE /users/me` supprimait la ligne `users`. Douze tables la referencent
 * sans `ON DELETE CASCADE` — a commencer par `quotes` — donc la suppression
 * echouait pour tout utilisateur ayant demande un seul devis, et renvoyait
 * INTERNAL_ERROR 500 sans lui dire pourquoi.
 *
 * Trois regles portent le remplacement :
 *
 *   1. La ligne `users` SUBSISTE, anonymisee. Retirer la donnee personnelle et
 *      conserver le registre des operations ne s'opposent que si l'on confond
 *      « le compte » et « ce que le compte a fait ».
 *   2. Ce qui empeche la fermeture SE DIT. Un solde a zero ne prouve pas qu'on ne
 *      detient rien : la location sort les grammes du portefeuille.
 *   3. Les objets R2 partent AVANT les lignes qui les designent. L'ordre inverse
 *      perd le pointeur et laisse la piece d'identite en ligne.
 */

import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

export type MotifRefus =
  | 'BALANCE_NOT_ZERO'
  | 'PENDING_TRANSACTIONS'
  | 'LEASE_POSITION_OPEN'
  | 'CONSIGNMENT_IN_PROGRESS'
  | 'STORAGE_FEES_OUTSTANDING'
  | 'STORAGE_DELETE_FAILED';

export interface VerdictCloture {
  ok: boolean;
  code?: MotifRefus;
  /**
   * PAS DE `message` (ADR 025/026). Ce service tourne hors requete : il ne
   * connait pas la langue du titulaire. Il nomme l'obstacle et fournit ses
   * chiffres dans `details` ; la route les met en mots.
   */
  details?: Record<string, unknown>;
}

/** Forme PLATE : ce paquet compile avec `strictNullChecks: false`. */
const refus = (code: MotifRefus, details?: Record<string, unknown>): VerdictCloture => ({
  ok: false,
  code,
  details,
});

export class AccountClosureService {
  constructor(
    private readonly db: D1Database,
    private readonly stockage?: R2Bucket
  ) {}

  /**
   * Ce qui empeche la fermeture, dans l'ordre ou l'utilisateur peut y remedier.
   *
   * Chaque refus nomme la condition. `INTERNAL_ERROR` ne dit pas au titulaire ce
   * qu'il lui reste a faire.
   */
  async obstacles(userId: string): Promise<VerdictCloture> {
    const wallet = await this.db
      .prepare('SELECT token_balance, cash_balance FROM wallets WHERE user_id = ?')
      .bind(userId)
      .first<{ token_balance: number; cash_balance: number }>();

    if (wallet && (wallet.token_balance > 0 || wallet.cash_balance > 0)) {
      return refus('BALANCE_NOT_ZERO', {
        tokenBalance: wallet.token_balance,
        cashBalance: wallet.cash_balance,
      });
    }

    const enCours = await this.db
      .prepare("SELECT COUNT(*) as count FROM transactions WHERE user_id = ? AND status IN ('PENDING', 'PROCESSING')")
      .bind(userId)
      .first<{ count: number }>();

    if ((enCours?.count || 0) > 0) {
      return refus('PENDING_TRANSACTIONS');
    }

    // Le controle qui manquait vraiment. Louer son or le retire du portefeuille :
    // le solde d'un preteur est a zero PARCE QUE son or est prete.
    const location = await this.db
      .prepare("SELECT COUNT(*) as count, COALESCE(SUM(principal_g), 0) as grammes FROM lease_positions WHERE user_id = ? AND status IN ('ACTIVE', 'EXITING')")
      .bind(userId)
      .first<{ count: number; grammes: number }>();

    if ((location?.count || 0) > 0) {
      return refus('LEASE_POSITION_OPEN', {
        positions: location.count,
        grammesG: location.grammes,
      });
    }

    const lots = await this.db
      .prepare("SELECT COUNT(*) as count FROM gold_consignments WHERE producer_id = ? AND status NOT IN ('AUDIT_VALIDATED', 'REJECTED')")
      .bind(userId)
      .first<{ count: number }>();

    if ((lots?.count || 0) > 0) {
      return refus('CONSIGNMENT_IN_PROGRESS', { lots: lots.count });
    }

    const arrieres = await this.db
      .prepare("SELECT COALESCE(SUM(amount_xof), 0) as total FROM storage_fee_accruals WHERE user_id = ? AND status = 'OUTSTANDING'")
      .bind(userId)
      .first<{ total: number }>();

    if ((arrieres?.total || 0) > 0) {
      return refus('STORAGE_FEES_OUTSTANDING', { montantXof: Math.round(arrieres.total) });
    }

    return { ok: true };
  }

  /**
   * Supprime les objets R2 des pieces d'identite, AVANT les lignes.
   *
   * L'ordre inverse — celui qui etait en place — supprimait les lignes et
   * laissait les images chiffrees dans R2, desormais sans rien pour les
   * designer : la donnee personnelle survivait a sa propre suppression.
   *
   * Un echec INTERROMPT la fermeture. Annoncer un compte ferme en laissant les
   * pieces en ligne serait le pire des deux mondes.
   */
  async supprimerPieces(userId: string): Promise<VerdictCloture> {
    const lignes = await this.db
      .prepare('SELECT front_image_url, back_image_url, selfie_url FROM kyc_documents WHERE user_id = ?')
      .bind(userId)
      .all<{ front_image_url: string; back_image_url: string | null; selfie_url: string }>();

    const cles = (lignes.results || [])
      .flatMap((l) => [l.front_image_url, l.back_image_url, l.selfie_url])
      .filter((c): c is string => typeof c === 'string' && c.length > 0);

    if (!cles.length || !this.stockage) return { ok: true };

    try {
      for (const cle of cles) {
        await this.stockage.delete(cle);
      }
    } catch (error) {
      return refus('STORAGE_DELETE_FAILED', { raison: String(error) });
    }

    return { ok: true };
  }

  /**
   * Retire la donnee personnelle et anonymise la ligne, en un seul lot.
   *
   * Les transactions, la piste d'audit, les certificats et l'historique de
   * location NE SONT PAS supprimes : ce sont des ecritures, pas du profil. Les
   * effacer modifierait retroactivement des rapports deja transmis a l'Etat.
   */
  fermeture(userId: string, maintenant: string) {
    // `email` et `phone` sont UNIQUE NOT NULL : la valeur de remplacement doit
    // rester unique, et ne doit pas pouvoir servir a se reconnecter.
    const emailFerme = `closed+${userId}@invalid`;
    const telephoneFerme = `+000${userId.replace(/[^0-9]/g, '').slice(0, 12).padEnd(12, '0')}`;

    return [
      this.db.prepare('DELETE FROM kyc_documents WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM price_alerts WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM notification_preferences WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM notifications WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM active_sessions WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM password_history WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM security_events WHERE user_id = ?').bind(userId),

      // La ligne SUBSISTE, vidée de ce qui identifie. `tokens_invalid_before`
      // revoque immediatement tout jeton deja emis.
      this.db
        .prepare(
          `UPDATE users
           SET email = ?, phone = ?, first_name = NULL, last_name = NULL,
               password_hash = '', two_factor_enabled = 0, two_factor_secret = NULL,
               closed_at = ?, tokens_invalid_before = ?, updated_at = datetime('now')
           WHERE id = ? AND closed_at IS NULL`
        )
        .bind(emailFerme, telephoneFerme, maintenant, maintenant, userId),

      // Fermer un compte est une operation sur des avoirs : elle appartient au
      // registre au meme titre qu'un retrait (ADR 014).
      this.db
        .prepare(
          `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, new_value, created_at)
           SELECT ?, ?, 'ACCOUNT_CLOSED', 'user', ?, ?, datetime('now')
           FROM users WHERE id = ? AND closed_at = ?`
        )
        // Garde sur la valeur EXACTE posee par ce lot, et non sur
        // `closed_at IS NOT NULL` : un compte deja ferme aurait alors ecrit une
        // seconde trace annoncant une fermeture qui n'a pas eu lieu.
        .bind(
          crypto.randomUUID(),
          userId,
          userId,
          JSON.stringify({ conserve: ['transactions', 'audit_logs', 'certificates', 'lease_positions'] }),
          userId,
          maintenant
        ),
    ];
  }
}
