import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTestD1, seedStock } from '../helpers/real-d1';

/**
 * L'ajustement du stock national — ADR 022, constat AO.
 *
 * La route lisait `total_allocated`, calculait en JavaScript, puis ecrivait une
 * valeur ABSOLUE. Rien ne liait l'ecriture a la valeur lue, si bien que deux
 * ajustements simultanes en perdaient un — et la piste d'audit enregistrait les
 * deux, laissant un registre qui affirme ce que le stock ne reflete pas.
 *
 * Ces tests tournent sur une VRAIE base : c'est le moteur qui arbitre, et lui
 * seul peut montrer qu'un increment relatif ne perd rien.
 */

const SQL_AJUSTEMENT = `
  UPDATE gold_stock
     SET total_allocated = ROUND(total_allocated + ?1, 3), updated_at = datetime('now')
   WHERE id = ?2 AND ROUND(total_allocated + ?1, 3) >= tokens_issued`;

function base(alloue: number, emis = 0) {
  const db = createTestD1();
  seedStock(db, { totalAllocated: alloue, tokensIssued: emis });
  return db;
}

const total = (db: ReturnType<typeof createTestD1>) =>
  (db.sqlite.prepare("SELECT total_allocated t FROM gold_stock WHERE id='main'").get() as { t: number }).t;

const ajuster = (db: ReturnType<typeof createTestD1>, montant: number) =>
  db.sqlite.prepare(SQL_AJUSTEMENT).run(montant, 'main').changes;

describe('Deux ajustements ne peuvent plus en perdre un', () => {
  it('accumule les deux montants', () => {
    // Le defaut mesure : +100 puis +50 sur 1000 donnaient 1050, pas 1150.
    const db = base(1000);

    expect(ajuster(db, 100)).toBe(1);
    expect(ajuster(db, 50)).toBe(1);
    expect(total(db)).toBe(1150);
  });

  it("n'ecrit jamais une valeur calculee en dehors de la base", () => {
    // La forme fautive, epinglee : `SET total_allocated = ?` avec une valeur
    // absolue venue d'une lecture anterieure.
    const source = readFileSync(new URL('../../src/routes/admin.ts', import.meta.url), 'utf8');
    const zone = source.slice(source.indexOf("admin.post('/stock/adjust'"));
    const bloc = zone.slice(0, zone.indexOf('\nadmin.'));

    expect(bloc).toContain('ROUND(total_allocated + ?1, 3)');
    expect(bloc).not.toMatch(/SET total_allocated = \?[^1-9]/);
  });
});

describe("La garde remplace le controle fait en JavaScript", () => {
  it('refuse de descendre sous les jetons emis', () => {
    const db = base(1000, 900);

    expect(ajuster(db, -400), 'aucune ligne ne doit changer').toBe(0);
    expect(total(db), 'le stock reste intact').toBe(1000);
  });

  it("accepte de descendre jusqu'aux jetons emis", () => {
    // Borne INCLUSE : allouer exactement ce qui est emis reste coherent, il ne
    // reste simplement plus rien de disponible.
    const db = base(1000, 900);

    expect(ajuster(db, -100)).toBe(1);
    expect(total(db)).toBe(900);
  });

  it('refuse sans lever, pour que l appelant puisse repondre', () => {
    // Un refus par exception aurait donne un INTERNAL_ERROR ; ici l'appelant lit
    // `changes` et repond 409.
    const db = base(1000, 1000);

    expect(() => ajuster(db, -1)).not.toThrow();
    expect(ajuster(db, -1)).toBe(0);
  });
});

describe('La trace dit ce qui a reellement change', () => {
  it("calcule l'ancien et le nouveau total en SQL, pas en JavaScript", () => {
    const db = base(1000);

    // La trace vient EN PREMIER dans le lot : elle voit l'etat anterieur et
    // deduit le nouveau, donc exact meme si un autre ajustement s'intercale.
    db.sqlite
      .prepare(
        `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, old_value, new_value, created_at)
         SELECT 'log-1', 'a1', 'STOCK_ADJUST', 'stock', 'main',
                json_object('totalAllocated', total_allocated),
                json_object('amount', ?1, 'totalAllocated', ROUND(total_allocated + ?1, 3)),
                datetime('now')
           FROM gold_stock WHERE id = 'main'`
      )
      .run(100);
    db.sqlite.prepare(SQL_AJUSTEMENT).run(100, 'main');

    const trace = db.sqlite
      .prepare("SELECT old_value, new_value FROM audit_logs WHERE id = 'log-1'")
      .get() as { old_value: string; new_value: string };

    expect(JSON.parse(trace.old_value).totalAllocated).toBe(1000);
    expect(JSON.parse(trace.new_value).totalAllocated).toBe(1100);
    expect(total(db)).toBe(1100);
  });

  it("n'ecrit aucune trace quand l'ajustement est refuse", () => {
    // Une trace annoncant un ajustement qui n'a pas eu lieu serait pire que pas
    // de trace : la garde est la meme des deux cotes.
    const db = base(1000, 900);

    db.sqlite
      .prepare(
        `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, new_value, created_at)
         SELECT 'log-2', 'a1', 'STOCK_ADJUST', 'stock', 'main', '{}', datetime('now')
           FROM gold_stock WHERE id = 'main' AND ROUND(total_allocated + ?1, 3) >= tokens_issued`
      )
      .run(-400);

    const n = db.sqlite
      .prepare("SELECT COUNT(*) c FROM audit_logs WHERE id = 'log-2'")
      .get() as { c: number };
    expect(n.c).toBe(0);
  });
});
