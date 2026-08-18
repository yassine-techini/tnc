# Ce qui reste à implémenter — 17 août 2026

Ce document recense les **manques fonctionnels**, pas les bugs. Il est réécrit après les
phases 0 à 5 : la version précédente datait d'avant et aurait envoyé quelqu'un refaire du
travail déjà livré, ce qui est le principal danger d'un backlog qu'on ne tient pas.

## État par application

| Application | Surface | Verdict |
|---|---|---|
| `packages/api` | 13 modules de routes, 616 tests | Le plus mature |
| `apps/admin` | 19 écrans, 53 tests | Complet |
| `apps/web` | 14 pages + auth + vitrine, 47 tests | Complet |
| `apps/mobile` | 4 onglets + producteur + location + répartition, 61 tests | Complet ; parcours bout-en-bout écrits, jamais exécutés |
| `apps/state-portal` | 5 écrans, 33 tests | Complet |

---

## Écarts relevés à l'audit du 17 août 2026 — les quatre traités ✅

Audit de la spécification (`CLAUDE.md`) contre le code. **Ce qui allait bien** :
les 38 endpoints promis existent tous (219 handlers), les 15 codes d'erreur métier
sont implémentés, les 11 crons déclarés sont tous traités, les intégrations externes
sont réelles et échouent fermé quand la clé manque, et il n'y a **aucun TODO, FIXME
ni amorce abandonnée** dans le code applicatif.

Les quatre écarts relevés sont corrigés. Ce qui subsiste, en D, est une
décision d'exploitation, pas du code manquant.

### A. Aucun 2FA sur les transactions ✅

Corrigé — [ADR 009](./adr/009-second-facteur-sur-les-transactions.md).

Le plus notable : **tout existait déjà** (`HIGH_VALUE_THRESHOLD_XOF`, la clé de
configuration `high_value_threshold_xof`, `isHighValueTransaction()`,
`verifyTotpCode()` avec garde anti-rejeu). `isHighValueTransaction()` n'était
appelée par personne : le garde-fou avait été construit puis jamais branché.

Le seuil (1 000 000 XOF par défaut, ajustable en base) s'applique désormais à
`POST /market/buy`, `/market/sell` et `/wallet/withdraw`. Un compte sans facteur
enrôlé est **refusé**, pas dispensé. La vérification a lieu **avant** la
consommation du devis, pour qu'un code mal saisi ne coûte pas un nouveau prix. Les
quatre clients demandent le code en ligne.

### B. Les préférences de notification mobiles ne remontaient jamais ✅

Corrigé. L'écran mobile écrivait dans `SecureStore` et n'appelait jamais l'API :
couper « alertes de prix » ne changeait rien, le serveur n'en savait rien. Il lit
et écrit maintenant `/users/me/preferences/notifications`, comme le web.

Les bascules « Actualités » et « Sécurité » ont disparu : **aucune colonne ne leur
correspondait côté serveur**. Elles ne faisaient rien, et les garder aurait conservé
le mensonge plutôt que de le corriger.

### C. La boîte de réception n'était affichée nulle part ✅

Corrigé. `GET /users/me/notifications`, `PATCH …/:id/read` et `POST …/read-all`
existaient et n'étaient lus par **aucun** client. L'écran mobile prévu par
`CLAUDE.md` existe désormais (`app/(inbox)`), avec une cloche et un compteur de
non-lues sur l'accueil. La réponse est sous contrat partagé (`NotificationsData`).

La boîte de réception **web** est faite aussi (`/notifications`, cloche et compteur
dans l'en-tête, 13 tests d'écran).

Trouvé en la faisant : `formatRelativeTime` de `packages/shared` lisait
`datetime('now')` de SQLite — de l'UTC **sans marqueur de fuseau** — comme une
heure locale. Le même piège avait déjà faussé l'âge du prix de l'or. Corrigé à la
racine (`parseApiDate`, appliqué aux 11 fonctions du module) plutôt que dans
chaque écran.

**Reste** : `apps/web/src/lib/formatters.ts` porte encore sa propre copie privée de
`formatRelativeTime`, avec le même défaut de fuseau. Elle sert ailleurs dans
l'application web ; la remplacer par la fonction partagée est un nettoyage à part.

### D. La sauvegarde de la base ✅

Corrigé — [ADR 010](./adr/010-sauvegarde-de-la-base.md).

Le vrai correctif n'est pas le cron, c'est la **visibilité**. Un cron qui échoue en
silence ramène à l'absence de sauvegarde en donnant en plus l'illusion contraire.
Le diagnostic porte donc une vérification `database_backup` qui passe au rouge
au-delà de 48 h sans sauvegarde vérifiée : la case de la checklist est devenue une
mesure.

Trois points de conception, décidés plutôt que subis :

- **Les secrets ne sont pas sauvegardés.** Empreintes de mots de passe, graines
  TOTP, clés de fournisseurs (`config`, `integrations`) sont exclus. Une copie de
  tout ça dans un stockage moins gardé que la base serait une sauvegarde qui
  *diminue* la sécurité. Coût assumé : une restauration exige une réinitialisation
  des mots de passe.
- **Aucune table ne peut être oubliée.** Le travail énumère `sqlite_master` et
  sauvegarde tout ce qui n'est pas explicitement exclu. Une liste blanche aurait
  laissé une table ajoutée plus tard hors de la sauvegarde, en silence.
- **Une sauvegarde non relue est une affirmation.** Chaque fichier est relu depuis
  R2 et son empreinte recalculée ; un écart ou une table tronquée font échouer
  l'exécution, et la purge de rétention ne s'exécute qu'après une sauvegarde
  vérifiée.

**Reste ouvert — décision d'exploitation** : cet export vit dans le **même compte
Cloudflare** que la base. Il protège de la perte de la base, pas de la perte du
compte. Une copie chez un tiers demande des identifiants qu'on ne peut pas
inventer ici.

Et : **une restauration jamais répétée n'est pas une restauration éprouvée.** Le
format NDJSON se réimporte par script, mais l'exercice reste à faire.

---

## Second audit — 17 août 2026, angle « qui appelle quoi »

Le premier audit comparait la spécification aux routes. Celui-ci prend l'angle inverse :
**quels endpoints l'API sert-elle que personne n'appelle ?** C'est la veine qui avait
déjà livré la boîte de réception.

Méthode : 173 chemins servis confrontés aux appels des quatre clients, puis
**vérification manuelle de chaque candidat**. Nécessaire — un premier passage désignait
`POST /admin/consignments/:id/transit` comme injoignable, ce qui aurait signalé un
blocage du flux producteur. C'était faux : le client construit ce chemin par une
fonction utilitaire (`consignmentAction(id, 'transit')`), invisible à une recherche
textuelle. Les constats ci-dessous ont tous été vérifiés un par un.

### E. Le module de réconciliation est servi, permissionné, et injoignable ✅

Six endpoints (`/admin/reconciliation/daily`, `/pending`, `/discrepancies`, `/report`,
`/transaction/:id`, `/bulk`), un module RBAC à part entière (`reconciliation:
view / update / export`, accordé à des rôles), et **aucune méthode de réconciliation
dans le client admin**.

`Reconciliation.tsx` existe, mais **recalcule l'équilibre dans le navigateur** à partir
de `getStock()` et `getDashboard()`, avec une interface `ReconciliationData` déclarée
localement — la forme de défaut que les contrats partagés ont éliminée partout ailleurs.

Deux conséquences :

- **Deux sources de vérité** sur « les comptes sont-ils équilibrés », sur une plateforme
  adossée à de l'or. Le cron nocturne écrit `reconciliation:<date>` en KV avec le nombre
  d'écarts constatés ; l'écran ne le lit pas.
- **Aucune action possible.** Résoudre un écart ou traiter un lot d'écarts existe côté
  API et n'est atteignable par personne. Un administrateur peut recevoir
  `reconciliation:update` sans aucun moyen de l'exercer.

### F. Le cycle de vie d'un dépôt s'arrête à sa création ✅

