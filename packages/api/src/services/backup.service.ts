/**
 * Sauvegarde de la base — ADR 010.
 *
 * D1 fournit deja Time Travel (restauration a un instant donne sur trente
 * jours). Cet export repond a ce que Time Travel ne couvre pas : la retention
 * au-dela de trente jours, et une copie qui se LIT.
 *
 * Deux principes gouvernent ce fichier :
 *
 *   1. Les secrets ne sont pas sauvegardes. Une copie des empreintes de mots de
 *      passe et des cles de fournisseurs dans un stockage moins garde que la
 *      base serait une sauvegarde qui DIMINUE la securite.
 *
 *   2. Une sauvegarde non verifiee est une affirmation. Chaque fichier ecrit est
 *      relu depuis R2 et son empreinte recalculee ; un ecart est un echec.
 */

import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

/**
 * Tables exclues en entier — session, identifiants, secrets de fournisseurs.
 *
 * Rien ici n'est du registre : ce sont des moyens d'acces. Les restaurer
 * reviendrait a restaurer la capacite d'usurper des comptes a partir d'un
 * fichier stocke ailleurs que la base.
 */
export const TABLES_EXCLUES = new Set([
  'sessions',
  'active_sessions',
  'verification_codes',
  'recovery_codes',
  'two_factor_backup_codes',
  'trusted_devices',
  'password_history',
  'api_keys',
  'config',
  'integrations',
  // Tables techniques SQLite / Cloudflare.
  'sqlite_sequence',
  '_cf_KV',
  'd1_migrations',
]);

/**
 * Colonnes masquees, table par table. La ligne est conservee — c'est le registre
 * — mais la valeur est remplacee par null.
 */
export const COLONNES_MASQUEES: Record<string, string[]> = {
  users: ['password_hash', 'two_factor_secret'],
  admins: ['password_hash', 'two_factor_secret'],
};

export interface TableSauvegardee {
  table: string;
  rows: number;
  /** SHA-256 du contenu NDJSON, en hexadecimal minuscule. */
  sha256: string;
  /** Vrai quand le plafond de lignes a ete atteint : la table est INCOMPLETE. */
  tronquee: boolean;
}

export interface ManifesteSauvegarde {
  version: 1;
  /** Horodatage ISO du debut de l'execution. */
  startedAt: string;
  tables: TableSauvegardee[];
  tablesExclues: string[];
  colonnesMasquees: Record<string, string[]>;
  totalRows: number;
  /** Faux des qu'une table est tronquee ou qu'une relecture ne concorde pas. */
  verified: boolean;
  /** Ce que cette sauvegarde ne couvre PAS, ecrit dans le fichier lui-meme. */
  limites: string[];
}

const LIMITES = [
  "Les secrets ne sont pas inclus : une restauration exige une reinitialisation des mots de passe et un re-enrolement du second facteur.",
  "Cette copie vit dans le meme compte Cloudflare que la base : elle protege de la perte de la base, pas de la perte du compte.",
  "Aucune procedure de restauration automatisee n'est fournie ; le format NDJSON se reimporte par script.",
];

export interface OptionsSauvegarde {
  db: D1Database;
  bucket: R2Bucket;
  /** Prefixe de destination, typiquement `backups/2026-08-17`. */
  prefixe: string;
  startedAt: string;
  maxRowsParTable?: number;
  taillePage?: number;
}

const MAX_ROWS_DEFAUT = 200_000;
const TAILLE_PAGE_DEFAUT = 1_000;

/** SHA-256 hexadecimal d'une chaine UTF-8. */
export async function sha256Hex(contenu: string): Promise<string> {
  const octets = new TextEncoder().encode(contenu);
  const empreinte = await crypto.subtle.digest('SHA-256', octets);
  return [...new Uint8Array(empreinte)].map((o) => o.toString(16).padStart(2, '0')).join('');
}

/** Retire les colonnes sensibles d'une ligne, en gardant la ligne. */
export function masquer(table: string, ligne: Record<string, unknown>): Record<string, unknown> {
  const aMasquer = COLONNES_MASQUEES[table];
  if (!aMasquer) return ligne;

  const copie = { ...ligne };
  for (const colonne of aMasquer) {
    if (colonne in copie) copie[colonne] = null;
  }
  return copie;
}

/**
 * Liste les tables a sauvegarder.
 *
 * Tout ce qui n'est pas explicitement exclu est INCLUS. Une liste blanche
 * laisserait une table ajoutee plus tard hors de la sauvegarde sans que personne
 * s'en apercoive — jusqu'au jour ou l'on en aurait besoin.
 */
