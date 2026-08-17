import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { describe, expect, it, vi } from 'vitest';
import {
  COLONNES_MASQUEES,
  TABLES_EXCLUES,
  exporterTable,
  listerTables,
  masquer,
  purgerAnciennesSauvegardes,
  sauvegarderBase,
  sha256Hex,
} from './backup.service';

/**
 * La sauvegarde de la base (ADR 010).
 *
 * Deux choses doivent etre prouvees ici, parce qu'elles ne se voient pas a la
 * lecture : qu'aucun secret ne sort, et qu'une sauvegarde qui n'a pas ete relue
 * n'est jamais annoncee comme reussie.
 */

/** D1 simule : des tables nommees, chacune avec ses lignes. */
function faireDb(tables: Record<string, Record<string, unknown>[]>): D1Database {
  return {
    prepare(sql: string) {
      return {
        all: async <T>() => {
          if (sql.includes('sqlite_master')) {
            return { results: Object.keys(tables).map((name) => ({ name })) as T[] };
          }
          return { results: [] as T[] };
        },
        bind(limit: number, offset: number) {
          const nom = /FROM "([^"]+)"/.exec(sql)?.[1] ?? '';
          return {
            all: async <T>() => ({ results: (tables[nom] ?? []).slice(offset, offset + limit) as T[] }),
          };
        },
      };
    },
  } as unknown as D1Database;
}