`GET /wallet/deposits/pending`, `GET /wallet/deposit/status/:id` et
`POST /wallet/deposit/:id/cancel` sont servis. Les quatre clients n'exposent que
`deposit()` — la création.

Un dépôt mobile-money qui reste bloqué chez l'opérateur est donc **invisible et non
annulable** par l'utilisateur, alors que l'API sait répondre aux trois questions.

**Corrigé.** Et l'écran cachait pire que ce que l'audit avait vu : `discrepancy: 0` et
`isBalanced: true` étaient des **constantes**. La bannière verte « comptes équilibrés »
s'affichait donc quoi qu'il arrive, et la branche rouge était littéralement
inatteignable. Un écran de réconciliation qui affirme l'équilibre sans le vérifier est
pire qu'une absence d'écran.

L'écran lit désormais les six endpoints, sous contrat partagé : synthèse de période,
volumes par type, écarts de solde détaillés, transactions bloquées avec seuil réglable,
et les actions de résolution — gardées par `reconciliation:update`, avec un message
explicite pour les rôles en lecture seule. Une panne de chargement affiche « état
inconnu », jamais un vert rassurant. 10 tests d'écran.

**Corrigé (F).** Les dépôts en cours sont visibles et annulables sur le web et le mobile,
avec re-interrogation périodique — un dépôt se dénoue chez l'opérateur, pas dans
l'application. Le bouton d'annulation n'apparaît qu'en statut `PENDING`, parce que
l'API refuse au-delà : le proposer promettrait ce qu'elle ne fera pas.

Les contrats ont attrapé trois champs que j'avais omis en les écrivant
(`hasDiscrepancies`, `minutesSinceCreation`, `providerStatus`) — tous utiles à l'écran,
tous ajoutés plutôt que supprimés.

### G. La configuration pays n'atteignait pas l'inscription ✅

Corrigé — et l'écran **web** était pire que le mobile : il proposait **190 pays codés
en dur**, du Brunei au Canada, alors que cinq seulement sont configurés (BF, CI, ML, SN,
UG). On pouvait donc ouvrir un compte depuis n'importe où, pour ne jamais pouvoir y
déposer un franc.

Les deux écrans lisent maintenant `/public/countries` et ne retiennent que les pays
`serviceable` — plus strict qu'`enabled`, parce qu'un pays sans moyen de paiement
implémenté n'est pas ouvrable. Échec fermé : si la liste ne charge pas, le champ est
désactivé et le dit, plutôt que de rouvrir la liste d'avant.

### H. Capacités d'administration sans écran ✅

- **Comptes suspendus** — listés en tête de l'écran Utilisateurs, avec motif et terme.
  Une suspension sans date de fin s'affiche « sans terme » plutôt qu'avec une date
  inventée.
- **Validation KYC en lot** — cases à cocher et barre d'action sur la file KYC. Le
  résultat annonce les échecs autant que les succès : un lot à moitié passé qui se dit
  « traité » enverrait chercher les manquants à l'aveugle.
- **Preuve de réserve en PDF** — bouton de téléchargement. Le commentaire de l'écran
  affirmait qu'il n'existait « pas de générateur PDF dans Workers » : c'était vrai avant
  la phase 1.3, et ce commentaire avait survécu à sa raison d'être.

### I. Le changement de mot de passe était cassé 🔴 → ✅

**Mon constat initial était à l'envers.** J'avais écrit que `POST /users/me/password`
faisait double emploi avec `/auth/change-password`. En vérifiant avant de supprimer :
`/auth/change-password` **n'existe pas**. La liste des routes d'authentification ne la
contient pas.

Les deux clients l'appelaient. **Changer son mot de passe renvoyait donc un 404, sur le
web comme sur le mobile.** Et viser la bonne route ne suffisait pas : la validation
exige aussi `confirmPassword`, que ni l'un ni l'autre n'envoyait.

Corrigé des deux côtés, sous contrat partagé, avec des tests qui vérifient le **chemin
appelé** — le compilateur ne voit pas une chaîne de caractères.

Restent inutilisés, et sans conséquence : `/users/me/kyc/resubmit` et `/kyc/history`
(l'écran de refus renvoie vers le formulaire normal), `/auth/resend-code` (le renvoi de
code passe par le chemin sans mot de passe), `/producer/consignments/:id/documents/upload`.

### Ce que cet audit a confirmé de sain

Le **modèle de données** de `CLAUDE.md` est aligné sur le schéma : aucun champ promis ne
manque. Deux écarts de nommage seulement (`KycDocument.verificationStatus` et
`verificationResult` s'appellent `status` et `provider_result`) — de la dérive de
documentation, pas une fonctionnalité absente.

Les **files d'attente** et les **trois Durable Objects** déclarés sont tous consommés.

---

## Troisième audit — 17 août 2026, quatre angles neufs

Les deux audits précédents allaient de la spécification vers le code, puis de l'API
vers les clients. Refaire l'un des deux n'aurait rien dit. Quatre angles inédits :
**les clients vers l'API** (l'inverse du deuxième), les **gardes d'autorisation**, la
**validation des entrées**, et l'**intégrité du schéma**.

### J. La vérification de compte ne fonctionnait pas sur le web ✅

Cinq points d'appel, **aucun ne peut aboutir**. C'est l'angle « clients vers API » qui
les révèle : le compilateur ne lit pas une chaîne de caractères, et un chemin faux ne
se voit qu'à l'exécution.

| Appel | Problème |
|---|---|
| `verifyEmail(token)` | Bon chemin, mauvaise charge : envoie `{token}`, le schéma exige `{email, code}` |
| `resendVerificationEmail()` | `/auth/resend-verification` **n'existe pas** |
| `sendPhoneVerification()` | `/auth/verify-phone/send` **n'existe pas** |
| `verifyPhone(code)` | Bon chemin, mauvaise charge : envoie `{code}`, le schéma exige `{phone, code}` |
| `usePhoneVerification` | `/verify-phone/send` et `/verify-phone/confirm`, **ni l'un ni l'autre n'existe** |

Les vraies routes : `POST /auth/resend-code` avec `{type: 'email'|'phone', identifier}`,
puis `POST /auth/verify-email` avec `{email, code}` ou `POST /auth/verify-phone` avec
`{phone, code}`.

Cela explique aussi pourquoi le deuxième audit voyait `/auth/resend-code` « inutilisé » :
c'est la route que ces fonctions auraient dû appeler.

**Portée réelle** : aucun middleware ni limite KYC n'exige `emailVerified` ou
`phoneVerified` — ils sont rapportés, jamais appliqués. Rien n'est donc bloqué ; c'est
une fonctionnalité promise qui reste inopérante, et un drapeau qui ne passera jamais à
vrai dans la fiche que consulte un administrateur.

### K. Un ajustement de stock refusé se lisait « Erreur interne » ✅

`POST /admin/stock/adjust` calcule `total_allocated + amount` et écrit sans vérifier que
le total reste supérieur aux tokens émis.

**La base rattrape** : `CHECK (tokens_issued <= total_allocated)` est en place, et
`available_stock` est une colonne générée. Les données ne peuvent pas être corrompues —
c'est l'échec fermé qui fonctionne.

Mais la route renvoie un `INTERNAL_ERROR` générique. Un administrateur qui tente de
réduire l'allocation sous ce qui est déjà émis lit « Erreur lors de l'ajustement du
stock », au lieu de « impossible : X g sont déjà émis ». Le garde-fou tient, l'explication
manque.

Second point : l'écriture du stock et celle de la piste d'audit sont deux `.run()`
successifs, pas un `db.batch`. Un échec entre les deux ajuste le stock sans laisser de
trace — l'inverse du motif retenu partout ailleurs.

**Corrigé (J).** Le désaccord n'était pas dans la charge utile mais dans le **parcours** :
`VerifyEmail.tsx` attendait un lien `?token=`, alors que le courriel porte un code à six
chiffres. L'écran demande maintenant l'email et le code. Les quatre autres appels visent
les vraies routes avec les vraies charges. Les tests de chemin ajoutés pour le 404 du mot
de passe couvrent désormais cette famille — ils vérifient le chemin **et** le corps.

