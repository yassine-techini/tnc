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

### L. Traiter un retrait échoue 🔴

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

### M. Valider un dossier KYC depuis l'écran de revue échoue 🔴

Trois colonnes inexistantes — `verification_status`, `verification_job_id`,
`verification_result` — sont utilisées dans **douze instructions SQL vivantes**
(`admin.ts`, `kyc.service.ts`, `webhooks.ts`). La table `kyc_documents` porte `status`,
`provider_job_id` et `provider_result`.

Les deux plus graves : `POST /admin/kyc/:id/review` (validation et rejet) et
`GET /admin/kyc/:id` (détail d'un dossier). `KycReview.tsx` appelle les deux.

Un chemin parallèle fonctionne — `PATCH /users/:id/kyc` écrit `users.kyc_status`, avec
les bonnes colonnes — donc la plateforme n'est pas entièrement bloquée. Mais **l'écran
dédié à la revue KYC l'est**, ainsi que le rappel du fournisseur d'identité.

### N. La connexion sans mot de passe échoue 🔴

`auth.ts` écrit dans une table `refresh_tokens` **qui n'existe dans aucune migration** :

- `INSERT INTO refresh_tokens (…)` dans `POST /auth/passwordless/verify`, appelé par le
  mobile **et** le web ;
- `DELETE FROM refresh_tokens WHERE user_id = ?` dans deux blocs de révocation de session,
  au sein d'un `Promise.all` — l'échec d'une branche fait échouer l'ensemble.

L'insertion est inconditionnelle et se situe avant la création de session : la connexion
sans mot de passe ne peut pas aboutir.

### Pourquoi trois audits ne l'avaient pas vu

Chacun regardait une frontière différente — spécification/code, API/clients,
clients/API. Aucun ne regardait **code/base**. Une requête SQL est une chaîne de
caractères : elle traverse le typage, les contrats partagés et les tests d'écran sans
que rien ne la confronte au schéma.

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