/** R2 simule, avec un stockage inspectable. */
function faireBucket(options: { corrompreALaRelecture?: boolean } = {}) {
  const contenu = new Map<string, string>();
  const bucket = {
    async put(key: string, value: string) {
      contenu.set(key, value);
    },
    async get(key: string) {
      if (!contenu.has(key)) return null;
      const texte = options.corrompreALaRelecture ? 'autre chose' : (contenu.get(key) as string);
      return { text: async () => texte };
    },
    async delete(key: string) {
      contenu.delete(key);
    },
    async list({ prefix, cursor }: { prefix: string; cursor?: string }) {
      void cursor;
      return {
        objects: [...contenu.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((key) => ({ key })),
        truncated: false as const,
        cursor: undefined as string | undefined,
      };
    },
  };
  return { bucket: bucket as unknown as R2Bucket, contenu };
}

const UTILISATEUR = {
  id: 'usr_1',
  email: 'client@example.bf',
  password_hash: '$argon2id$v=19$m=65536,t=3,p=4$SECRET',
  two_factor_secret: 'JBSWY3DPEHPK3PXP',
  kyc_level: 'VERIFIED',
};

describe('Ce qui sort de la base', () => {
  it('masque les colonnes de secret en gardant la ligne', () => {
    const masquee = masquer('users', UTILISATEUR);

    // La ligne reste : c'est le registre. Ce qui permet d'usurper le compte
    // disparait.
    expect(masquee.id).toBe('usr_1');
    expect(masquee.email).toBe('client@example.bf');
    expect(masquee.kyc_level).toBe('VERIFIED');
    expect(masquee.password_hash).toBeNull();
    expect(masquee.two_factor_secret).toBeNull();
  });

  it('ne touche pas aux tables sans colonne sensible', () => {
    const ligne = { id: 'txn_1', cash_amount: 50_000 };

    expect(masquer('transactions', ligne)).toEqual(ligne);
  });

  it('masque aussi les administrateurs', () => {
    // Un compte d'administration vaut plus qu'un compte client, pas moins.
    expect(COLONNES_MASQUEES.admins).toContain('password_hash');
    expect(COLONNES_MASQUEES.admins).toContain('two_factor_secret');
  });

  it('exclut les tables de session et de secrets', () => {
    for (const table of [
      'sessions',
      'verification_codes',
      'recovery_codes',
      'two_factor_backup_codes',
      'api_keys',
      'config',
      'integrations',
    ]) {
      expect(TABLES_EXCLUES.has(table)).toBe(true);
    }
  });

  it("n'exclut aucune table du registre", () => {
    // Si l'une d'elles venait a etre exclue, la sauvegarde cesserait de prouver
    // qui possede quoi — sans que rien d'autre ne le signale.
    for (const table of ['users', 'wallets', 'transactions', 'gold_stock', 'certificates']) {
      expect(TABLES_EXCLUES.has(table)).toBe(false);
    }
  });
});

describe('Choix des tables', () => {
  it('inclut par defaut toute table non exclue', async () => {
    const db = faireDb({ users: [], transactions: [], sessions: [], nouvelle_table: [] });

    const tables = await listerTables(db);

    // Une liste blanche aurait laisse `nouvelle_table` dehors en silence.
    // L'oubli doit etre impossible ; l'exclusion, deliberee.
    expect(tables).toContain('nouvelle_table');
    expect(tables).not.toContain('sessions');
  });

  it('ignore les tables internes de SQLite', async () => {
    const db = faireDb({ users: [], sqlite_sequence: [] });

    expect(await listerTables(db)).toEqual(['users']);
  });
});

describe('Export d une table', () => {
  it('rend une ligne JSON par enregistrement', async () => {
    const db = faireDb({ wallets: [{ id: 'w1' }, { id: 'w2' }] });

    const { ndjson, rows, tronquee } = await exporterTable(db, 'wallets', 1000, 500);

    expect(rows).toBe(2);
    expect(tronquee).toBe(false);
    expect(ndjson.split('\n').map((l) => JSON.parse(l))).toEqual([{ id: 'w1' }, { id: 'w2' }]);
  });

  it('pagine au-dela d une page', async () => {
    const lignes = Array.from({ length: 25 }, (_, i) => ({ id: `t${i}` }));
    const db = faireDb({ transactions: lignes });

    const { rows } = await exporterTable(db, 'transactions', 1000, 10);

    expect(rows).toBe(25);
  });

  it('signale une table tronquee au lieu de la dire complete', async () => {
    const lignes = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}` }));
    const db = faireDb({ transactions: lignes });

    const { rows, tronquee } = await exporterTable(db, 'transactions', 10, 5);

    // Une sauvegarde tronquee qui se dirait complete serait pire que pas de
    // sauvegarde : on croirait avoir une copie.
    expect(tronquee).toBe(true);
    expect(rows).toBeGreaterThanOrEqual(10);
  });
});

describe('Sauvegarde complete', () => {
  const db = () => faireDb({ users: [UTILISATEUR], wallets: [{ id: 'w1', token_balance: 12.5 }] });

  it('ecrit un fichier par table plus un manifeste', async () => {
    const { bucket, contenu } = faireBucket();

    await sauvegarderBase({
      db: db(),
      bucket,
      prefixe: 'backups/2026-08-17',
      startedAt: '2026-08-17T07:00:00.000Z',
    });

    expect([...contenu.keys()].sort()).toEqual([
      'backups/2026-08-17/manifest.json',
      'backups/2026-08-17/users.ndjson',
      'backups/2026-08-17/wallets.ndjson',
    ]);
  });

  it("n'ecrit aucun secret sur le disque", async () => {
    const { bucket, contenu } = faireBucket();

    await sauvegarderBase({
      db: db(),
      bucket,
      prefixe: 'backups/2026-08-17',
      startedAt: '2026-08-17T07:00:00.000Z',
    });

    // Le test le plus important du fichier : une sauvegarde qui recopie les
    // empreintes et les graines TOTP dans un stockage moins garde que la base
    // DIMINUE la securite.
    const tout = [...contenu.values()].join('\n');
    expect(tout).not.toContain('$argon2id$');
    expect(tout).not.toContain('JBSWY3DPEHPK3PXP');
    expect(tout).toContain('client@example.bf');
  });

  it('consigne le compte de lignes et l empreinte par table', async () => {
    const { bucket, contenu } = faireBucket();

    const manifeste = await sauvegarderBase({
      db: db(),
      bucket,
      prefixe: 'backups/2026-08-17',
      startedAt: '2026-08-17T07:00:00.000Z',
    });

    const users = manifeste.tables.find((t) => t.table === 'users');
    const attendue = await sha256Hex(contenu.get('backups/2026-08-17/users.ndjson') as string);

    expect(users?.rows).toBe(1);
    expect(users?.sha256).toBe(attendue);
    expect(manifeste.totalRows).toBe(2);
  });

  it('ecrit ses propres limites dans le manifeste', async () => {
    const { bucket } = faireBucket();

    const manifeste = await sauvegarderBase({
      db: db(),
      bucket,
      prefixe: 'backups/2026-08-17',
      startedAt: '2026-08-17T07:00:00.000Z',
    });

    // Quiconque ouvre ce fichier dans deux ans doit y lire ce qu'il ne contient
    // pas, sans avoir a retrouver l'ADR.
    expect(manifeste.limites.join(' ')).toContain('secrets');
    expect(manifeste.tablesExclues).toContain('sessions');
  });
});

describe('Verification apres ecriture', () => {
  it('declare la sauvegarde verifiee quand la relecture concorde', async () => {
    const { bucket } = faireBucket();

    const manifeste = await sauvegarderBase({
      db: faireDb({ users: [UTILISATEUR] }),
      bucket,
      prefixe: 'backups/2026-08-17',
      startedAt: '2026-08-17T07:00:00.000Z',
    });

    expect(manifeste.verified).toBe(true);
  });

  it('refuse de la declarer verifiee quand la relecture differe', async () => {
    const { bucket } = faireBucket({ corrompreALaRelecture: true });

    const manifeste = await sauvegarderBase({
      db: faireDb({ users: [UTILISATEUR] }),
      bucket,
      prefixe: 'backups/2026-08-17',
      startedAt: '2026-08-17T07:00:00.000Z',
    });

    // Ecrire sans relire, c'est affirmer. La sauvegarde de secours qu'on
    // decouvre illisible le jour du sinistre est le scenario a exclure.
    expect(manifeste.verified).toBe(false);
  });

  it('refuse de la declarer verifiee quand une table est tronquee', async () => {
    const { bucket } = faireBucket();
    const lignes = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}` }));

    const manifeste = await sauvegarderBase({
      db: faireDb({ transactions: lignes }),
      bucket,
      prefixe: 'backups/2026-08-17',
      startedAt: '2026-08-17T07:00:00.000Z',
      maxRowsParTable: 10,
      taillePage: 5,
    });

    expect(manifeste.verified).toBe(false);
    expect(manifeste.tables[0].tronquee).toBe(true);
  });
});

