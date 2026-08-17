#!/usr/bin/env node
/**
 * Confronte chaque requête SQL du code au schéma que les migrations construisent.
 *
 * POURQUOI CE CONTRÔLE EXISTE
 *
 * Une requête SQL est une chaîne de caractères. Elle traverse le typage
 * TypeScript, les contrats de réponse partagés et les tests d'écran sans que rien
 * ne la confronte à la base. Trois audits successifs — spécification/code,
 * API/clients, clients/API — sont passés à côté pour cette raison : aucun ne
 * regardait la frontière code/base.
 *
 * Ce qu'ils ont fini par trouver : `UPDATE withdrawals SET processed_at = …` sur
 * une table qui n'a pas cette colonne, douze instructions KYC nommant quatre
 * colonnes inexistantes, et un `INSERT INTO refresh_tokens` sur une table qu'aucune
 * migration ne crée. Trois parcours métier arrêtés net, invisibles à la compilation.
 *
 * COMMENT IL TOURNE
 *
 * `pnpm check:sql`, et automatiquement avant `pnpm test` via `pretest`. Il n'est
 * pas écrit sous forme de test vitest : le chargement de ce module dans le
 * transformateur de vitest échoue pour une raison d'outillage non élucidée, et un
 * garde-fou qu'on n'arrive pas à charger ne garde rien. Le lancer en amont de la
 * suite donne la même garantie sans dépendre de cette chaîne.
 *
 * CE QU'IL VÉRIFIE, ET CE QU'IL NE VÉRIFIE PAS
 *
 * Il vérifie l'existence des tables, les colonnes listées par un `INSERT`, les
 * colonnes affectées par un `UPDATE … SET`, et celles projetées par un `SELECT`
 * mono-table. Il ne tente pas d'analyser les jointures, les expressions ni les
 * sous-requêtes : mieux vaut un contrôle étroit et sûr qu'un contrôle large qui
 * crie au loup et finit désactivé.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(RACINE, 'migrations');
const SOURCES = join(RACINE, 'src');

/** Mots-clés SQL et fonctions qui ne sont jamais des noms de colonne. */
const NON_COLONNES = new Set([
  'null', 'true', 'false', 'datetime', 'date', 'now', 'count', 'sum', 'avg', 'min', 'max',
  'coalesce', 'json_extract', 'strftime', 'cast', 'as', 'case', 'when', 'then', 'else', 'end',
  'select', 'from', 'where', 'and', 'or', 'not', 'in', 'is', 'like', 'distinct', 'group', 'by',
  'order', 'limit', 'offset', 'having', 'join', 'on', 'left', 'inner', 'union', 'all', 'abs',
  'round', 'length', 'lower', 'upper', 'ifnull', 'nullif', 'total', 'replace', 'substr',
]);

function fichiers(dossier, extensions) {
  const trouves = [];
  const parcourir = (chemin) => {
    for (const entree of readdirSync(chemin)) {
      const complet = join(chemin, entree);
      if (statSync(complet).isDirectory()) parcourir(complet);
      else if (extensions.some((e) => entree.endsWith(e))) trouves.push(complet);
    }
  };
  parcourir(dossier);
  return trouves;
}

/** Colonnes déclarées dans un corps de `CREATE TABLE`. */
function colonnesDuCorps(corps) {
  const colonnes = new Set();
  let profondeur = 0;
  let ligneCourante = '';
  const lignes = [];

  // Les commentaires partent EN PREMIER, dans leurs DEUX formes.
  //
  // Découper sur les virgules d'abord ferait avaler la colonne suivante par un
  // commentaire de fin de ligne : `old_value TEXT, -- JSON` puis `new_value TEXT`
  // donne un fragment commençant par `-- JSON`, et tout ce qui suit disparaît.
  //
  // Et ignorer les blocs `/** … */` ferait lire leur prose comme des colonnes :
  // « frozen at opening so a config change… » produisait les colonnes `frozen`,
  // `in` et `so`, tout en masquant la vraie colonne qui suivait.
  const sansCommentaires = corps
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((ligne) => ligne.split('--')[0])
    .join('\n');

  // Découpe sur les virgules de premier niveau : `CHECK (x IN ('a','b'))` en
  // contient qui n'introduisent pas de colonne.
  for (const caractere of sansCommentaires) {
    if (caractere === '(') profondeur++;
    if (caractere === ')') profondeur--;
    if (caractere === ',' && profondeur === 0) {
      lignes.push(ligneCourante);
      ligneCourante = '';
    } else {
      ligneCourante += caractere;
    }
  }
  lignes.push(ligneCourante);

  for (const brute of lignes) {
    const ligne = brute.trim();
    if (!ligne) continue;
    if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i.test(ligne)) continue;
    const m = /^["'[]?(\w+)["'\]]?\s+\S/.exec(ligne);
    if (m) colonnes.add(m[1].toLowerCase());
  }
  return colonnes;
}

