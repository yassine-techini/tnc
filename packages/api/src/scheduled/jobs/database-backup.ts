/**
 * Sauvegarde quotidienne de la base — ADR 010.
 *
 * Tourne a 7 h UTC, apres les frais de garde (6 h) : toutes les ecritures
 * programmees de la journee sont passees, donc l'etat capture ne bouge plus.
 *
 * L'etat de la derniere execution est conserve en KV pour que le diagnostic de
 * disponibilite puisse le lire. Un cron qui echoue en silence ramene a la
 * situation d'avant, en donnant en plus l'illusion contraire.
 */

import type { Env } from '../../types/env';
import { ConfigService } from '../../services/config.service';
import {
  purgerAnciennesSauvegardes,
  sauvegarderBase,
  type ManifesteSauvegarde,
} from '../../services/backup.service';

export const RACINE_SAUVEGARDES = 'backups';
export const CLE_ETAT_SAUVEGARDE = 'backup:last';

export interface EtatSauvegarde {
  /** Horodatage ISO de la fin d'execution. */
  finishedAt: string;
  ok: boolean;
  prefixe: string;
  totalRows: number;
  tables: number;
  /** Tables tronquees, donc incompletes. */
  tronquees: string[];
  erreur?: string;
}

/** `2026-08-17` — trie lexicographiquement, ce dont la purge depend. */
function jour(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function backupDatabase(env: Env, _ctx: ExecutionContext): Promise<void> {
  const debut = new Date();
  console.log(`[Backup] Demarrage de la sauvegarde ${jour(debut)}`);

  const configService = new ConfigService(env.DB, env.CACHE);
  const enregistrerEtat = async (etat: EtatSauvegarde) => {
    // Sans TTL : un etat qui expire ferait disparaitre la preuve qu'aucune
    // sauvegarde recente n'a eu lieu, ce qui est precisement l'information utile.
    await env.CACHE.put(CLE_ETAT_SAUVEGARDE, JSON.stringify(etat));
  };

  try {
    const [retentionJours, maxRows] = await Promise.all([
      configService.getNumber('backup_retention_days', 90),
      configService.getNumber('backup_max_rows_per_table', 200_000),
    ]);

    const prefixe = `${RACINE_SAUVEGARDES}/${jour(debut)}`;
    const manifeste: ManifesteSauvegarde = await sauvegarderBase({
      db: env.DB,
      bucket: env.LOGS_STORAGE,
      prefixe,
      startedAt: debut.toISOString(),
      maxRowsParTable: maxRows,
    });

    const tronquees = manifeste.tables.filter((t) => t.tronquee).map((t) => t.table);

    if (!manifeste.verified) {
      // Echec ferme : une relecture qui ne concorde pas, ou une table tronquee,
      // ne donnent pas une sauvegarde « presque bonne ».
      const raison = tronquees.length
        ? `tables tronquees : ${tronquees.join(', ')}`
        : 'la relecture depuis R2 ne concorde pas avec ce qui a ete ecrit';
      console.error(`[Backup] ECHEC — ${raison}`);
      await enregistrerEtat({
        finishedAt: new Date().toISOString(),
        ok: false,
        prefixe,
        totalRows: manifeste.totalRows,
        tables: manifeste.tables.length,
        tronquees,
        erreur: raison,
      });
      return;
    }

    // La purge ne s'execute qu'apres une sauvegarde VERIFIEE : supprimer les
    // anciennes au vu d'une nouvelle qu'on n'a pas validee reviendrait a se
    // retrouver sans aucune copie utilisable.
    const limite = new Date(debut.getTime() - retentionJours * 86_400_000);
    const supprimes = await purgerAnciennesSauvegardes(
      env.LOGS_STORAGE,
      RACINE_SAUVEGARDES,
      jour(limite)
    );

    console.log(
      `[Backup] ${manifeste.tables.length} tables, ${manifeste.totalRows} lignes, ` +
        `${supprimes.length} objets purges au-dela de ${retentionJours} jours`
    );

    await enregistrerEtat({
      finishedAt: new Date().toISOString(),
      ok: true,
      prefixe,
      totalRows: manifeste.totalRows,
      tables: manifeste.tables.length,
      tronquees: [],
    });
  } catch (erreur) {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    console.error('[Backup] ECHEC —', message);
    await enregistrerEtat({
      finishedAt: new Date().toISOString(),
      ok: false,
      prefixe: `${RACINE_SAUVEGARDES}/${jour(debut)}`,
      totalRows: 0,
      tables: 0,
      tronquees: [],
      erreur: message,
    });
  }
}
