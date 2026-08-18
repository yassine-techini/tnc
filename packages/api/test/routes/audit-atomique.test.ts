import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTestD1, seedWallet } from '../helpers/real-d1';

/**
 * La trace dans la transaction de son action — ADR 016, constat Z.
 *
 * Huit ecritures sur quinze etaient faites en instruction separee, dont six des
 * sept routes d'administration :
 *
 *   await DB.prepare('UPDATE users SET kyc_status = ? …').run();
 *   await DB.prepare('INSERT INTO audit_logs …').run();
 *
 * Si la seconde echoue — coupure D1, eviction du worker — l'action est faite et
 * personne ne l'a faite. Un utilisateur passe a VERIFIED, son plafond d'achat
 * journalier passe de 100 g a 1000 g, et le registre est muet.
 *
 * Ces tests tiennent la propriete a deux niveaux : la FORME des routes (aucune
 * trace hors lot sur les huit sites), et le COMPORTEMENT de la garde partagee
 * sur une vraie base.
 */

const SOURCES = {
  'admin.ts': readFileSync(new URL('../../src/routes/admin.ts', import.meta.url), 'utf8'),
  'disposition.service.ts': readFileSync(new URL('../../src/services/disposition.service.ts', import.meta.url), 'utf8'),
  'reconciliation.service.ts': readFileSync(new URL('../../src/services/reconciliation.service.ts', import.meta.url), 'utf8'),
};

/** Le corps d'une route, du marqueur jusqu'a la route suivante. */
function corpsDeRoute(marqueur: string): string {
  const src = SOURCES['admin.ts'];
  const debut = src.indexOf(marqueur);
  expect(debut, `route introuvable : ${marqueur}`).toBeGreaterThan(-1);
  const suivante = src.indexOf('\nadmin.', debut + marqueur.length);
  return src.slice(debut, suivante === -1 ? src.length : suivante);
}

describe('Les decisions d administration ecrivent leur trace dans leur lot', () => {
  const routes = [
    ["admin.patch('/users/:id/kyc'", 'décision KYC'],
    ["admin.post('/kyc/:id/review'", 'revue de dossier'],
    ["admin.post('/users/:id/suspend'", 'suspension'],
    ["admin.post('/users/:id/unsuspend'", 'levée de suspension'],
    ["admin.post('/bulk/kyc-approve'", 'approbation en lot'],
    ["admin.patch('/withdrawals/:id'", 'décision de retrait'],
  ] as const;

  for (const [marqueur, nom] of routes) {
    it(`${nom} : la trace est dans un db.batch`, () => {
      const corps = corpsDeRoute(marqueur);

      expect(corps).toContain('INSERT INTO audit_logs');
      expect(corps).toContain('.batch([');
    });

    it(`${nom} : plus aucune trace ecrite par .run()`, () => {
      const corps = corpsDeRoute(marqueur);
      const traceAt = corps.indexOf('INSERT INTO audit_logs');
      // Entre l'INSERT et la fin de son instruction, un `.run()` signerait une
      // ecriture autonome — la forme exacte du defaut.
      const apres = corps.slice(traceAt, traceAt + 900);

      expect(apres).not.toMatch(/\.run\(\)/);
    });
  }
});

describe('Les services aussi', () => {
  for (const fichier of ['disposition.service.ts', 'reconciliation.service.ts'] as const) {
    it(`${fichier} : la trace passe par un lot`, () => {
      const src = SOURCES[fichier];
      const traceAt = src.indexOf('INSERT INTO audit_logs');

      expect(traceAt).toBeGreaterThan(-1);
      expect(src.slice(traceAt, traceAt + 900)).not.toMatch(/\.run\(\)/);
      expect(src).toContain('.batch(');
    });
  }
});

describe('La trace porte la meme condition que son action', () => {
  it("l'approbation en lot ne trace plus un dossier qu'elle n'approuve pas", () => {
    // La mise a jour etait gardee par `kyc_status = 'SUBMITTED'`, la trace non :
    // un dossier deja approuve recevait une trace « approuve en lot » alors que
    // rien n'avait change, et la reponse annoncait « KYC approuve ».
    const corps = corpsDeRoute("admin.post('/bulk/kyc-approve'");
    const gardes = corps.match(/kyc_status = 'SUBMITTED'/g) || [];

    expect(gardes.length).toBeGreaterThanOrEqual(2); // la trace ET la mise a jour
    expect(corps).toContain('changes === 1');
  });

  it('les decisions consignent aussi l etat ANTERIEUR', () => {
    // Une entree `KYC_APPROVE` dit que le dossier est approuve ; sans
    // `old_value` elle ne dit pas s'il etait en attente, deja approuve, ou
    // rejete la veille. `json_object` le capte sans lecture supplementaire.
    for (const marqueur of ["admin.patch('/users/:id/kyc'", "admin.post('/users/:id/suspend'"]) {
      expect(corpsDeRoute(marqueur), marqueur).toContain('json_object(');
    }
  });
});

describe('Le comportement, sur une vraie base', () => {
  it('annule la trace quand la decision est annulee', async () => {
    // La propriete que tout ceci existe pour obtenir : un lot est tout ou rien.
    const db = createTestD1();
    db.sqlite.prepare("INSERT INTO users (id, email, phone) VALUES ('u1','a@b.c','+226')").run();
    seedWallet(db, { id: 'w1', userId: 'u1' });

    await expect(
      db.batch([
        db.prepare(`
          INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at)
          SELECT ?, 'a1', 'KYC_APPROVE', 'user', id, '{}', datetime('now') FROM users WHERE id = ?
        `).bind('log-1', 'u1'),
        // Echoue : la contrainte CHECK refuse ce niveau.
        db.prepare("UPDATE users SET kyc_level = 'INEXISTANT' WHERE id = ?").bind('u1'),
      ])
    ).rejects.toThrow();

    const n = db.sqlite.prepare("SELECT COUNT(*) c FROM audit_logs WHERE id = 'log-1'").get() as { c: number };
    expect(n.c, 'la trace ne doit pas survivre a une decision annulee').toBe(0);
  });

  it("n'ecrit pas de trace quand l'action ne change rien", async () => {
    // La garde `WHERE id = ?` de la trace : sur une entite absente, le lot
    // n'ecrit rien plutot qu'une trace annoncant une decision fantome.
    const db = createTestD1();

    await db.batch([
      db.prepare(`
        INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at)
        SELECT ?, 'a1', 'KYC_APPROVE', 'user', id, '{}', datetime('now') FROM users WHERE id = ?
      `).bind('log-2', 'inconnu'),
      db.prepare("UPDATE users SET kyc_level = 'VERIFIED' WHERE id = ?").bind('inconnu'),
    ]);

    const n = db.sqlite.prepare("SELECT COUNT(*) c FROM audit_logs WHERE id = 'log-2'").get() as { c: number };
    expect(n.c).toBe(0);
  });
});
