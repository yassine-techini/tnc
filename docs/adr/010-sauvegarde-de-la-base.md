# ADR 010 — Sauvegarde de la base : un registre vérifié, sans les secrets

- **Statut** : accepté
- **Date** : 2026-08-17
- **Contexte** : écart D relevé à l'audit du 17 août 2026

## Contexte

« Backup automatique D1 activé » figure à la checklist avant déploiement.
`docs/deployment.md` ne documentait qu'un `wrangler d1 export` **manuel**, et
aucun des onze crons n'en faisait. Pour une base qui *est* le registre de
propriété de l'or, une case à cocher non cochée n'est pas une politique de
sauvegarde.

## Décisions

### 1. Dire de quoi la sauvegarde protège — et de quoi elle ne protège pas

D1 fournit déjà **Time Travel** : une restauration à un instant donné sur les
trente derniers jours, sans configuration. Cela couvre la fausse manœuvre et la
migration ratée. Cela ne couvre pas :

- la **rétention au-delà de trente jours**, qu'un registre de propriété doit tenir
  en années ;
- la **perte d'accès au compte Cloudflare** lui-même ;
- l'**inspection** : Time Travel restaure, il ne se lit pas.

L'export quotidien répond à ces trois points, et à eux seuls. Écrire
« sauvegarde activée » sans dire contre quoi serait exactement l'affirmation non
vérifiée que ce projet s'emploie à éliminer.

### 2. Les secrets ne sont PAS sauvegardés

Une sauvegarde complète créerait une copie des empreintes de mots de passe, des
graines TOTP et des clés de fournisseurs (`config`, `integrations.config`) dans
un stockage moins gardé que la base. Une sauvegarde qui **diminue** la sécurité
est un mauvais échange.

L'export porte donc le **registre**, pas les moyens d'usurper une identité :

- tables exclues en entier : `sessions`, `active_sessions`, `verification_codes`,
  `recovery_codes`, `two_factor_backup_codes`, `trusted_devices`,
  `password_history`, `api_keys`, `config`, `integrations` ;
- colonnes masquées : `password_hash`, `two_factor_secret` (sur `users` comme sur
  `admins`).

Conséquence assumée : une restauration exige une réinitialisation des mots de
passe et un ré-enrôlement du second facteur. C'est un coût réel, une fois, dans
un scénario déjà catastrophique. Une fuite de la sauvegarde, elle, ne se répare
pas.

Ce que la sauvegarde permet de prouver reste entier : **qui possédait combien
d'or, quand, et en vertu de quelle opération**.

### 3. Aucune table ne peut être oubliée en silence

Les tables ne sont pas listées à la main. Le travail énumère `sqlite_master` et
sauvegarde **tout ce qui n'est pas explicitement exclu**.

L'inverse — une liste blanche — laisserait une table ajoutée plus tard hors de la
sauvegarde sans que personne s'en aperçoive, jusqu'au jour où l'on en aurait
besoin. Ici, une nouvelle table entre par défaut ; l'en exclure demande une
décision écrite, et le manifeste consigne les deux listes à chaque exécution.

### 4. Une sauvegarde non vérifiée est une affirmation, pas une sauvegarde

Après écriture, chaque fichier est **relu depuis R2** et son empreinte SHA-256
recalculée. Un écart, et l'exécution est un **échec** — pas un succès assorti
d'un avertissement.

Le manifeste conserve, par table, le nombre de lignes et l'empreinte. C'est ce
qui permet de dire « la sauvegarde du 17 août contient 8 421 comptes » plutôt que
« la sauvegarde a tourné ».

### 5. L'absence de sauvegarde récente doit être VISIBLE

C'est le vrai correctif de l'écart D. Un cron qui échoue en silence ramène à la
situation d'avant, en donnant en plus l'illusion contraire.

Le diagnostic de disponibilité (`readiness`) gagne donc une vérification :
**âge de la dernière sauvegarde vérifiée**. Au-delà de 48 h, elle passe au rouge.
La case de la checklist devient une mesure.

## Conséquences

- Cron `0 7 * * *` — après les frais de garde (6 h), donc une fois toutes les
  écritures programmées de la journée passées. Sauvegarder avant les aurait
  capturé un état que la journée modifie encore.
- Écriture NDJSON par table sous `backups/<date>/<table>.ndjson`, plus
  `manifest.json`, dans le seau `LOGS_STORAGE`.
- Rétention configurable (`backup_retention_days`, 90 par défaut), purge à la fin
  de chaque exécution.
- L'état de la dernière exécution est conservé en KV pour le diagnostic.

## Limites, dites plutôt que découvertes

- **Volume.** La lecture se fait par pages et un plafond
  (`backup_max_rows_per_table`, 200 000 par défaut) évite qu'un Worker soit
  interrompu au milieu. Une table qui atteint le plafond est signalée **en
  échec** dans le manifeste : une sauvegarde tronquée qui se dirait complète
  serait pire que pas de sauvegarde.
- **Hors Cloudflare.** Cet export vit dans R2, donc dans le même compte que la
  base. Il protège de la perte de la base, pas de la perte du compte. Une copie
  chez un tiers demande des identifiants qu'on ne peut pas inventer ici : c'est
  une décision d'exploitation, consignée au carnet et non tranchée en passant.
- **Restauration.** Le format NDJSON se réimporte par script ; aucune procédure
  de restauration automatisée n'est fournie, et une restauration jamais répétée
  n'est pas une restauration éprouvée.