/**
 * Rejoue les migrations et rend le schéma final.
 *
 * Les instructions sont appliquées DANS L'ORDRE DU FICHIER, pas groupées par
 * type. Le motif SQLite de refonte d'une table — créer `x_new`, copier, supprimer
 * `x`, renommer `x_new` en `x` — donne un résultat opposé si l'on traite les
 * `DROP` après les `RENAME` : la table disparaît au lieu d'être remplacée.
 */
export function construireSchema(dossier = MIGRATIONS) {
  const schema = new Map();

  const CREATION = /CREATE TABLE (?:IF NOT EXISTS )?["'[]?(\w+)["'\]]?\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
  const AJOUT = /ALTER TABLE ["'[]?(\w+)["'\]]?\s+ADD COLUMN\s+["'[]?(\w+)/gi;
  const RENOMMAGE = /ALTER TABLE ["'[]?(\w+)["'\]]?\s+RENAME TO\s+["'[]?(\w+)/gi;
  const SUPPRESSION = /DROP TABLE (?:IF EXISTS )?["'[]?(\w+)/gi;

  for (const fichier of readdirSync(dossier).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dossier, fichier), 'utf8');

    // On collecte toutes les instructions avec leur position, puis on les rejoue
    // dans l'ordre où elles apparaissent.
    const instructions = [];
    for (const r of [CREATION, AJOUT, RENOMMAGE, SUPPRESSION]) {
      r.lastIndex = 0;
      for (const m of sql.matchAll(r)) instructions.push({ position: m.index, motif: r, m });
    }
    instructions.sort((a, b) => a.position - b.position);

    for (const { motif, m } of instructions) {
      if (motif === CREATION) {
        schema.set(m[1].toLowerCase(), colonnesDuCorps(m[2]));
      } else if (motif === AJOUT) {
        const table = m[1].toLowerCase();
        if (!schema.has(table)) schema.set(table, new Set());
        schema.get(table).add(m[2].toLowerCase());
      } else if (motif === RENOMMAGE) {
        const source = m[1].toLowerCase();
        const cible = m[2].toLowerCase();
        if (schema.has(source)) {
          schema.set(cible, schema.get(source));
          schema.delete(source);
        }
      } else {
        schema.delete(m[1].toLowerCase());
      }
    }
  }
  return schema;
}

/** Extrait les requêtes SQL passées à `.prepare(...)`. */
export function requetesDuSource(source) {
  const requetes = [];
  for (const m of source.matchAll(/\.prepare\(\s*([`'"])([\s\S]*?)\1\s*\)/g)) {
    requetes.push(m[2]);
  }
  return requetes;
}

/**
 * Confronte une requête au schéma. Rend la liste des problèmes trouvés.
 * Les requêtes portant une interpolation `${…}` sont ignorées : leur texte final
 * n'est pas connu ici.
 */
export function verifierRequete(sql, schema) {
  const problemes = [];
  if (sql.includes('${')) return problemes;

  const nettoyee = sql.replace(/\s+/g, ' ').trim();

  // Tables internes de SQLite : elles ne figurent dans aucune migration et sont
  // pourtant legitimes (la sauvegarde enumere `sqlite_master` pour n'oublier
  // aucune table).
  if (/(?:^|[^A-Za-z0-9_])sqlite_[a-z_]+/i.test(nettoyee)) return problemes;
  const connait = (table) => schema.has(table.toLowerCase());
  const aColonne = (table, colonne) => schema.get(table.toLowerCase())?.has(colonne.toLowerCase());

  const signaler = (table, colonne, quoi) => problemes.push({ table, colonne, quoi, sql: nettoyee });

  // ── INSERT INTO table (colonnes) ──
  const insertion = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+["'[]?(\w+)["'\]]?\s*\(([^)]*)\)/i.exec(nettoyee);
  if (insertion) {
    const table = insertion[1];
    if (!connait(table)) return [{ table, colonne: null, quoi: 'table inconnue', sql: nettoyee }];
    for (const colonne of insertion[2].split(',').map((c) => c.trim().replace(/["'[\]]/g, ''))) {
      if (colonne && !aColonne(table, colonne)) signaler(table, colonne, 'colonne absente (INSERT)');
    }
    return problemes;
  }

  // ── UPDATE table SET colonne = … ──
  const maj = /UPDATE\s+["'[]?(\w+)["'\]]?\s+SET\s+([\s\S]*?)(?:\sWHERE\s|\sRETURNING\s|$)/i.exec(nettoyee);
  if (maj) {
    const table = maj[1];
    if (!connait(table)) return [{ table, colonne: null, quoi: 'table inconnue', sql: nettoyee }];
    for (const m of maj[2].matchAll(/(?:^|,)\s*["'[]?(\w+)["'\]]?\s*=/g)) {
      if (!aColonne(table, m[1])) signaler(table, m[1], 'colonne absente (UPDATE)');
    }
    return problemes;
  }

  // ── DELETE FROM table ──
  const suppression = /DELETE\s+FROM\s+["'[]?(\w+)/i.exec(nettoyee);
  if (suppression && !connait(suppression[1])) {
    return [{ table: suppression[1], colonne: null, quoi: 'table inconnue', sql: nettoyee }];
  }

  // ── SELECT … FROM table (mono-table, sans jointure ni expression) ──
  const lecture = /SELECT\s+([\s\S]*?)\s+FROM\s+["'[]?(\w+)["'\]]?\s*(.*)$/i.exec(nettoyee);
  if (lecture) {
    const [, projection, table, suite] = lecture;
    if (!connait(table)) return [{ table, colonne: null, quoi: 'table inconnue', sql: nettoyee }];
    // Une jointure ou un alias rend l'attribution des colonnes ambigue.
    if (/\bJOIN\b/i.test(suite) || /^\w+\s/.test(suite) || projection.includes('*')) return problemes;
    for (const brute of projection.split(',')) {
      const champ = brute.trim();
      // Expressions, fonctions et alias : hors perimetre assume.
      if (!/^\w+$/.test(champ)) continue;
      if (NON_COLONNES.has(champ.toLowerCase())) continue;
      if (!aColonne(table, champ)) signaler(table, champ, 'colonne absente (SELECT)');
    }
  }
  return problemes;
}

/** Analyse tout le code applicatif. */
export function verifierLeDepot() {
  const schema = construireSchema();
  const resultats = [];

  for (const fichier of fichiers(SOURCES, ['.ts'])) {
    if (fichier.endsWith('.test.ts')) continue;
    const source = readFileSync(fichier, 'utf8');
    for (const sql of requetesDuSource(source)) {
      for (const probleme of verifierRequete(sql, schema)) {
        resultats.push({ ...probleme, fichier: relative(RACINE, fichier) });
      }
    }
  }
  return { schema, problemes: resultats };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const { schema, problemes } = verifierLeDepot();
  console.log(`Schema reconstitue : ${schema.size} tables.`);

  if (problemes.length > 0) {
    console.error(`\n${problemes.length} requete(s) confrontee(s) a un schema qui ne les porte pas :\n`);
    for (const p of problemes) {
      console.error(`  ✗ ${p.fichier}`);
      console.error(`    ${p.quoi} — ${p.table}${p.colonne ? '.' + p.colonne : ''}`);
      console.error(`    ${p.sql.slice(0, 120)}${p.sql.length > 120 ? '…' : ''}\n`);
    }
    console.error('Une colonne absente est un echec a l execution, pas a la compilation.');
    process.exit(1);
  }
  console.log('Toutes les requetes designent des tables et des colonnes qui existent.');
}
