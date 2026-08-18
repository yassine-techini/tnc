/**
 * Le registre des actions d'audit — ADR 014.
 *
 * POURQUOI IL EXISTE
 *
 * Le cron de purge epargnait une liste d'actions « critiques » :
 *
 *   'KYC_APPROVED', 'KYC_REJECTED', 'USER_SUSPENDED',
 *   'WITHDRAWAL_APPROVED', 'STOCK_ADJUSTED', 'ADMIN_CREATED'
 *
 * Les routes ecrivaient `KYC_APPROVE`, `WITHDRAWAL_APPROVE`, `STOCK_ADJUST` — des
 * infinitifs, la ou la liste attendait des participes passes. Sur six entrees,
 * une seule (`USER_SUSPENDED`) protegeait quelque chose. La trace de qui a
 * ajuste le stock d'or national disparaissait donc au bout d'un an, alors qu'un
 * mecanisme explicite existait pour l'en empecher.
 *
 * Pire pour `KYC_APPROVED` : cette action EST ecrite — par le rappel du
 * prestataire de verification, pas par la decision de l'administrateur. Les deux
 * noms different d'une lettre et designent des evenements differents. La liste
 * protegeait le resultat automatique et laissait purger la decision humaine.
 *
 * COMMENT
 *
 * Une seule table, ici. Le purgeur en derive sa liste au lieu de la recopier, et
 * `pnpm check:audit` refuse toute action ecrite qui n'y figure pas — ainsi que
 * toute entree du registre que personne n'ecrit, ce qui aurait attrape
 * `ADMIN_CREATED` : la liste protegeait une action qui n'etait jamais tracee.
 */

/** `permanent` : jamais purgee, quelle que soit la retention configuree. */
export interface ActionAudit {
  permanent: boolean;
  /** Pourquoi. Obligatoire pour une action permanente — une exception sans motif n'en est pas une. */
  motif: string;
}

export const ACTIONS_AUDIT: Record<string, ActionAudit> = {
  // ── Decisions d'administrateur ───────────────────────────────────────────
  KYC_APPROVE: { permanent: true, motif: "Ouvre le droit d'acheter et de vendre" },
  KYC_REJECT: { permanent: true, motif: "Refuse l'acces au marche a une personne identifiee" },
  KYC_BULK_APPROVE: { permanent: true, motif: 'Meme portee, appliquee a un lot de dossiers' },
  USER_SUSPENDED: { permanent: true, motif: "Prive un titulaire de l'acces a ses avoirs" },
  USER_UNSUSPENDED: { permanent: true, motif: 'Le retablit — la levee compte autant que la mesure' },
  STOCK_ADJUST: { permanent: true, motif: "Modifie l'or alloue par l'Etat : le chiffre qui garantit les jetons" },
  WITHDRAWAL_APPROVE: { permanent: true, motif: 'Sortie de fonds' },
  WITHDRAWAL_REJECT: { permanent: true, motif: 'Refus de sortie de fonds' },
  PRODUCER_KYB_APPROVED: { permanent: true, motif: "Autorise une entite a consigner de l'or" },
  PRODUCER_KYB_REJECTED: { permanent: true, motif: 'Lui refuse cette autorisation' },
  CONSIGNMENT_AUDIT_VALIDATED: { permanent: true, motif: "Emet des jetons contre de l'or raffine" },
  CONSIGNMENT_ADVANCE_PAID: { permanent: true, motif: 'Verse un acompte sur un lot' },
  RECONCILE_TRANSACTION: { permanent: true, motif: "Corrige a la main l'etat d'une transaction" },
  ADMIN_CREATED: { permanent: true, motif: 'Cree un compte qui peut tout ce qui precede' },
  ADMIN_PASSWORD_RESET: { permanent: true, motif: "Rend l'acces a un tel compte" },

  ACCOUNT_CLOSED: { permanent: true, motif: 'Fermeture de compte : une operation sur des avoirs' },

  // ── Mouvements d'avoirs ──────────────────────────────────────────────────
  LEASE_OPENED: { permanent: true, motif: "Sort de l'or du portefeuille vers le pret" },
  LEASE_SETTLED: { permanent: true, motif: "Le rend, avec le rendement accumule" },
  LOT_DISPOSED: { permanent: true, motif: "Repartit un lot entre vente, location et garde" },

  // ── Verification d'identite (prestataire) ────────────────────────────────
  KYC_SUBMITTED: { permanent: true, motif: 'Depot du dossier — point de depart de la piste' },
  KYC_APPROVED: { permanent: true, motif: 'Verdict du prestataire, distinct de la decision admin' },
  KYC_REJECTED: { permanent: true, motif: 'Idem, en refus' },

  // ── Encaissements ────────────────────────────────────────────────────────
  PAYMENT_WEBHOOK: { permanent: true, motif: "Preuve qu'un paiement a ete confirme par l'operateur" },
  BANK_WEBHOOK_PROCESSED: { permanent: true, motif: 'Virement rapproche et credite' },
  BANK_WEBHOOK_UNMATCHED: { permanent: true, motif: "Virement recu sans destinataire identifie — l'argent existe" },
  BANK_WEBHOOK_AMOUNT_MISMATCH: { permanent: true, motif: 'Ecart entre le montant attendu et recu' },

  // ── Souverain ────────────────────────────────────────────────────────────
  STATE_EXPORT: { permanent: true, motif: "Qui a extrait quoi du portail de l'Etat" },

  // ── Exploitation : purgeable ─────────────────────────────────────────────
  DAILY_RECONCILIATION: { permanent: false, motif: '' },
  RECONCILIATION_ALERT: { permanent: false, motif: '' },
  QUOTE_CLEANUP: { permanent: false, motif: '' },
  STUCK_TRANSACTIONS_FOUND: { permanent: false, motif: '' },
  SESSION_CLEANUP: { permanent: false, motif: '' },
  MONTHLY_REPORT: { permanent: false, motif: '' },
  READINESS_PROBE: { permanent: false, motif: '' },
};

/** Les actions que la purge doit epargner, derivees et non recopiees. */
export const ACTIONS_PERMANENTES: string[] = Object.entries(ACTIONS_AUDIT)
  .filter(([, v]) => v.permanent)
  .map(([k]) => k)
  .sort();

export function estPermanente(action: string): boolean {
  return ACTIONS_AUDIT[action]?.permanent === true;
}
