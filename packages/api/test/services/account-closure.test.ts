import { describe, expect, it } from 'vitest';
import { createTestD1, seedWallet } from '../helpers/real-d1';
import { AccountClosureService } from '../../src/services/account-closure.service';

/**
 * Fermer un compte sans effacer l'histoire — ADR 015, constat AB.
 *
 * `DELETE /users/me` supprimait la ligne `users`. Douze tables la referencent
 * sans `ON DELETE CASCADE` — a commencer par `quotes` — donc la suppression
 * echouait pour tout utilisateur ayant demande un seul devis, et renvoyait
 * INTERNAL_ERROR 500. Aucun test ne couvrait ce chemin.
 *
 * Ces tests tournent sur une VRAIE base : ce sont les contraintes de cles
 * etrangeres qui faisaient echouer la suppression, et un mock ne les a pas.
 */

const MAINTENANT = '2026-08-18T10:00:00.000Z';

function baseAvecTitulaire(id = 'u1') {
  const db = createTestD1();
  db.sqlite.prepare('INSERT INTO users (id, email, phone) VALUES (?, ?, ?)').run(id, 'a@b.c', '+22670000000');
  seedWallet(db, { id: 'w1', userId: id });
  return db;
}

describe('Ce qui empeche la fermeture se dit', () => {
  it('refuse un solde non nul en le chiffrant', async () => {
    const db = baseAvecTitulaire();
    db.sqlite.prepare("UPDATE wallets SET token_balance = 2.5 WHERE id = 'w1'").run();

    const v = await new AccountClosureService(db as never).obstacles('u1');

    expect(v.code).toBe('BALANCE_NOT_ZERO');
    expect(v.details).toMatchObject({ tokenBalance: 2.5 });
  });

  it('refuse une position de location, meme avec un solde a zero', async () => {
    // LE controle qui manquait. Louer retire les grammes du portefeuille : le
    // solde d'un preteur est a zero PARCE QUE son or est prete, et l'ancien
    // garde le laissait donc passer.
    const db = baseAvecTitulaire();
    db.sqlite
      .prepare("INSERT INTO lease_positions (id, user_id, wallet_id, principal_g, annual_rate, status) VALUES ('p1','u1','w1',100,0.06,'ACTIVE')")
      .run();

    const v = await new AccountClosureService(db as never).obstacles('u1');

    expect(v.code).toBe('LEASE_POSITION_OPEN');
    // Le service ne redige plus la phrase (ADR 026) : il fournit les chiffres,
    // la route les met en mots. L'assertion porte donc sur le nombre lui-meme,
    // ce qui la rend plus stricte qu'une recherche de sous-chaine.
    expect(v.details).toMatchObject({ positions: 1, grammesG: 100 });
  });

  it('refuse un lot de consignation en cours', async () => {
    const db = baseAvecTitulaire();
    db.sqlite
      .prepare("INSERT INTO gold_consignments (id, reference, producer_id, weight_declared_g, purity_declared, gold_type, status) VALUES ('c1','REF-1','u1',500,0.995,'nuggets','IN_TRANSIT')")
      .run();

    expect((await new AccountClosureService(db as never).obstacles('u1')).code).toBe('CONSIGNMENT_IN_PROGRESS');
  });

  it('refuse des frais de garde impayes', async () => {
    const db = baseAvecTitulaire();
    db.sqlite
      .prepare("INSERT INTO storage_fee_accruals (id, user_id, accrual_date, stored_g, price_per_gram, annual_rate, amount_xof, status) VALUES ('f1','u1','2026-08-01',10,53000,0.005,7,'OUTSTANDING')")
      .run();

    const v = await new AccountClosureService(db as never).obstacles('u1');

    expect(v.code).toBe('STORAGE_FEES_OUTSTANDING');
    expect(v.details).toMatchObject({ montantXof: 7 });
  });

  it('laisse passer un compte reellement solde', async () => {
    const db = baseAvecTitulaire();

    expect((await new AccountClosureService(db as never).obstacles('u1')).ok).toBe(true);
  });
});

