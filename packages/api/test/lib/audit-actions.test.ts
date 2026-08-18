import { describe, expect, it } from 'vitest';
import { ACTIONS_AUDIT, ACTIONS_PERMANENTES, estPermanente } from '../../src/lib/audit-actions';
import { actionsEcrites, verifierLeDepot, lireRegistre } from '../../scripts/check-audit-actions.mjs';

/**
 * Le registre des actions d'audit — ADR 014, constat AA.
 *
 * Le cron de purge epargnait `KYC_APPROVED`, `WITHDRAWAL_APPROVED` et
 * `STOCK_ADJUSTED` ; les routes ecrivaient `KYC_APPROVE`, `WITHDRAWAL_APPROVE`,
 * `STOCK_ADJUST`. Une entree sur six protegeait quelque chose, et la purge
 * s'executait sans erreur en emportant ce qu'elle devait garder.
 */

describe('Les decisions les plus lourdes ne se purgent pas', () => {
  const decisions = [
    'KYC_APPROVE',
    'KYC_REJECT',
    'STOCK_ADJUST',
    'WITHDRAWAL_APPROVE',
    'WITHDRAWAL_REJECT',
    'USER_SUSPENDED',
    'ADMIN_CREATED',
    'ADMIN_PASSWORD_RESET',
  ];

  for (const action of decisions) {
    it(`${action} est permanente`, () => {
      expect(estPermanente(action), action).toBe(true);
      expect(ACTIONS_PERMANENTES).toContain(action);
    });
  }

  it('ce sont bien les noms ECRITS, pas leurs participes passes', () => {
    // Le defaut tenait entierement dans cette lettre : la liste protegeait
    // `STOCK_ADJUSTED`, la route ecrivait `STOCK_ADJUST`.
    expect(ACTIONS_AUDIT.STOCK_ADJUSTED).toBeUndefined();
    expect(ACTIONS_AUDIT.WITHDRAWAL_APPROVED).toBeUndefined();
  });

  it('distingue le verdict du prestataire de la decision de l administrateur', () => {
    // `KYC_APPROVED` EST ecrite — par le rappel de verification. Les deux noms
    // different d'une lettre et designent des evenements differents ; la liste
    // protegeait l'automatique et laissait purger l'humain.
    expect(estPermanente('KYC_APPROVED')).toBe(true); // prestataire
    expect(estPermanente('KYC_APPROVE')).toBe(true); // administrateur
    expect(ACTIONS_AUDIT.KYC_APPROVED.motif).not.toBe(ACTIONS_AUDIT.KYC_APPROVE.motif);
  });

  it('laisse purger les traces d exploitation', () => {
    // Une trace de cron n'a pas a survivre a la retention : la garder tout
    // conserver reviendrait a ne rien conserver de particulier.
    for (const a of ['SESSION_CLEANUP', 'QUOTE_CLEANUP', 'READINESS_PROBE']) {
      expect(estPermanente(a), a).toBe(false);
    }
  });

  it('exige un motif ecrit pour chaque action permanente', () => {
    // Une exception sans justification n'en est pas une — meme regle que pour
    // les tables exclues de la sauvegarde et les routes sans garde de propriete.
    for (const a of ACTIONS_PERMANENTES) {
      expect(ACTIONS_AUDIT[a].motif.length, a).toBeGreaterThan(10);
    }
  });
});

describe('Le controle du registre', () => {
  it('repere une action ecrite qui n est pas enregistree', () => {
    const p = verifierLeDepot({ AUTRE_CHOSE: { permanent: true } }, 'src');

    expect(p.some((x) => x.quoi.includes('absente du registre'))).toBe(true);
  });

  it('repere une entree que personne n ecrit', () => {
    // C'est ce sens-la qui manquait, et c'est lui qui aurait attrape
    // `ADMIN_CREATED` : la purge protegeait une action jamais tracee.
    const registre = { ...lireRegistre(), FANTOME_QUE_NUL_N_ECRIT: { permanent: true } };
    const p = verifierLeDepot(registre, 'src');

    expect(p).toContainEqual({
      quoi: 'action du registre que personne n ecrit',
      action: 'FANTOME_QUE_NUL_N_ECRIT',
    });
  });

  it('refuse une action construite par gabarit', () => {
    // `KYC_${action}` rendait la valeur ecrite invisible a la lecture comme au
    // controle. Tolerer le prefixe benissait toute action le partageant, donc
    // laissait passer une entree fantome : le gabarit est refuse, pas tolere.
    const source = "db.prepare('INSERT INTO audit_logs (id, action) VALUES (?, ?)').bind(id, `KYC_${verdict}`)";

    expect(actionsEcrites(source, 'x.ts')).toContainEqual(
      expect.objectContaining({ action: null, prefixe: 'KYC_' })
    );
  });

  it('ne prend pas un gabarit cite en commentaire pour du code', () => {
    // Mes propres commentaires d'explication contiennent le gabarit fautif.
    const source = [
      '// L action etait construite ainsi : `KYC_${action}`',
      "db.prepare('INSERT INTO audit_logs (id, action) VALUES (?, ?)').bind(id, 'KYC_APPROVE')",
    ].join('\n');

    const trouvees = actionsEcrites(source, 'x.ts');

    expect(trouvees.map((t) => t.action)).toEqual(['KYC_APPROVE']);
  });

  it('ne se tait pas sur le depot reel', () => {
    // Sans ce controle du controle, un detecteur casse rendrait zero probleme et
    // les tests precedents passeraient au vert sans rien avoir verifie. Une
    // premiere version retirait les commentaires du source et supprimait au
    // passage 5 des 8 requetes d audit du fichier.
    const src = readFileSyncSafe('src/routes/admin.ts');

    expect(actionsEcrites(src, 'admin.ts').filter((a) => a.action).length).toBeGreaterThanOrEqual(10);
  });

  it('est satisfait de l etat actuel du depot', () => {
    expect(verifierLeDepot(lireRegistre(), 'src')).toEqual([]);
  });
});

function readFileSyncSafe(p: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('node:fs').readFileSync(p, 'utf8');
}