**Corrigé (K).** La règle vit dans `lib/stock-invariant`, pas en ligne dans la route : un
test d'intégration qui reproduirait l'arithmétique prouverait la copie. Il appelle la
vraie fonction contre un vrai SQLite. L'ajustement et sa trace d'audit sont désormais dans
un seul `db.batch`, avec un test vérifiant qu'une trace impossible à écrire annule
l'ajustement.


### Ce que cet audit a confirmé de sain

- **Portail État** : `state.use('/*', stateJwtMiddleware)` est posé **avant** toutes les
  routes de données ; les trois routes pré-authentification (connexion, 2FA) sont
  légitimement au-dessus. L'ordre compte en Hono, et il est correct. Plus une liste d'IP
  au montage.
- **Back-office** : aucune route sans garde de permission, hors connexion, 2FA et
  `/me/permissions` — qui renvoie ses propres droits.
- **`PATCH /admin/config/:key`** : refuse une clé qui n'existe pas déjà (on ne peut pas
  inventer de configuration) et journalise clé et valeur dans la piste d'audit.
- **Tables `_new`** (`admins_new`, `transactions_new`, `producer_profiles_new`) : motif
  SQLite standard — créer, copier, renommer. Elles ne persistent pas.
- **Invariant du stock** : contrainte `CHECK` en base, pas seulement en code.

---

## Quatrième audit — 17 août 2026, le code parle-t-il à un schéma qui existe ?

Angle inédit, et le plus productif des quatre : reconstituer le schéma final depuis les
29 migrations, puis vérifier que chaque `INSERT` et chaque `UPDATE` du code ne nomme que
des colonnes qui existent. Une colonne absente est un **500 garanti à l'exécution**, que
ni le compilateur ni les tests actuels ne voient.

Trois écarts, tous **bloquants**, tous sur des écrans câblés.

> **Réserve honnête.** Ces colonnes pourraient exister dans une base déployée où
> quelqu'un les aurait ajoutées à la main. Ce serait alors une dérive de schéma — un
> environnement non reproductible depuis les migrations — ce qui est un défaut d'une
> autre nature, pas une absence de défaut.

### L. Traiter un retrait échouait ✅

`PATCH /admin/withdrawals/:id` exécute deux `UPDATE` :

```sql
UPDATE withdrawals SET status = ?, provider_reference = ?, processed_at = datetime('now') …
UPDATE withdrawals SET status = 'CANCELLED', rejection_reason = ?, processed_at = datetime('now') …
```

La table `withdrawals` ne porte **ni `processed_at`, ni `rejection_reason`** : elle a
`approved_at`, `completed_at` et `failure_reason`. Et `'CANCELLED'` n'appartient pas aux
statuts autorisés par sa contrainte `CHECK` (`PENDING`, `APPROVED`, `PROCESSING`,
`COMPLETED`, `FAILED`, `REJECTED`).

Les boutons **Approuver** et **Rejeter** de l'écran Retraits sont câblés à cette route.
Un retrait client ne peut donc être ni approuvé ni rejeté depuis le back-office.

### M. Valider un dossier KYC depuis l'écran de revue échouait ✅

**Quatre** colonnes inexistantes — `verification_status`, `verification_job_id`,
`verification_result` et `verified_at` — sont utilisées dans **douze instructions SQL
vivantes** (`admin.ts`, `kyc.service.ts`, `webhooks.ts`).

La table `kyc_documents` porte en réalité :

| Colonne utilisée par le code | Colonne réelle |
|---|---|
| `verification_status` | `status` |
| `verification_job_id` | `provider_job_id` |
| `verification_result` | `provider_result` |
| `verified_at` | `reviewed_at` |

`verified_at` existe bien dans le schéma, mais sur `recovery_codes` — une table voisine
dans le même fichier de migration. Le premier passage de cet audit l'avait classée
« présente » pour cette raison ; la relecture l'a corrigé. Elle apparaît dans les mêmes
`UPDATE` que `verification_status`, donc le correctif porte sur quatre noms, pas trois.

