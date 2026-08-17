# Ce qui reste à implémenter — 17 août 2026

Ce document recense les **manques fonctionnels**, pas les bugs. Il est réécrit après les
phases 0 à 5 : la version précédente datait d'avant et aurait envoyé quelqu'un refaire du
travail déjà livré, ce qui est le principal danger d'un backlog qu'on ne tient pas.

## État par application

| Application | Surface | Verdict |
|---|---|---|
| `packages/api` | 13 modules de routes, 616 tests | Le plus mature |
| `apps/admin` | 19 écrans | Complet |
| `apps/web` | 13 pages + auth + vitrine | Complet |
| `apps/mobile` | 4 onglets + producteur + location + répartition, 29 tests | Fonctionnellement complet ; **aucun test de composant** |
| `apps/state-portal` | 5 écrans | Suffisant pour l'usage ; **aucun test d'écran** |

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

## 2. Tests d'interface 🟠

Deux applications n'ont aucun test d'écran :

- `apps/state-portal` — l'**API** qui l'alimente est couverte (17 tests : lecture seule,
  cloisonnement, confidentialité), c'est-à-dire là où se jouent les propriétés de sécurité.
  Les 5 écrans eux-mêmes ne le sont pas.
- `apps/mobile` — 29 tests sur la logique pure (formatage, règles d'épinglage, garde de
  publication). Les composants et le bout-en-bout sur appareil (Detox ou Maestro) manquent.

Prérequis : installer `jsdom` et `@testing-library/*`, donc une modification du lockfile.

## 3. Contrats de réponse — étendre la couverture 🟠

Les quatre clients déclaraient à la main ce qu'ils croyaient recevoir, sans lien de compilation
avec les routes. Cinq défauts en sont sortis, tous invisibles au compilateur. Le mécanisme qui
ferme la catégorie est en place dans `packages/shared/src/contracts/` :

```ts
// route
return c.json({ success: true, data: { … } satisfies StateStockData, requestId });
// client
this.request<StateStockData>('/api/v1/state/stock');
```

`satisfies` fait échouer la compilation de l'API si un champ manque ou change de nom ; le client
importe le **même** type. Vérifié en renommant volontairement un champ : l'API ne compile plus.

**Couvert (20 endpoints)** : tout le **chemin de l'argent** — portefeuille, transactions, dépôt,
retrait, cours, devis, achat, vente ; la **location** — conditions, positions, relevé quotidien,
sortie ; les **frais de garde** ; le **portail État** — tableau de bord, stock, preuve de réserve,
rapport mensuel ; la **configuration 2FA** et l'**historique de prix**.

**Reste** : les modules `admin` (16 méthodes) et `users` (14), et le gros de `auth` (25). Étendre
est une **addition** — déclarer le contrat, ajouter `satisfies` côté route, remplacer le type en
ligne côté client — jamais une refonte.

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

## 7. Doublon de vitrine 🔵

`apps/landing` et `apps/web/src/pages/landing/` coexistent. À trancher : deux vitrines à
maintenir, ou une seule.

## 8. Restes ponctuels 🔵

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
