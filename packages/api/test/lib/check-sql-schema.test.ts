import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  construireSchema,
  requetesDuSource,
  verifierRequete,
  verifierLeDepot,
} from '../../scripts/check-sql-schema.mjs';

/**
 * Le garde-fou schema/code.
 *
 * Il s'est trompe trois fois pendant sa construction : il rejouait les migrations
 * groupees par type d'instruction (le DROP effacait ce que le RENAME venait de
 * poser), il decoupait sur les virgules avant de retirer les commentaires de fin
 * de ligne (la colonne suivante disparaissait avec eux), et il ignorait les
 * commentaires de bloc, dont la prose etait lue comme des colonnes.
 *
 * Un controle faux est pire qu'aucun : il rassure. D'ou ces tests.
 */

/** Ecrit des migrations jetables et rend le schema qu'elles produisent. */
function schemaDe(...fichiers: string[]) {
  const dossier = mkdtempSync(join(tmpdir(), 'migrations-'));
  fichiers.forEach((contenu, i) => {
    writeFileSync(join(dossier, `${String(i).padStart(4, '0')}_test.sql`), contenu, 'utf8');
  });
  return construireSchema(dossier);
}

describe('Reconstitution du schema', () => {
  it('lit les colonnes d une table simple', () => {
    const s = schemaDe('CREATE TABLE wallets (\n  id TEXT PRIMARY KEY,\n  token_balance REAL NOT NULL\n);');

    expect([...s.get('wallets')]).toEqual(['id', 'token_balance']);
  });

  it('ne prend pas les contraintes pour des colonnes', () => {
    const s = schemaDe(
      'CREATE TABLE stock (\n  id TEXT PRIMARY KEY,\n  total REAL NOT NULL,\n  CHECK (total >= 0),\n  FOREIGN KEY (id) REFERENCES autre(id)\n);'
    );

    expect([...s.get('stock')]).toEqual(['id', 'total']);
  });

  it('garde la colonne qui suit un commentaire de fin de ligne', () => {
    // `old_value TEXT, -- JSON` faisait disparaitre `new_value` : le decoupage
    // sur les virgules laissait un fragment commencant par le commentaire.
    const s = schemaDe(
      'CREATE TABLE audit_logs (\n  id TEXT PRIMARY KEY,\n  old_value TEXT, -- JSON\n  new_value TEXT,\n  ip_address TEXT\n);'
    );

    expect([...s.get('audit_logs')]).toEqual(['id', 'old_value', 'new_value', 'ip_address']);
  });

  it('ignore la prose des commentaires de bloc', () => {
    // « frozen at opening so a config change... » produisait les colonnes
    // `frozen`, `in` et `so`, et masquait la vraie colonne suivante.
    const s = schemaDe(
      'CREATE TABLE lease_positions (\n  id TEXT PRIMARY KEY,\n  /** Annual rate frozen at opening so a config change is not retroactive. */\n  annual_rate REAL NOT NULL\n);'
    );

    expect([...s.get('lease_positions')]).toEqual(['id', 'annual_rate']);
  });

  it('applique ADD COLUMN', () => {
    const s = schemaDe(
      'CREATE TABLE t (\n  id TEXT\n);',
      'ALTER TABLE t ADD COLUMN external_reference TEXT;'
    );

    expect(s.get('t').has('external_reference')).toBe(true);
  });

  it('suit le motif SQLite creer / copier / supprimer / renommer', () => {
    // Traiter les DROP apres les RENAME faisait disparaitre la table refondue.
    const s = schemaDe(
      'CREATE TABLE admins (\n  id TEXT\n);\nCREATE TABLE admins_new (\n  id TEXT,\n  role TEXT\n);\nDROP TABLE admins;\nALTER TABLE admins_new RENAME TO admins;'
    );

    expect(s.has('admins')).toBe(true);
    expect(s.get('admins').has('role')).toBe(true);
    expect(s.has('admins_new')).toBe(false);
  });
});

describe('Extraction des requetes', () => {
  it('recupere les trois formes de delimiteur', () => {
    const source = [
      "db.prepare('SELECT a FROM t');",
      'db.prepare("UPDATE t SET a = ?");',
      'db.prepare(`DELETE FROM t`);',
    ].join('\n');

    expect(requetesDuSource(source)).toHaveLength(3);
  });
});

describe('Confrontation au schema', () => {
  const schema = schemaDe(
    'CREATE TABLE withdrawals (\n  id TEXT PRIMARY KEY,\n  status TEXT,\n  failure_reason TEXT,\n  completed_at TEXT\n);'
  );

  it('accepte une requete dont toutes les colonnes existent', () => {
    expect(
      verifierRequete("UPDATE withdrawals SET status = ?, completed_at = datetime('now') WHERE id = ?", schema)
    ).toEqual([]);
  });

  it('refuse une colonne absente dans un UPDATE', () => {
    // Le defaut reel : `processed_at` n'existe pas sur `withdrawals`.
    const p = verifierRequete("UPDATE withdrawals SET processed_at = datetime('now') WHERE id = ?", schema);

    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ table: 'withdrawals', colonne: 'processed_at' });
  });

  it('refuse une colonne absente dans un INSERT', () => {
    const p = verifierRequete('INSERT INTO withdrawals (id, rejection_reason) VALUES (?, ?)', schema);

    expect(p[0]).toMatchObject({ colonne: 'rejection_reason' });
  });

  it('refuse une table inconnue', () => {
    // Le defaut reel : `refresh_tokens` n'est creee par aucune migration.
    const p = verifierRequete('DELETE FROM refresh_tokens WHERE user_id = ?', schema);

    expect(p[0]).toMatchObject({ table: 'refresh_tokens', quoi: 'table inconnue' });
  });

  it('laisse passer les tables internes de SQLite', () => {
    // `sqlite_master` ne figure dans aucune migration et son interrogation est
    // legitime : la sauvegarde l'enumere pour n'oublier aucune table.
    expect(verifierRequete("SELECT name FROM sqlite_master WHERE type = 'table'", schema)).toEqual([]);
  });

  it('ignore une requete construite par interpolation', () => {
    // Son texte final n'est pas connu ici ; pretendre le verifier serait faux.
    expect(verifierRequete('SELECT * FROM "${table}" LIMIT ?', schema)).toEqual([]);
  });

  it('ne se prononce pas sur une jointure', () => {
    // Perimetre assume : attribuer une colonne a l'une des tables d'une jointure
    // demanderait un vrai analyseur. Mieux vaut se taire que crier au loup.
    expect(
      verifierRequete('SELECT t.id, u.email FROM withdrawals t LEFT JOIN users u ON t.id = u.id', schema)
    ).toEqual([]);
  });
});

describe('Le depot reel', () => {
  const { schema, problemes } = verifierLeDepot();

  it('ne contient aucune requete visant une colonne ou une table absente', () => {
    expect(problemes).toEqual([]);
  });

  it('reconstitue un schema non vide', () => {
    // Sans ce controle, un parseur casse rendrait zero table et le test
    // precedent passerait au vert sans rien avoir verifie.
    expect(schema.size).toBeGreaterThan(30);
  });
});