describe('La fermeture conserve le registre', () => {
  it('aboutit meme quand un devis existe', async () => {
    // C'est le defaut d'origine : `quotes` reference `users` sans cascade, donc
    // `DELETE FROM users` echouait et l'utilisateur lisait « erreur interne ».
    const db = baseAvecTitulaire();
    db.sqlite.prepare("INSERT INTO quotes (id, user_id, token_amount) VALUES ('q1','u1',1)").run();

    await db.batch(new AccountClosureService(db as never).fermeture('u1', MAINTENANT));

    const u = db.sqlite.prepare("SELECT closed_at, email FROM users WHERE id = 'u1'").get() as {
      closed_at: string;
      email: string;
    };
    expect(u.closed_at).toBe(MAINTENANT);
    expect(u.email).toBe('closed+u1@invalid');
  });

  it("l'ancienne suppression echouait bel et bien, des qu'un devis existait", () => {
    // Le constat lui-meme, reproduit. Sans ce test, on prouverait seulement que
    // le nouveau chemin marche — pas qu'il remplace quelque chose de casse.
    const db = baseAvecTitulaire();
    db.sqlite.prepare("INSERT INTO quotes (id, user_id, token_amount) VALUES ('q1','u1',1)").run();

    expect(() => db.sqlite.prepare("DELETE FROM users WHERE id = 'u1'").run()).toThrow(
      /FOREIGN KEY constraint failed/
    );
  });

  it('garde les transactions terminees', async () => {
    // Elles alimentent les volumes publies a l'Etat et la reconciliation des
    // periodes passees : les effacer modifierait des rapports deja transmis.
    const db = baseAvecTitulaire();
    db.sqlite
      .prepare("INSERT INTO transactions (id, user_id, wallet_id, type, status, cash_amount) VALUES ('t1','u1','w1','BUY','COMPLETED',50000)")
      .run();

    await db.batch(new AccountClosureService(db as never).fermeture('u1', MAINTENANT));

    const n = db.sqlite.prepare("SELECT COUNT(*) c FROM transactions WHERE user_id = 'u1'").get() as { c: number };
    expect(n.c).toBe(1);
  });

  it('retire les donnees personnelles', async () => {
    const db = baseAvecTitulaire();
    db.sqlite
      .prepare("INSERT INTO kyc_documents (id, user_id, front_image_url, selfie_url) VALUES ('k1','u1','kyc/front.jpg','kyc/selfie.jpg')")
      .run();
    db.sqlite.prepare("INSERT INTO sessions (id, user_id) VALUES ('s1','u1')").run();

    await db.batch(new AccountClosureService(db as never).fermeture('u1', MAINTENANT));

    for (const table of ['kyc_documents', 'sessions']) {
      const n = db.sqlite.prepare(`SELECT COUNT(*) c FROM ${table} WHERE user_id = 'u1'`).get() as { c: number };
      expect(n.c, table).toBe(0);
    }
  });

  it('revoque les jetons deja emis', async () => {
    const db = baseAvecTitulaire();

    await db.batch(new AccountClosureService(db as never).fermeture('u1', MAINTENANT));

    const u = db.sqlite.prepare("SELECT tokens_invalid_before FROM users WHERE id = 'u1'").get() as {
      tokens_invalid_before: string;
    };
    expect(u.tokens_invalid_before).toBe(MAINTENANT);
  });

  it('libere l e-mail pour une reinscription', async () => {
    // L'anonymisation rend l'adresse d'origine disponible : une personne peut
    // revenir, et une connexion sur l'ancienne adresse ne trouve plus rien.
    const db = baseAvecTitulaire();

    await db.batch(new AccountClosureService(db as never).fermeture('u1', MAINTENANT));

    expect(db.sqlite.prepare("SELECT id FROM users WHERE email = 'a@b.c'").get()).toBeUndefined();
  });

  it('trace la fermeture une seule fois', async () => {
    const db = baseAvecTitulaire();
    const service = new AccountClosureService(db as never);

    await db.batch(service.fermeture('u1', MAINTENANT));
    // Rejouer : la garde porte sur la valeur EXACTE posee par le lot, donc le
    // second passage n'ecrit pas une seconde fermeture.
    await db.batch(service.fermeture('u1', '2026-09-01T00:00:00.000Z'));

    const n = db.sqlite
      .prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'ACCOUNT_CLOSED' AND entity_id = 'u1'")
      .get() as { c: number };
    expect(n.c).toBe(1);
  });
});

describe('Les pieces d identite quittent R2 avant leurs lignes', () => {
  it('supprime chaque objet designe', async () => {
    const db = baseAvecTitulaire();
    db.sqlite
      .prepare("INSERT INTO kyc_documents (id, user_id, front_image_url, back_image_url, selfie_url) VALUES ('k1','u1','f.jpg','b.jpg','s.jpg')")
      .run();

    const supprimes: string[] = [];
    const stockage = {
      delete: async (c: string) => {
        supprimes.push(c);
      },
    };

    const v = await new AccountClosureService(db as never, stockage as never).supprimerPieces('u1');

    expect(v.ok).toBe(true);
    expect(supprimes.sort()).toEqual(['b.jpg', 'f.jpg', 's.jpg']);
  });

  it('interrompt la fermeture si le stockage refuse', async () => {
    // Annoncer un compte ferme en laissant les pieces en ligne serait le pire
    // des deux mondes : le titulaire croit ses documents detruits.
    const db = baseAvecTitulaire();
    db.sqlite
      .prepare("INSERT INTO kyc_documents (id, user_id, front_image_url, selfie_url) VALUES ('k1','u1','f.jpg','s.jpg')")
      .run();

    const stockage = {
      delete: async () => {
        throw new Error('R2 indisponible');
      },
    };
    const v = await new AccountClosureService(db as never, stockage as never).supprimerPieces('u1');

    expect(v.ok).toBe(false);
    expect(v.code).toBe('STORAGE_DELETE_FAILED');
  });
});