describe('Purge de la retention', () => {
  it('supprime ce qui precede la date limite et garde le reste', async () => {
    const { bucket, contenu } = faireBucket();
    contenu.set('backups/2026-05-01/users.ndjson', 'vieux');
    contenu.set('backups/2026-08-16/users.ndjson', 'hier');
    contenu.set('backups/2026-08-17/users.ndjson', 'aujourd hui');

    const supprimes = await purgerAnciennesSauvegardes(bucket, 'backups', '2026-08-16');

    expect(supprimes).toEqual(['backups/2026-05-01/users.ndjson']);
    expect([...contenu.keys()]).toHaveLength(2);
  });

  it('ne supprime rien quand tout est dans la retention', async () => {
    const { bucket, contenu } = faireBucket();
    contenu.set('backups/2026-08-17/users.ndjson', 'aujourd hui');

    expect(await purgerAnciennesSauvegardes(bucket, 'backups', '2026-05-01')).toEqual([]);
  });
});

describe('sha256Hex', () => {
  it('produit une empreinte hexadecimale de 64 caracteres', async () => {
    const empreinte = await sha256Hex('registre');

    expect(empreinte).toMatch(/^[0-9a-f]{64}$/);
  });

  it('change des qu un octet change', async () => {
    expect(await sha256Hex('registre')).not.toBe(await sha256Hex('registrf'));
  });
});