Les deux plus graves : `POST /admin/kyc/:id/review` (validation et rejet) et
`GET /admin/kyc/:id` (détail d'un dossier). `KycReview.tsx` appelle les deux.

Un chemin parallèle fonctionne — `PATCH /users/:id/kyc` écrit `users.kyc_status`, avec
les bonnes colonnes — donc la plateforme n'est pas entièrement bloquée. Mais **l'écran
dédié à la revue KYC l'est**, ainsi que le rappel du fournisseur d'identité.

### N. La connexion sans mot de passe échouait ✅

`auth.ts` écrit dans une table `refresh_tokens` **qui n'existe dans aucune migration** :

- `INSERT INTO refresh_tokens (…)` dans `POST /auth/passwordless/verify`, appelé par le
  mobile **et** le web ;
- `DELETE FROM refresh_tokens WHERE user_id = ?` dans deux blocs de révocation de session,
  au sein d'un `Promise.all` — l'échec d'une branche fait échouer l'ensemble.

L'insertion est inconditionnelle et se situe avant la création de session : la connexion
sans mot de passe ne peut pas aboutir.

### O. `transactions.external_reference` n'existait pas ✅

Trouvé non par l'audit mais par le **garde-fou** écrit pour le corriger. Six écritures
renseignaient cette colonne. La pire : `POST /wallet/deposit` l'écrit **après** avoir
initié le paiement chez l'opérateur — la requête échouait une fois le client engagé, et
la référence du fournisseur était perdue avec elle.

Ajoutée par migration plutôt que réécrite : `payment_reference` porte NOTRE référence,
`external_reference` celle du fournisseur. Les confondre reviendrait à ne plus pouvoir
rapprocher un mouvement de son homologue chez l'opérateur.

### Le vrai correctif : `pnpm check:sql`

`packages/api/scripts/check-sql-schema.mjs` reconstitue le schéma final depuis les 29
migrations et y confronte chaque `INSERT`, `UPDATE`, `DELETE` et `SELECT` mono-table. Il
tourne avant `pnpm test` (`pretest`), comme `check:pins` garde la publication mobile.

Il s'est trompé **trois fois** pendant sa construction — instructions rejouées groupées
par type, découpage avant retrait des commentaires de ligne, commentaires de bloc lus
comme des colonnes. Chaque erreur a été trouvée en comparant sa sortie à des listes de
colonnes lues à la main. Un garde-fou faux est pire qu'aucun : il rassure.

**Limite assumée** : il n'est pas écrit en test vitest. Charger ce module dans le
transformateur de vitest échoue pour une raison d'outillage non élucidée, et un
garde-fou qu'on n'arrive pas à charger ne garde rien. Le lancer en amont de la suite
donne la même garantie sans dépendre de cette chaîne.

### Pourquoi trois audits ne l'avaient pas vu

Chacun regardait une frontière différente — spécification/code, API/clients,
clients/API. Aucun ne regardait **code/base**. Une requête SQL est une chaîne de
caractères : elle traverse le typage, les contrats partagés et les tests d'écran sans
que rien ne la confronte au schéma.

---

## Cinquième audit — 17 août 2026, la valeur se conserve-t-elle ?

Angle propre au domaine : toute écriture qui déplace de l'or ou de l'argent est-elle
**atomique** ? Le contrat posé par la mission est clair — une mutation de valeur
multi-instructions passe par `db.batch`, chaque instruction porte la même garde, et le
basculement d'état vient en dernier. Une suite de `.run()` indépendants n'offre aucune de
ces garanties : un échec au milieu laisse la moitié du mouvement écrite.

Le signal retenu : une instruction passée à `db.batch` **ne s'exécute jamais seule** et
n'appelle donc pas `.run()`. Un `.prepare(…).run()` sur une table de valeur est une
écriture exécutée isolément.

### P. Le rappel de paiement complétait la transaction avant de créditer ✅

`routes/webhooks.ts`, branche `SUCCESS` :

1. `UPDATE transactions SET status = 'COMPLETED', …` — **validé**
2. puis, pour un dépôt, `UPDATE wallets SET cash_balance = cash_balance + ?`

Deux validations distinctes. Un échec entre les deux laisse une transaction **complétée
et jamais créditée** : le client a payé, le registre dit que c'est fait, le solde n'a pas
bougé.

Et ce n'est pas réservé au cas de panne. Le contrôle d'écart de montant intervient
**après** le marquage `COMPLETED` et renvoie 400 : un rappel au montant divergent laisse
donc durablement une transaction complétée sans crédit, sur une entrée parfaitement
plausible.

### Q. Le rejet d'un retrait faisait trois écritures séparées ✅

`routes/admin.ts`, branche de rejet : rembourser le portefeuille, marquer la transaction
`CANCELLED`, marquer le retrait `REJECTED` — trois `.run()` successifs.

Une garde existe en amont (`status !== 'PENDING'` → refus), ce qui bloque un rejeu
séquentiel. Mais elle est **lue avant** d'écrire. Si le remboursement passe et que le
marquage échoue, la transaction reste `PENDING` : la reprise franchit la garde et
**rembourse une seconde fois**.

C'est exactement ce que le contrat de lot gardé élimine — même garde sur chaque
instruction, basculement d'état en dernier, et le second essai ne touche aucune ligne.

**Corrigé (P).** La validation du montant passe **avant** toute écriture. Crédit et
basculement sont dans un seul lot, tous deux gardés par `status != 'COMPLETED'`, le
basculement en dernier. La route lit son `meta.changes` : zéro signifie « rappel déjà
traité », et elle répond 200 sans renotifier le client.

**Corrigé (Q).** Remboursement, retrait et transaction dans un seul lot, chaque
instruction gardée sur `PENDING`, basculement en dernier, et 409 si rien n'a été touché.
La branche d'approbation avait la même forme à deux écritures — traitée de même.

**Trouvé en écrivant les tests** : `test/helpers/real-d1.ts` avait dérivé du schéma réel
(pas d'`external_reference`, quatre colonnes manquantes sur `withdrawals`). Son propre
commentaire posait la règle — un harnais qui ne reflète pas le schéma certifie des
requêtes que la production rejette. Aligné.

Un test fige aussi **pourquoi** chaque instruction doit porter la garde : une mise à jour
qui ne matche aucune ligne n'est pas une erreur et n'interrompt pas le lot, donc garder
le seul basculement laisserait le crédit s'exécuter quand même.


### Ce que cet audit a confirmé de sain

- **27 écritures de valeur passent par `db.batch`** : `wallet.service` (achat, vente),
  `lease.service`, `consignment.service`, `storage-fee.service`. Le contrat de lot gardé
  est appliqué partout où la mission l'a posé. Les chemins non protégés sont ceux qu'elle
  n'a jamais touchés — le rappel de paiement et le traitement administratif des retraits.
- **Aucune promesse d'écriture de valeur lancée sans `await`.**
- **Trois blocs `catch` muets seulement**, tous sur une lecture de cache de prix
  d'affichage, avec repli explicite à `null`. Rien qui avale une erreur d'écriture.

---

## Sixième audit — 17 août 2026, à qui appartient la ressource ?

Angle jamais couvert : l'**autorisation au niveau de l'objet**. L'audit 3 avait vérifié
les gardes de route (`requirePermission` : « cet appelant a-t-il ce droit ? »). Personne
n'avait vérifié la question suivante : « cette ressource-ci est-elle la sienne ? » Sans
ce filtre, n'importe quel titulaire de compte lit ou modifie les données d'un autre en
changeant un identifiant dans l'URL.

### Aucun défaut trouvé — et c'est le résultat

Les **17 routes utilisateur portant un paramètre** filtrent toutes sur le propriétaire :

- en SQL (`WHERE id = ? AND user_id = ?`, comme le marquage d'une notification lue) ;
- dans le corps de la route (`if (consignment.producer_id !== userId) return 404`) ;
- ou dans le service auquel elle délègue (`LeaseService.requestExit` refuse avant
  d'écrire).

`GET /verify/:code` est la seule route non filtrée, **par conception** : le code de
vérification d'un certificat *est* le justificatif.

Deux vérifications complémentaires, également propres :

- **Aucune route ne lit un identifiant de propriétaire depuis le corps de la requête.**
  Il vient toujours du jeton.
- **Le service d'objets applique une double garde.** Servir la photo d'un lot vérifie
  l'appartenance du lot, *puis* revalide la clé R2 contre le préfixe du producteur — avec
  un commentaire qui explique pourquoi : les documents KYC vivent dans le même seau.

### Ce que l'audit signalait : une convention, devenue un mécanisme ✅

Il n'existe pas d'équivalent de `requirePermission` pour la propriété d'un objet. Chaque
route s'en souvient — quinze fois sur quinze aujourd'hui — mais rien ne l'y oblige. Une
seizième route ajoutée demain peut l'oublier sans que rien ne le signale.

Le symptôme est mesurable : mon détecteur a eu besoin de **trois élargissements**
successifs pour voir toutes les formes en usage (filtre SQL, comparaison JavaScript avec
`user_id`, comparaison avec `producer_id`, délégation à un service). Quatre idiomes pour
une même règle, c'est une règle qu'on applique de mémoire.

**Posé.** Les deux moitiés :

- `src/lib/ownership.ts` donne une forme canonique au nouveau code. `refusSiEtranger()`
  traite une ressource **absente** et une ressource **étrangère** de façon identique :
  répondre 403 sur l'une et 404 sur l'autre confirmerait l'existence de ce qu'on refuse
  de montrer, et ferait de la route un oracle qui énumère les identifiants.
- `pnpm check:ownership` refuse une route utilisateur à paramètre sans contrôle
  reconnaissable. Il accepte **délibérément** les quatre formes existantes plutôt que
  d'imposer la réécriture de quinze routes qui fonctionnent : remuer du code correct
  achète du risque, pas de la sûreté.

**Les exceptions sont des décisions.** Deux listes, chacune exigeant une raison écrite —
même forme que les tables exclues de la sauvegarde : `/verify/:code` (le code *est* le
justificatif) et `POST /positions/:id/exit` (la garantie vit dans `LeaseService.requestExit`,
nommé). Sans cette seconde liste, « le service s'en charge » est une croyance ; en la
nommant, elle devient vérifiable. Un test refuse une entrée sans justification réelle.

Vérifié par mutation : retirer la comparaison `producer_id` de `GET /consignments/:id`
fait échouer le contrôle, avec fichier et ligne.

**Et une limite documentée s'est révélée être un correctif d'une ligne.** J'avais écrit
que `check-sql-schema.mjs` ne pouvait pas être chargé par vitest. Construire ce
second garde-fou — qui se charge, lui — a montré que le format n'était pas en cause. La
bissection a trouvé : un shebang combiné à des fins de ligne CRLF, introduites par mes
propres éditions. Le script s'invoque par `node scripts/…`, jamais en exécutable : la
ligne était décorative. Ses 16 tests sont rétablis.

---

## Septième audit — 17 août 2026, les travaux de nuit sont-ils rejouables ?

Angle propre au domaine : onze crons tournent chaque nuit, et trois déplacent de l'argent
— rendement de location, sortie de location, frais de garde. Un travail qui refire, ou
qui échoue à mi-parcours, ne doit ni payer deux fois ni oublier quelqu'un.

### Ce que l'audit a confirmé de sain — et c'est remarquable

**L'idempotence n'est pas laissée au code : elle est dans la base**, au même endroit dans
les trois cas, avec la raison écrite à côté :

| Table | Protection |
|---|---|
| `lease_accruals` | `UNIQUE (position_id, accrual_date)` — « ce UNIQUE est ce qui rend le job rejouable » |
| `storage_fee_accruals` | `UNIQUE (user_id, accrual_date)` — « rejouer le job ne facture pas deux fois » |
| `reserve_attestations` | `sequence INTEGER UNIQUE` — « ce UNIQUE fait échouer une double émission concurrente » |

`LeaseService.settleExit` va plus loin : une constante `guard` unique
(`EXISTS (… status = 'PENDING')`) est appliquée à **chacune** de ses instructions. C'est
le contrat de lot gardé appliqué à la lettre.

### R. Une défaillance en cours de boucle interrompt le reste — et le jour est perdu ✅

`lease-accrual` et `storage-fee` parcourent leurs bénéficiaires sans **aucune gestion
d'erreur par élément** :

```ts
for (const position of positions) {
  const result = await service.accrueDay(position, date, price.price_xof);
  ...
}
```

Si `accrueDay` **lève** — une erreur D1 passagère suffit — l'exception remonte, la boucle
s'arrête, et toutes les positions suivantes ne sont jamais traitées ce jour-là.

Et le jour manqué n'est pas rattrapé. `positionsToAccrue` sélectionne
`last_accrued_on < ?` avec la date **du jour courant** : au passage suivant, la position
est bien reprise, mais créditée pour la nouvelle date, au prix de la nouvelle date. Le
rendement du jour perdu n'est jamais versé ; le frais de garde du jour perdu n'est jamais
facturé.

La perte est **silencieuse et permanente**, et elle est asymétrique : ce sont les
détenteurs qui perdent leur rendement.

**Le motif correct existe dans le même dossier.** `lease-settlement` attrape par élément,
consigne l'échec via `failExit`, et continue :

```ts
try { result = await service.settleExit(order, pricePerGram); }
catch (error) { await service.failExit(order.id, String(error)); continue; }
```

Il ne manque que de l'appliquer aux deux autres — et de rendre l'écart visible, parce
qu'aujourd'hui la seule trace est une ligne de journal `booked/total` que personne ne lit.

**Corrigé** — [ADR 011](adr/011-rattrapage-des-jours-manques.md), six décisions.
`src/lib/accrual-backfill.ts` fournit les deux briques qui manquaient : la liste des jours
dus et le prix **de ce jour-là** (dernier relevé dans les bornes de la journée, et non le
dernier prix connu). Les deux travaux traitent désormais chaque bénéficiaire dans son
propre `try`, et tout écart part au journal en niveau erreur : échecs, jours sans prix,
bénéficiaires encore en retard.

Deux points tranchés en cours de route plutôt qu'en silence :

- **Les frais de garde ne sont pas rattrapés** (§ 5). Une position de location fige son
  `principal_g` à l'ouverture ; un frais de garde porte sur le solde **du moment**, et
  aucune table ne conserve le solde jour par jour. Facturer un jour vieux de deux semaines
  au solde d'aujourd'hui ferait payer la garde d'un or que le titulaire ne détenait
  peut-être pas. Le jour manqué est signalé, pas reconstitué.
- **Une position jamais créditée part de sa date d'ouverture** (§ 4). `last_accrued_on` à
  `NULL` ne veut pas dire « depuis quand ? » : la position porte son `opened_at`. Sans
  cela, une panne de cinq jours n'aurait rattrapé qu'une seule journée pour une position
  récente.

Le rattrapage est plafonné (`accrual_backfill_max_days`, 30 par défaut, migration 0034), et
il garde les jours **les plus récents** : mieux vaut rattraper le proche et signaler le
reste que s'enliser dans le plus ancien. Aucun rattrapage rétroactif des jours déjà
perdus — décider qui est dû de quoi appartient à l'exploitant.

19 tests, dont trois vérifiés par mutation : plafond qui garderait les jours les plus
anciens, prix à zéro accepté comme un cours, et reprise au dernier jour traité au lieu du
suivant (qui créditerait deux fois le même jour).

### S. Vingt-six tests d'authentification ne s'exécutaient pas ✅

Découvert en vérifiant R, pas en le cherchant. `pnpm test` affichait `736 passed (762)` :
26 tests manquaient au total **sans être signalés en échec**, et sans que le fichier absent
soit nommé nulle part.

`argon2-browser@1.18` cherche son `.wasm` par `require('../dist/argon2.wasm')` — que vite
lit comme du JavaScript — ou par `fetch(<chemin de fichier>)`, que Node refuse depuis qu'il
a un `fetch` global. Emscripten répond à l'échec par `abort()`, qui tue le processus : le
worker vitest meurt et `auth.service.test.ts` disparaît du décompte.

Un test qui échoue se voit. Un test qui n'existe plus se compte comme absent, et le total
descend sans que personne s'en aperçoive — c'est ce qui s'est produit sur plusieurs
livraisons, y compris dans les chiffres rapportés à chaque phase.

`test/argon2-wasm.setup.ts` fournit les octets à la bibliothèque avant qu'elle ne les
cherche. Les tests s'exécutent donc contre le **vrai** argon2 : un bouchon aurait rendu la
suite verte en cessant de vérifier quoi que ce soit du hachage des mots de passe.

Une fois exécutés, trois de ces tests échouaient pour de bon — périmés faute d'avoir tourné :

- `sub: 'user-123'` alors que `JwtPayloadSchema` exige un UUID (durcissement délibéré du
  code, jamais répercuté sur les tests). Corrigé côté test.
- `refreshAccessToken` renvoyait un jeton identique à l'octet près : `iat`/`exp` ont une
  résolution d'une seconde et aucun `jti` n'est émis, donc deux jetons frappés dans la même
  seconde pour le même sujet **sont** identiques. L'assertion testait une propriété que le
  format ne fournit pas ; elle vérifie maintenant que le jeton rendu est utilisable et porte
  la bonne identité. La révocation ne repose pas sur l'unicité du jeton mais sur l'époque
  `invalidBefore`, elle aussi à la seconde — rien n'est affaibli.

Suite API : **762/762**, 53/53 fichiers.

---

## Huitième audit — 18 août 2026, l'arithmétique elle-même

Sept audits ont regardé les flux, les droits, la rejouabilité. Aucun n'a regardé **les
chiffres**. Or ici tout est conversion : le gramme a trois décimales, le XOF n'en a aucune,
et le solde est un flottant. Chaque conversion arrondit, et un arrondi a toujours un
bénéficiaire.

### Ce que cet audit a confirmé de sain

**L'invariant fondamental est dans la base, pas dans le code** :

```sql
available_stock REAL GENERATED ALWAYS AS (total_allocated - tokens_issued) VIRTUAL,
CHECK (tokens_issued <= total_allocated)
```

Une colonne générée ne peut pas diverger de ses composantes, et la contrainte ne peut pas
être oubliée par un appelant. `token_balance >= 0` et `cash_balance >= 0` sont également
des `CHECK`. `canPurchase` lit bien `total_allocated - tokens_issued` : **l'émission
automatique est correcte**, aucun des constats ci-dessous ne permet d'émettre un jeton non
couvert.

`generateQuote` quantifie explicitement, avec la raison écrite à côté — grammes au
milligramme, argent au XOF entier — et le devis est recalculé à partir de la quantité
tronquée, si bien que l'utilisateur paie exactement ce qu'il reçoit.

L'attestation signée est l'artefact le plus rigoureux du dépôt : elle distingue
`totalAllocatedG`, `tokensIssuedG`, `vaultedG` (alloué − prêté) et `onLoanG`, et publie
`invariantHolds` et `fullyVaulted` comme des affirmations vérifiables.

### T. Le solde affiché n'est pas vendable ✅

`token_balance` est un `REAL`, et chaque achat fait `token_balance = token_balance + ?`.
L'addition flottante de valeurs pourtant quantifiées au milligramme dérive.

Mesuré, pas supposé — **trois achats suffisent** :

```
0.018 + 2.106 + 4.337
  solde stocké  = 6.4609999999999994102
  affiché       = 6.461 g          (formatGrams -> toFixed(3))
  token_balance >= 6.461  ->  FAUX  (il manque 8.9e-16 g)
```

L'écran montre `6.461 g`. L'utilisateur saisit `6.461`. Le garde `WHERE id = ? AND
token_balance >= ?` ne change aucune ligne, et la contrainte `token_balance >= 0` refuserait
de toute façon le débit. Réponse : **solde insuffisant**, sur le solde exact que l'interface
vient d'afficher.

Ce n'est pas théorique et quelqu'un l'a déjà rencontré : `disposition.service.ts:174`
compare avec une tolérance —

```ts
if (wallet.token_balance + 0.0005 < g(sellG + leaseG)) return fail('INSUFFICIENT_BALANCE');
```

— mais c'est le **seul** endroit. La vente (`wallet.service.ts:267`), la mise en location
(`lease.service.ts:140`) et le pré-contrôle d'`executeSellAtomic` comparent sans tolérance.
Une correction a donc été appliquée là où le problème est apparu, pas là où il vit.

Le correctif n'est pas d'ajouter trois epsilons de plus. La demi-tolérance du milligramme
est une **règle métier** — « à un demi-milligramme près, c'est le même poids » — et elle
mérite un seul endroit qui la porte, comme `xof()` porte l'arrondi de la monnaie. À noter
au passage : `xof = (n) => Math.round(n)` est recopié **à l'identique dans quatre services**.
Quatre copies de la règle d'arrondi de la monnaie, c'est quatre endroits où elle peut
diverger.

**Corrigé** — [ADR 013](adr/013-quantifier-les-grammes-a-l-ecriture.md).

La quantification se fait à l'**écriture**, en SQL : `token_balance = ROUND(token_balance + ?, 3)`.
Ajouter des tolérances aux comparaisons n'aurait pas suffi — le garde qui décide n'est pas le
`if` en JavaScript mais la contrainte `CHECK (token_balance >= 0)`, et débiter 6,461 d'un solde
de 6,4609999999999994 produit −8,9 × 10⁻¹⁶. Une tolérance en amont aurait laissé passer le
pré-contrôle pour échouer plus loin, avec un message pire.

Vérifié sur le moteur, pas déduit :

```
sans arrondi : 6.4609999999999994   → vendre 6.461 modifie 0 ligne
avec arrondi : 6.4610000000000003   → vendre 6.461 modifie 1 ligne  (et vaut === 6.461)
```

**Les quatre colonnes de grammes**, pas seulement les portefeuilles : `token_balance`,
`tokens_issued`, `gold_on_loan`, `total_allocated`. Les deux dernières sont comparées entre
elles par `CHECK (tokens_issued <= total_allocated)` — si l'une dérive et l'autre non, la
contrainte refuse une émission légitime. Corriger les portefeuilles seuls aurait corrigé
l'instance, pas la catégorie, soit le reproche même fait à la tolérance isolée de
`disposition.service.ts` — laquelle est retirée : elle masquerait désormais un retour de la
dérive au lieu de la compenser.

Le XOF n'est pas concerné : `cash_balance` accumule des entiers, exacts en flottant jusqu'à
2⁵³. Y ajouter un arrondi aurait suggéré un risque inexistant.

`pnpm check:grams` refuse toute accumulation écrite sans `ROUND(..., 3)` et tourne avant la
suite avec `check:sql` et `check:ownership` — dix-huit requêtes portent la règle, et une règle
répétée dix-huit fois est une règle qu'on oubliera la dix-neuvième. **Le contrôle ne comporte
aucune expression régulière** : la première version construisait la sienne dans une chaîne
gabarit, où `` est l'échappement « backspace » — elle ne trouvait rien et se déclarait
satisfaite. Le piège est documenté dans `state-payload.test.ts` ; j'y suis retombé en écrivant
le contrôle censé s'en prémunir.

Migration 0035 : la dérive déjà accumulée est requantifiée en place. **Aucun solde ne change de
valeur** — 6,4609999999999994 devient 6,461, le même poids au millionième de milligramme près.
Ce qui change, c'est la comparabilité.

7 tests sur une **vraie base SQLite**, dont un qui vérifie qu'un portefeuille vidé retombe
exactement à zéro : un résidu de 10⁻¹⁵ g le laissait compté comme détenteur par les écrans et
suivi par les frais de garde.

### U. « Tokens Émis » exclut l'or en location — au portail de l'État ✅

La location **sort les grammes du portefeuille** et alimente `gold_on_loan`, sans toucher à
`tokens_issued` : le jeton existe toujours, il est seulement prêté. C'est correct.

Mais le tableau de bord de l'État, le rapport mensuel et la preuve de réserve calculent
tous leurs chiffres sur `SUM(wallets.token_balance)` — la somme des portefeuilles, qui est
`tokens_issued − gold_on_loan`. Et `apps/state-portal` étiquette ce nombre **« Tokens
Émis »**.

Avec 1 000 g alloués, 900 g émis, 400 g placés en location :

| | Affiché à l'État | Réel |
|---|---|---|
| « Tokens Émis » | **500 g** | 900 g |
| « Disponible » | **500 g** | 100 g |
| Couverture | **200,0 %** | 111,1 % |

L'écart n'est pas un arrondi : c'est exactement l'or en location, et l'erreur va dans le
sens flatteur. Le portail annonce une réserve deux fois couverte quand elle l'est à 1,11
fois, et cinq fois plus d'or disponible qu'il n'y en a.

`GET /admin/stock` fait la même substitution : il sélectionne `tokens_issued` puis renvoie
la somme des portefeuilles à sa place, et calcule `availableStock` en ignorant la colonne
générée `available_stock` qui donne pourtant la bonne valeur.

**Ce n'est pas une faille d'émission** — `canPurchase` lit la bonne source et la contrainte
`CHECK` tient. C'est le chiffre sur lequel un ministère décide qui est faux, dans le sens
qui rassure. C'est précisément la promesse sur laquelle repose le projet.

Le test existant (`state-payload.test.ts`) épingle les **noms** de champs — il est né de la
confusion `coverage` / `coverageRatio` qui affichait 0 %. Il ne dit rien de ce que le
chiffre contient. La confusion de nommage a été corrigée ; la confusion de sens ne l'a pas
été.

### V. « Couverture » désigne trois grandeurs, « entièrement en coffre » deux ✅

Quatre définitions coexistent pour le même mot :

| Endroit | Formule | Sens |
|---|---|---|
| `market.ts:98` (public) | `alloué / émis` | ratio ≥ 1 — combien d'or garantit un jeton |
| `admin.ts:1628` | `Σ portefeuilles / alloué` | fraction ≤ 1 — **l'inverse** |
| `admin.ts:2091` | `alloué / Σ portefeuilles` | ratio, sur le mauvais dénominateur |
| `state.ts:483` | `alloué / Σ portefeuilles` | ratio, sur le mauvais dénominateur |

Les deux premières sont **réciproques l'une de l'autre**. Un lecteur qui rapproche l'écran
public de l'écran d'administration compare 1,11 à 0,90 en croyant lire deux fois la même
chose.

`fullyVaulted` est pire, parce que les deux définitions se contredisent le même jour :

```
attestation      fullyVaulted = tokens_issued <= (alloué − prêté)
tableau de bord  fullyVaulted = (gold_on_loan === 0)
```

Avec 1 000 g alloués, 900 g émis et 50 g en location : l'attestation signée répond **oui**
(900 ≤ 950), le tableau de bord répond **non** (50 ≠ 0), et le portail affiche l'alerte
rouge. L'État dispose donc de deux artefacts qui se contredisent sur la même question, dont
l'un est signé.

Ici le tableau de bord est le plus sévère — c'est le bon sens pour une alerte. Mais avec
`coverageRatio` l'erreur va dans l'autre sens sur le même écran. Des divergences de
directions opposées sont plus difficiles à démêler qu'une erreur franche : elles se
compensent visuellement sans jamais se corriger.

**Corrigé (U et V)** — [ADR 012](adr/012-un-seul-vocabulaire-pour-la-reserve.md).

`src/lib/reserve.ts` calcule une fois pour toutes émis, en coffre, disponible, couverture,
utilisation et les deux verdicts. Les sept routes ne recalculent plus, elles lisent. La
somme des portefeuilles ne subsiste que là où la question porte réellement sur les
portefeuilles — la répartition par tranche.

Trois champs renommés, uniquement là où **le nom lui-même a produit le défaut** :

| Avant | Après | Pourquoi |
|---|---|---|
| `StateDashboardData.totalTokens` | `tokensIssued` | étiqueté « Tokens Émis », portait la somme des portefeuilles |
| `MarketStockData.coverage` | `coverageRatio` | un ratio portant le nom que l'admin donnait à l'inverse |
| `AdminStockData.coverage` | `utilisationRate` | sous ce nom, `>= 1` ne s'écrit plus par distraction |

`tokensInCirculation` n'est pas touché : le nom est exact, seule sa source l'était pas.
Du remaniement sur du code juste achète du risque, pas de la sûreté.

**Le voyant inversé du back-office est corrigé.** `Stock.tsx` testait `coverage >= 1` sur un
taux d'utilisation que l'invariant maintient sous 1 : il affichait « couverture
insuffisante » en permanence et ne serait passé au vert qu'à 100 % — quand il ne reste plus
un gramme. La carte mesure désormais l'allocation engagée, et l'alerte se déclenche sur la
condition réelle : plus rien à émettre.

`fullyVaulted` prend la définition de l'attestation **signée** (`émis ≤ alloué − prêté`)
plutôt que « aucun gramme n'est prêté ». Avec 50 g en location sur 900 émis et 1 000
alloués, les deux se contredisaient le même jour.

`Infinity` disparaît : `JSON.stringify` le transformait en `null`, si bien que le contrat
annonçait `number` et la route livrait `null`. La couverture est explicitement
`number | null`, et les trois écrans affichent « — » sans déclencher d'alerte — une réserve
sans engagement n'est pas une réserve sous-couverte.

11 tests de source (aucune route ne dérive « émis » d'une somme de portefeuilles, aucune ne
recalcule le ratio à la main), 14 tests d'arithmétique, 1 test d'écran. Vérifié par
mutation : réintroduire une somme de portefeuilles dans `state.ts` fait échouer le garde.

**Aucune reprise de l'historique** : les rapports déjà exportés portent les anciens
chiffres. Les recalculer demanderait un `gold_on_loan` jour par jour qu'aucune table ne
conserve — la même limite qu'en ADR 011 § 5. Un rapport transmis se corrige par un
rectificatif, pas par une réécriture silencieuse.

### W. `MIN_XOF = 100` suppose un prix de l'or, sans le dire 🔵

Un achat exprimé en XOF est converti puis **tronqué** au milligramme :

```ts
tokenAmount = Math.floor(body.amount / pricePerGram * 1000) / 1000;
```

Le minimum de 100 XOF ne produit une quantité non nulle que tant que le gramme vaut moins
de 100 000 XOF. Au cours actuel (~53 000 XOF/g) la marge est d'un facteur deux. Au-delà,
`tokenAmount` vaut `0`, et rien sur le chemin d'exécution ne refuse un devis à zéro : ni
`canPurchase(0)`, ni `generateQuote`, ni `/market/buy`.

Latent, pas actif. Mais la constante encode une hypothèse sur le prix de l'or sans la
nommer, et l'échéance est un doublement du cours — pas une impossibilité sur la durée de
vie d'une plateforme souveraine.

### X. L'écran Preuve de Réserve du back-office plante au chargement ✅

Trouvé en corrigeant U, pas en le cherchant, et **antérieur à ce correctif**.

`apps/admin/src/lib/api.ts` déclare pour `GET /admin/reports/por` une forme imbriquée —
`goldStock`, `tokenHolders`, `transactions`, `pricing`, `audit`, `verification`. La route
émet une charge **plate** : `goldAllocated`, `tokensInCirculation`, `availableStock`,
`coverageRatio`, `walletDistribution`, `certificationStatus`…

Aucune de ces six clés n'existe dans la réponse. La page les lit sans garde :

```tsx
) : report && (
  … report.goldStock.isCovered …     // report.goldStock vaut undefined
```

Ce n'est donc pas un écran qui affiche des zéros : c'est une `TypeError` dès que la requête
aboutit. Vingt et un accès distincts sont concernés, dont `pricing.spread`,
`transactions.last24h` et `verification.checksum` — des données que la route ne produit
**pas du tout**.

C'est la forme exacte du défaut du quatrième audit : un type déclaré localement côté client
plutôt qu'un contrat partagé, donc invisible à TypeScript. Corriger demande de trancher
entre enrichir la route ou réduire la page, et de mettre le résultat sous contrat partagé —
c'est un chantier à part, pas un effet de bord de U.

**Corrigé.** Le contrat `AdminProofOfReserveData` est désormais partagé, la route l'épingle par
`satisfies`, et le type déclaré localement dans le client a disparu — c'était lui la cause :
un type écrit côté client ne vérifie rien, il décrit un espoir.

Tout ce qu'émet la route est adossé à des données qui existent. Deux blocs n'avaient aucune
source et ont été remplacés plutôt qu'inventés :

- `pricing` vient de `gold_prices` (cours, prix d'achat et de vente, spreads, source, horodatage)
  et vaut `null` tant qu'aucun relevé n'existe — un tableau de prix à zéro se lirait comme un
  marché à l'arrêt. La page masque alors le bloc et affiche « Aucun cours relevé ».
- `verification.checksum` n'avait aucune source. Ce qui est vérifiable existe pourtant déjà :
  l'**empreinte de l'attestation signée**, celle que la page publique `/reserve` recalcule dans
  le navigateur. Le rapport publie ce numéro de séquence et cette empreinte, ou dit qu'aucune
  attestation n'a été émise.

Les trois fenêtres de transactions (24 h / 7 j / 30 j) sont calculées **en une seule passe** :
trois requêtes séparées pourraient tomber de part et d'autre d'une transaction en cours et ne
pas se recouper.

Le PDF (`/admin/reports/por.pdf`) passe lui aussi par `chiffresReserve` : il recalculait sa
propre version de « en coffre » et de l'invariant.

5 tests d'écran. **Vérifié par mutation** : servir à la page l'ancienne charge plate reproduit
exactement le défaut d'origine — `TypeError: Cannot read properties of undefined (reading
'coverageRatio')`.

### Y. Les fixtures de test étaient hors du typecheck ✅

`apps/web`, `apps/admin` et `apps/state-portal` déclaraient `"include": ["src"]`. Un objet
de test typé `StateDashboardData` avec un champ qui n'existe plus **compilait sans
erreur** — c'est ainsi que le renommage de U n'a été signalé que par l'exécution des tests.

Toute la sûreté du dépôt repose sur `satisfies` et les contrats partagés, et les fixtures —
précisément là où les formes périmées se cachent — en étaient exemptées. Le même mécanisme
avait laissé `auth.service.test.ts` périmer.

`"include": ["src", "test"]` sur les trois applications, **à coût nul** : zéro erreur
introduite. Vérifié par mutation — remettre l'ancien nom de champ dans une fixture fait
désormais échouer `tsc`.

---

## 1. Paiements hors zone franc 🔴

**Le seul manque fonctionnel majeur.** `country_config` décrit l'Ouganda — UGX, indicatif,
pièces d'identité — mais **MTN MoMo et Airtel Money sont déclarés non implémentés**, et
`isServiceable()` marque le pays non ouvrable tant que c'est le cas.

Ce qu'il faut réellement : un adaptateur par prestataire (initiation, webhook de confirmation,
réconciliation), et la conversion de devise — le flux de prix est en USD et converti, donc un
pays en UGX a besoin de son propre taux, pas d'un FCFA relabellisé.

C'est autant une décision produit qu'un travail technique : ouvrir un pays engage des
agréments, pas seulement du code.

## 2. Tests d'interface — bout-en-bout mobile 🟠

Les trois applications web sont couvertes en jsdom, rendu de composants compris ;
`apps/mobile` l'est sur sa logique. Le partage est décidé dans
[ADR 007](./adr/007-tests-d-interface.md) : rendre du React Native sous vitest
demanderait d'ajouter **jest** à côté, pour une seule application, afin de vérifier
qu'un composant affiche une valeur déjà vérifiée ailleurs.

| Application | Tests | Portée |
|---|---|---|
| `apps/web` | 47 | hook de formulaire, vérification d'attestation, boîte de réception |
| `apps/admin` | 53 | client API, magasin de session |
| `apps/state-portal` | 33 | client API, session, écrans Stock / Tableau de bord / Connexion |
| `apps/mobile` | 61 | session et jetons, validation de saisie, épinglage SSL, formatage, sélecteurs bout-en-bout |

**Ce qui reste** : **exécuter** les parcours bout-en-bout mobiles. Ils sont écrits
(3 parcours Maestro + 1 sous-parcours, 25 `testID` posés sur le chemin critique,
choix d'outil dans [ADR 008](./adr/008-bout-en-bout-mobile.md)) et un contrôle
statique prouve que chaque sélecteur désigne un élément existant — mais **aucun n'a
tourné contre un appareil**.

Le blocage est matériel, pas conceptuel : la machine de développement a le SDK
Android et `adb`, mais aucune image système, aucun AVD et pas de JDK. Il faut
télécharger plusieurs gigaoctets (image système, JDK, Maestro, chaîne Gradle pour
compiler l'application native). La marche à suivre est dans
[`apps/mobile/e2e/README.md`](../apps/mobile/e2e/README.md).

Tant que ce passage n'a pas eu lieu, ces fichiers ne sont pas une couverture
acquise — seulement un travail préparatoire vérifié.

## 3. Contrats de réponse — catégorie fermée ✅

Les quatre clients déclaraient à la main ce qu'ils croyaient recevoir, sans lien de compilation
avec les routes. Le mécanisme qui ferme la catégorie est en place dans
`packages/shared/src/contracts/` :

```ts
// route
return c.json({ success: true, data: { … } satisfies StateStockData, requestId });
// client
this.request<StateStockData>('/api/v1/state/stock');
```

`satisfies` fait échouer la compilation de l'API si un champ manque ou change de nom ; le client
importe le **même** type. Vérifié en renommant volontairement un champ : l'API ne compile plus.

**Couvert (44 endpoints)** — tous ceux dont un écran lit la réponse : le **chemin de l'argent**
(portefeuille, transactions, dépôt, retrait, cours, devis, achat, vente) ; la **location**
(conditions, positions, relevé quotidien, sortie) ; les **frais de garde** ; le **portail État**
(tableau de bord, stock, preuve de réserve, rapport mensuel) ; le **profil utilisateur**, le
**statut KYC**, les **préférences de notification** et les **alertes de prix** ; le **back-office**
(tableau de bord, stock, permissions) ; l'**authentification** (inscription, connexion par les
trois chemins, rafraîchissement, sessions, configuration 2FA) ; l'**analytique**
(temps réel, historique, règles d'alerte, alertes) et les **journaux** (recherche, détail,
statistiques).

Sept défauts réels sont sortis de cette couverture, tous invisibles au compilateur avant elle.
Les journaux, eux, étaient déjà justes : leur service déclarait ses formes de retour, et le client
les avait recopiées fidèlement. Le gain n'y est pas une correction mais la suppression de la
recopie — trois formes de moins qui puissent diverger plus tard.

> **Cas particulier des relais.** Une route qui fait `await response.json()` ne construit pas sa
> reponse : `satisfies` n y prouverait rien. Deux consequences apprises a nos depens : le contrat
> s applique a la SOURCE (l interface du Durable Object EST le type partage), et la route doit
> **deplier l enveloppe** que la source ajoute — un cast `as Contrat` sur la reponse entiere fait
> acquiescer le compilateur a une contre-verite.

> Hono expose un client typé (`hc<AppType>`) qui supprimerait la déclaration manuelle. Il exige
> des routes **chaînées** (`app.get().post()`) pour inférer ; celles-ci sont écrites en
> instructions séparées, donc l'adopter voudrait dire réécrire 159 endpoints. À reconsidérer lors
> d'une refonte, pas avant.

## 4. Alertes opérationnelles sans destinataire 🟠

`durable-objects/analytics-hub.ts` déclenche des alertes, les diffuse en WebSocket et les
journalise. Aucune n'est envoyée par email, SMS ou webhook — donc **personne n'est prévenu
quand aucun tableau de bord n'est ouvert**.

Le blocage n'est pas la plomberie : `NotificationService` existe. C'est qu'**aucun destinataire
d'alerte d'exploitation n'est configuré**. Câbler l'envoi sans savoir vers qui produirait une
fonctionnalité morte de plus, exactement le motif que cet audit a déjà trouvé trois fois (push
mort, notifications in-app mortes, crons jamais déclarés).

À décider avant de coder : qui reçoit, par quel canal, et à partir de quelle sévérité.

## 5. Recouvrement des frais de garde 🟡

Un arriéré n'empêche ni de vendre ni de retirer. Aucune relance, aucune pénalité, aucun
blocage ([ADR 005](adr/005-frais-de-garde-impayes.md)). Le back-office sait désormais qui doit
quoi (`/admin/storage-fees/outstanding`), ce qui est le minimum ; la suite est une décision à
prendre avec le juridique, pas dans un job.

## 6. Volume de l'export État 🟡

`/state/reports/data/export` est plafonné à 100 000 lignes et désormais tracé
(`action=STATE_EXPORT`). Tracer rend l'exfiltration visible ; **borner** est un autre débat, et
il est maintenant instruit : on sait qui exporte combien.

## 7. QR du certificat mobile rendu par un tiers 🟡

`apps/mobile/app/(wallet)/certificate.tsx` fait dessiner le QR du certificat par
`api.qrserver.com`, en lui transmettant l'URL de vérification — donc le code de
vérification du certificat. Les trois écrans d'enrôlement à double facteur, qui
faisaient la même chose avec la **graine TOTP**, ont été corrigés ; celui-ci ne
l'a pas été, et c'est délibéré :

- ce qui fuit est un code de vérification public, pas un secret d'authentification ;
- retirer l'image dégraderait une vraie fonctionnalité — un certificat imprimé a
  besoin d'un code scannable, là où un lien `otpauth://` suffisait pour la 2FA.

Le corriger demande une bibliothèque de rendu QR embarquée (`react-native-qrcode-svg`
ou équivalent), donc une dépendance de plus : à arbitrer, pas à trancher en passant.

## 8. Doublon de vitrine 🔵

`apps/landing` et `apps/web/src/pages/landing/` coexistent. À trancher : deux vitrines à
maintenir, ou une seule.

## 9. Restes ponctuels 🔵

- `services/analytics.service.ts` — les tailles de requête et de réponse valent `0` quand
  `Content-Length` est absent (réponse en flux). Documenté comme « inconnu », pas comme
  « zéro octet ».
- Le portail État ne voit pas ses propres traces d'export. Défendable — on ne laisse pas un
  audité tenir son journal — mais c'est une décision de gouvernance, pas un manque technique.

---

## Ce qui a été livré depuis la version précédente de ce document

Pour éviter qu'on les reprenne : filière producteur sur mobile (dépôt KYB, lot, photos, GPS,
suivi), écrans de transactions et de vérification, traçabilité et lien `/reserve` au portail
État, certificat en **PDF**, export Proof of Reserve en PDF, pins SSL de production déclarés une
seule fois avec garde de publication, ancrage on-chain des attestations, location d'or complète,
répartition d'un lot, frais de garde, multi-pays.

---

## Tests

| Paquet | Tests | Couvre |
|---|---|---|
| `packages/api` | 616 | Services métier, atomicité, invariants, routes privilégiées |
| `packages/shared` | 310 | Validateurs, calculs, règles de location et de répartition |
| `apps/web` | 34 | Hooks et vérification d'attestation |
| `apps/mobile` | 29 | Formatage, épinglage SSL, garde de publication |
| `apps/state-portal` | 0 | — |

26 tests d'`auth.service.test.ts` ne s'exécutent pas : le binding wasm d'argon2 fait tomber le
worker de test sous Node 24. Problème d'environnement de test, pas de code de production.

---

## Configuration — rend des fonctionnalités inertes

Inchangé : les mentions ⚙️ de [FONCTIONNALITES-IMPLEMENTEES.md](FONCTIONNALITES-IMPLEMENTEES.md)
ne sont pas du développement restant. Pour savoir où en est un déploiement donné :

```bash
node scripts/readiness.mjs --url <api> --token <jwt admin>
```

Le rapport couvre désormais l'ancrage, les trois jobs quotidiens, les pays ouvrables et la
fraîcheur du prix — il avait décroché du produit et ne le fait plus.
