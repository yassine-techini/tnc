import { describe, expect, it } from 'vitest';
import { createTestD1 } from '../helpers/real-d1';
import { ecrituresSuspectes, COLONNES_ECHEANCE } from '../../scripts/check-date-columns.mjs';

/**
 * Les echeances et l'horloge qui les juge — ADR 017, constats AD et AE.
 *
 * Deux formats de date coexistaient : celui de JavaScript
 * (« 2026-08-18T10:08:06.589Z ») et celui de SQLite (« 2026-08-18 10:08:06 »).
 * Les colonnes sont comparees COMME DES CHAINES, et au rang 11 le `T` (0x54)
 * l'emporte sur l'espace (0x20).
 *
 * Ces tests tournent sur une VRAIE base : c'est le moteur qui compare, et c'est
 * lui qui doit le dire.
 */

describe('Le format de la base et celui de JavaScript ne se comparent pas', () => {
  it('montre le defaut : l ISO gagne toujours a date egale', () => {
    const db = createTestD1();
    const maintenant = db.sqlite.prepare("SELECT datetime('now') n").get() as { n: string };
    const isoPasse = new Date(Date.now() - 3600_000).toISOString();

    // Une echeance depassee d'une heure, jugee « encore valide ».
    const r = db.sqlite.prepare('SELECT ? > ? AS encoreValide').get(isoPasse, maintenant.n) as {
      encoreValide: number;
    };

    expect(r.encoreValide, "l'ISO passe pour posterieur a l'heure courante").toBe(1);
  });

  it('disparait quand les deux cotes viennent de la base', () => {
    const db = createTestD1();
    const r = db.sqlite
      .prepare("SELECT datetime('now', '-1 hour') > datetime('now') AS encoreValide")
      .get() as { encoreValide: number };

    expect(r.encoreValide).toBe(0);
  });
});

describe('Un devis expire au bout de son delai', () => {
  function baseAvecDevis(minutes: number) {
    const db = createTestD1();
    db.sqlite.prepare("INSERT INTO users (id, email, phone) VALUES ('u1','a@b.c','+226')").run();
    db.sqlite
      .prepare(
        `INSERT INTO quotes (id, user_id, expires_at)
         VALUES ('q1', 'u1', datetime('now', '+' || ? || ' minutes'))`
      )
      .run(minutes);
    return db;
  }

  const consommer = (db: ReturnType<typeof createTestD1>) =>
    db.sqlite
      .prepare("UPDATE quotes SET status = 'USED' WHERE id = 'q1' AND status = 'PENDING' AND expires_at > datetime('now')")
      .run().changes;

  it('se consomme dans le delai', () => {
    expect(consommer(baseAvecDevis(5))).toBe(1);
  });

  it('ne se consomme plus au-dela', () => {
    // Avant : consommable jusqu'a minuit UTC, soit jusqu'a 24 h de gel du cours
    // au lieu de 5 minutes. C'est le chemin de l'argent.
    expect(consommer(baseAvecDevis(-60))).toBe(0);
  });

  it('ne se consomme pas non plus une heure apres, le meme jour', () => {
    // La formulation exacte du defaut : meme date, donc ancienne comparaison
    // toujours vraie.
    expect(consommer(baseAvecDevis(-1))).toBe(0);
  });
});

describe('Une suspension se leve a son terme', () => {
  function baseAvecSuspension(modificateur: string) {
    const db = createTestD1();
    db.sqlite
      .prepare(
        `INSERT INTO users (id, email, phone, suspended, suspended_until)
         VALUES ('u1','a@b.c','+226', 1, datetime('now', ?))`
      )
      .run(modificateur);
    return db;
  }

  const lever = (db: ReturnType<typeof createTestD1>) =>
    db.sqlite
      .prepare(`UPDATE users SET suspended = 0, suspended_until = NULL
                WHERE suspended = 1 AND suspended_until IS NOT NULL AND suspended_until < datetime('now')`)
      .run().changes;

  it('reste en vigueur avant son terme', () => {
    expect(lever(baseAvecSuspension('+2 hours'))).toBe(0);
  });

  it("refuse une duree invalide plutot que de suspendre indefiniment", () => {
    // `'+' || -1 || ' hours'` donne « +-1 hours », modificateur que SQLite rend
    // NULL — soit une suspension SANS TERME. La route n'accepte donc qu'un
    // nombre fini et strictement positif.
    const db = createTestD1();
    db.sqlite
      .prepare("INSERT INTO users (id, email, phone) VALUES ('u1','a@b.c','+226')")
      .run();
    const r = db.sqlite
      .prepare("SELECT datetime('now', '+' || ? || ' hours') AS echeance")
      .get(-1) as { echeance: string | null };

    expect(r.echeance).toBeNull();
  });

  it('se leve une fois le terme passe', () => {
    // Avant : la suspension survivait jusqu'a minuit UTC. L'erreur allait dans
    // le sens ferme, mais elle prolongeait une sanction sans decision.
    expect(lever(baseAvecSuspension('-1 hours'))).toBe(1);
  });
});

describe('Le garde-fou', () => {
  it('repere une echeance ecrite depuis JavaScript', () => {
    const source = "db.prepare('INSERT INTO quotes (id, expires_at) VALUES (?, ?)').bind(id, new Date().toISOString())";

    expect(ecrituresSuspectes(source, 'x.ts')).toHaveLength(1);
  });

  it('accepte une echeance ecrite par la base', () => {
    const source = "db.prepare(\"INSERT INTO quotes (id, expires_at) VALUES (?, datetime('now', '+5 minutes'))\").bind(id)";

    expect(ecrituresSuspectes(source, 'x.ts')).toEqual([]);
  });

  it('couvre les colonnes reellement comparees a une horloge', () => {
    for (const c of ['expires_at', 'suspended_until', 'locked_until']) {
      expect(COLONNES_ECHEANCE, c).toContain(c);
    }
  });
});

describe('Le calendrier ouvre appartient a un pays', () => {
  it('saute un jour ferie fourni', async () => {
    const { settlementDate } = await import('../../src/lib/business-days');
    // Mardi 18 aout 2026. T+3 sans jours feries : vendredi 21.
    const depart = new Date('2026-08-18T10:00:00Z');

    expect(settlementDate(depart, 3)).toBe('2026-08-21');
    // Le 20 ferie : le reglement glisse au lundi 24 (le 22 et 23 etant un
    // week-end).
    expect(settlementDate(depart, 3, ['2026-08-20'])).toBe('2026-08-24');
  });

  it('ne change rien quand la liste est vide', async () => {
    // Vide par defaut, et c'est delibere : une liste fausse produirait
    // silencieusement de mauvaises dates de reglement (ADR 017 SS 4).
    const { settlementDate } = await import('../../src/lib/business-days');
    const depart = new Date('2026-08-18T10:00:00Z');

    expect(settlementDate(depart, 3, [])).toBe('2026-08-21');
  });
});
