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
