/**
 * Ce que le portail État reçoit réellement.
 *
 * Le client du portail déclarait `totalAllocated`, `tokensIssued` et
 * `coverage` ; la route renvoie `goldAllocated`, `totalTokens` et
 * `coverageRatio`. Aucun ne correspondait, donc le tableau de bord affichait en
 * permanence **0 g de réserve nationale et 0 % de couverture**, avec l'alerte
 * rouge qui va avec. TypeScript ne pouvait rien voir : le mensonge était dans le
 * paramètre de type du client.
 *
 * Ces tests épinglent les NOMS DE CHAMPS que les routes émettent. Un test de
 * rendu sur une réponse simulée n'aurait rien attrapé — il aurait simulé la
 * réponse imaginaire.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('../../src/routes/state.ts', import.meta.url), 'utf8');

/**
 * Un champ est présent qu'il soit écrit `nom: valeur` ou en notation abrégée
 * `nom,` — les deux sont légitimes et produisent la même réponse.
 */
function emits(payload: string, field: string): boolean {
  // Construit sans chaîne gabarit : `\b` et `\s` y seraient consommés comme des
  // échappements JavaScript, et la regex chercherait un caractère « backspace ».
  return new RegExp('\\b' + field + '\\s*[:,]').test(payload);
}

/** Le bloc `data: { … }` d'une route donnée. */
function payloadOf(routeMarker: string): string {
  const start = SOURCE.indexOf(routeMarker);
  expect(start, `route introuvable : ${routeMarker}`).toBeGreaterThan(-1);
  const dataAt = SOURCE.indexOf('data: {', start);
  return SOURCE.slice(dataAt, SOURCE.indexOf('requestId', dataAt));
}

describe('charge utile du portail État', () => {
  describe('/state/dashboard', () => {
    const payload = () => payloadOf("state.get('/dashboard'");

    it('émet les champs que le portail lit', () => {
      for (const field of ['goldAllocated', 'totalTokens', 'coverageRatio']) {
        expect(emits(payload(), field), field).toBe(true);
      }
    });

    it("divulgue l'or prêté", () => {
      // La page publique /reserve, l'attestation signée, le certificat et le
      // relevé de règlement le disent tous. Le portail de l'État — l'audience
      // qui a ALLOUÉ cet or — était le seul à l'ignorer.
      const p = payload();
      expect(emits(p, 'goldOnLoan'), 'goldOnLoan').toBe(true);
      expect(emits(p, 'goldVaulted'), 'goldVaulted').toBe(true);
      expect(emits(p, 'fullyVaulted'), 'fullyVaulted').toBe(true);
    });
  });

  describe('/state/stock', () => {
    const payload = () => payloadOf("state.get('/stock'");

    it('sépare ce qui est alloué de ce qui est réellement en coffre', () => {
      const p = payload();
      expect(emits(p, 'totalAllocated'), 'totalAllocated').toBe(true);
      expect(emits(p, 'goldOnLoan'), 'goldOnLoan').toBe(true);
      expect(emits(p, 'goldVaulted'), 'goldVaulted').toBe(true);
    });

    it("porte l'avertissement sur le prêt, en toutes lettres", () => {
      // Un chiffre sans phrase se lit mal : la couverture dépend du
      // remboursement d'une contrepartie, et cela doit être écrit.
      expect(emits(payload(), 'lendingNotice'), 'lendingNotice').toBe(true);
      expect(SOURCE).toContain("n'est pas physiquement en coffre");
    });

    it("n'annonce pas d'historique de stock", () => {
      // Le client du portail déclarait `stockHistory` : le champ n'a jamais
      // existé dans la réponse, donc le graphique était vide en permanence.
      expect(payload()).not.toContain('stockHistory');
    });
  });

  describe('/state/reports/por', () => {
    const payload = () => payloadOf("state.get('/reports/por'");

    it('émet les champs que l’écran de rapport lit', () => {
      // Le client déclarait totalAllocatedGold, totalTokensIssued, auditStatus
      // et auditor. Aucun n'existait : le rapport de preuve de réserve montrait
      // à un ministère 0 g alloué, 0 g émis et un audit « En attente »
      // permanent.
      for (const f of ['goldAllocated', 'tokensInCirculation', 'certificationStatus']) {
        expect(emits(payload(), f), f).toBe(true);
      }
    });

    it('n’annonce pas d’auditeur nommé', () => {
      // Le champ n'a jamais existé ; c'est le RÉSULTAT du dernier audit qui est
      // envoyé, et c'est lui que l'écran affiche désormais.
      expect(emits(payload(), 'auditor')).toBe(false);
      expect(emits(payload(), 'lastAuditResult'), 'lastAuditResult').toBe(true);
    });
  });

  describe('/state/reports/monthly', () => {
    const payload = () => payloadOf("state.get('/reports/monthly'");

    it('émet les agrégats que l’écran utilise', () => {
      for (const f of ['transactionStats', 'newUsers', 'activeUsers', 'averagePrice']) {
        expect(emits(payload(), f), f).toBe(true);
      }
    });

    it('ne pré-calcule pas de totaux — ils se dérivent', () => {
      // Le client prétendait recevoir totalTransactions / totalVolume /
      // buyVolume / sellVolume / fees : l’écran affichait donc zéro partout.
      for (const f of ['totalTransactions', 'totalVolume', 'buyVolume', 'sellVolume']) {
        expect(emits(payload(), f), f).toBe(false);
      }
    });

    it('compte les détenteurs actifs sans les nommer', () => {
      // COUNT(DISTINCT …) : un agrégat, jamais une liste.
      expect(SOURCE).toContain('COUNT(DISTINCT user_id)');
    });
  });

  it('ne renvoie jamais `coverage` tout court', () => {
    // Le nom exact compte : c'est la confusion coverage / coverageRatio qui a
    // fait afficher 0 % au ministère.
    expect(/\bcoverage:/.test(SOURCE)).toBe(false);
  });
});