export async function listerTables(db: D1Database): Promise<string[]> {
  const resultat = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all<{ name: string }>();

  return (resultat.results ?? [])
    .map((r) => r.name)
    .filter((nom) => !nom.startsWith('sqlite_') && !TABLES_EXCLUES.has(nom));
}

/** Lit une table par pages et la rend en NDJSON, une ligne par enregistrement. */
export async function exporterTable(
  db: D1Database,
  table: string,
  maxRows: number,
  taillePage: number
): Promise<{ ndjson: string; rows: number; tronquee: boolean }> {
  const lignes: string[] = [];
  let offset = 0;

  for (;;) {
    const page = await db
      .prepare(`SELECT * FROM "${table}" LIMIT ? OFFSET ?`)
      .bind(taillePage, offset)
      .all<Record<string, unknown>>();

    const resultats = page.results ?? [];
    for (const ligne of resultats) {
      lignes.push(JSON.stringify(masquer(table, ligne)));
    }
    offset += resultats.length;

    // Plafond atteint : la table est INCOMPLETE. Une sauvegarde tronquee qui se
    // dirait complete serait pire que pas de sauvegarde.
    if (lignes.length >= maxRows) {
      return { ndjson: lignes.join('\n'), rows: lignes.length, tronquee: true };
    }

    // Page incomplete : on a atteint la fin de la table.
    if (resultats.length < taillePage) break;
  }

  return { ndjson: lignes.join('\n'), rows: lignes.length, tronquee: false };
}

/**
 * Ecrit la sauvegarde et la VERIFIE en relisant chaque fichier depuis R2.
 *
 * Le manifeste renvoye porte `verified: false` des qu'une relecture ne concorde
 * pas ou qu'une table a ete tronquee. L'appelant traite ce cas comme un echec.
 */
export async function sauvegarderBase(options: OptionsSauvegarde): Promise<ManifesteSauvegarde> {
  const {
    db,
    bucket,
    prefixe,
    startedAt,
    maxRowsParTable = MAX_ROWS_DEFAUT,
    taillePage = TAILLE_PAGE_DEFAUT,
  } = options;

  const tables = await listerTables(db);
  const sauvegardees: TableSauvegardee[] = [];
  let verified = true;

  for (const table of tables) {
    const { ndjson, rows, tronquee } = await exporterTable(db, table, maxRowsParTable, taillePage);
    const empreinte = await sha256Hex(ndjson);
    const cle = `${prefixe}/${table}.ndjson`;

    await bucket.put(cle, ndjson, {
      httpMetadata: { contentType: 'application/x-ndjson' },
      customMetadata: { sha256: empreinte, rows: String(rows) },
    });

    // Relecture : sans elle, « sauvegarde ecrite » n'est qu'une intention.
    const relu = await bucket.get(cle);
    const empreinteRelue = relu ? await sha256Hex(await relu.text()) : '';
    if (empreinteRelue !== empreinte) verified = false;
    if (tronquee) verified = false;

    sauvegardees.push({ table, rows, sha256: empreinte, tronquee });
  }

  const manifeste: ManifesteSauvegarde = {
    version: 1,
    startedAt,
    tables: sauvegardees,
    tablesExclues: [...TABLES_EXCLUES].sort(),
    colonnesMasquees: COLONNES_MASQUEES,
    totalRows: sauvegardees.reduce((somme, t) => somme + t.rows, 0),
    verified,
    limites: LIMITES,
  };

  await bucket.put(`${prefixe}/manifest.json`, JSON.stringify(manifeste, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });

  return manifeste;
}

/**
 * Supprime les sauvegardes plus anciennes que la retention.
 *
 * Le tri se fait sur le prefixe de date, qui est trie lexicographiquement parce
 * qu'il est au format ISO — pas sur la date de modification de l'objet, qui
 * changerait a la moindre reecriture.
 */
export async function purgerAnciennesSauvegardes(
  bucket: R2Bucket,
  racine: string,
  avantDate: string
): Promise<string[]> {
  const supprimes: string[] = [];
  let curseur: string | undefined;

  do {
    const page = await bucket.list({ prefix: `${racine}/`, cursor: curseur });
    for (const objet of page.objects) {
      const reste = objet.key.slice(racine.length + 1);
      const date = reste.split('/')[0];
      if (date && date < avantDate) {
        await bucket.delete(objet.key);
        supprimes.push(objet.key);
      }
    }
    curseur = page.truncated ? page.cursor : undefined;
  } while (curseur);

  return supprimes;
}
