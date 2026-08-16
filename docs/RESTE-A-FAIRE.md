# Ce qui reste à implémenter — 16 août 2026

Audit d'état après la session de remédiation. Complète [AUDIT-2026-08-15.md](../AUDIT-2026-08-15.md)
(défauts) : ce document-ci recense les **manques fonctionnels**, pas les bugs.

## État par application

| Application | Surface | Verdict |
|---|---|---|
| `packages/api` | 13 modules de routes | Le plus mature — c'est l'inverse de la répartition habituelle |
| `apps/admin` | 18 écrans | Complet |
| `apps/web` | 12 pages + auth + landing | Complet |
| `apps/mobile` | 4 onglets, KYC, sécurité, portefeuille | **Incomplet — voir 1 et 2** |
| `apps/state-portal` | **4 écrans** (Login, Dashboard, Stock, Reports) | **Le plus pauvre — voir 3** |

Le déséquilibre est net : le backend sait faire des choses que deux frontends sur quatre
n'exposent pas.

---

## 1. Filière producteur absente du mobile 🔴

`apps/web` a `ProducerConsignments` et `ProducerProfile`. `apps/mobile` n'a **aucun** écran
producteur. Un orpailleur ou une coopérative doit donc passer par un navigateur pour déclarer
un lot.

C'est le manque le plus contradictoire du produit : la consignation est le cas d'usage
**terrain** par excellence — photos du lot, GPS de l'origine, connectivité faible, souvent hors
d'un bureau. C'est précisément là que le mobile a un avantage sur le web, et c'est le seul
endroit où il n'existe pas.

À construire : dépôt de dossier KYB, soumission de lot avec appareil photo natif et GPS, suivi
d'état, et le crédit en tokens à la validation d'audit.

## 2. Écrans manquants sur mobile 🟠

Présents sur le web, absents du mobile : historique des **transactions**, **analytics**,
vérification de **certificat**, vérification de la **réserve**. Le mobile s'arrête à quatre
onglets (accueil, marché, portefeuille, profil).

L'historique des transactions est le plus gênant : c'est là qu'un producteur verrait sa ligne
`CONSIGNMENT`.

## 3. Portail État squelettique 🟠

Quatre écrans, dont un login. Deux manques concrets :

- **Aucune traçabilité des lots**, alors que le RBAC accorde déjà `consignments: ['view','export']`
  au rôle `STATE_OPERATOR`. La permission existe, l'écran non — l'État peut voir le stock agrégé
  mais pas d'où il vient.
- **Aucun lien vers `/reserve`**, la page de vérification publique des attestations. C'est
  pourtant l'audience naturelle de cette page : un ministère qui veut vérifier la couverture.

## 4. Certificat en HTML, export PoR en JSON 🟡

`certificate.service.ts:111` sert du `text/html`. Un certificat de propriété d'or destiné à être
imprimé, archivé ou présenté à un tiers devrait être un PDF signé. Même remarque pour l'export
Proof of Reserve, aujourd'hui du JSON.

## 5. Pins SSL de production vides 🟡

`apps/mobile/lib/ssl-pinning.ts` : le tableau de `bf-api.tnc.trading` ne contient que des
commentaires. Staging et dev ont de vrais pins Cloudflare. **Bloquant avant tout build mobile
public** — sans pins, le pinning ne protège rien.

## 6. Ancrage on-chain des attestations 🟡

Phase 1 de l'[ADR 002](adr/002-smart-contracts.md) livrée sauf l'ancrage lui-même, en attente de
la décision de chaîne. `recordAnchor()` est prêt et idempotent, l'endpoint public expose déjà les
champs. Il ne manque que l'adaptateur.

## 7. Doublon probable de landing page 🔵

`apps/landing` (4 fichiers) et `apps/web/src/pages/landing/` coexistent. À trancher : deux
vitrines à maintenir, ou une seule.

## 8. Restes ponctuels 🔵

- `durable-objects/analytics-hub.ts:563` — TODO : file de notification jamais câblée.
- `services/analytics.service.ts:180-181` — tailles de requête/réponse codées à `0`.

---

## Tests

| Périmètre | État |
|---|---|
| `packages/api` | 387 tests — solide |
| `packages/shared` | 285 tests — solide |
| `apps/web` / `apps/admin` | 2 fichiers chacun + E2E Playwright (auth, kyc, marketplace, profile) |
| `apps/state-portal` | **0 test** |
| `apps/mobile` | **0 test**, et aucun harnais E2E (ni Detox ni Maestro) |
| `packages/ui` | **0 test** |

Les parcours ajoutés récemment — consignation, KYB, paiement producteur — **n'ont pas de test
E2E**. Ils sont couverts au niveau service, pas au niveau parcours utilisateur.

## Dette technique

| # | Sujet |
|---|---|
| D1 | Dérive de version Biome : le dépôt n'est pas *format-clean* sous la version installée, l'étape « Format check » de la CI échoue. À traiter en épinglant la version puis en reformatant dans un commit dédié |
| D2 | `packages/api/tsconfig.json` déclare `"strict": true` puis le neutralise avec `"strictNullChecks": false`. Dans un code financier, c'est la vérification la plus utile qui est désactivée |
| D3 | `packages/api` n'a **aucun script `lint`** — il n'est jamais passé par `turbo lint` |
| D4 | `pnpm audit` non bloquant. Recommandation : bloquant sur les dépendances de production uniquement |

## Configuration — rend des fonctionnalités inertes

Ce n'est pas du développement, mais sans ça le code livré ne sert à rien.

| Clé | Sans elle |
|---|---|
| `admin_ip_allowlist`, `state_ip_allowlist` | **Aucun rempart réseau** devant les portails (Access n'est pas utilisé) |
| `fcm_service_account` | Push inerte |
| `ATTESTATION_SIGNING_JWK` + cron `30 0 * * *` | Aucune attestation publiée |
| Clés providers (paiement, KYC, prix) | Chaque intégration reste désactivée |
| `SENTRY_DSN` + canal d'alerte | Aucune remontée d'incident |

---

## Ordre proposé

1. **Configuration** — le moins de travail pour le plus d'effet : elle active des fonctionnalités déjà écrites et testées.
2. **Filière producteur sur mobile** (1 et 2) — le seul gros morceau produit restant, et le cas d'usage qui justifie le projet.
3. **Portail État** (3) — après avoir des consignations réelles à montrer, comme convenu.
4. **Pins SSL** (5) — avant tout build mobile public, donc juste avant la mise en magasin.
5. **Dette technique** (D1–D4) et **certificats PDF** (4) — quand le produit est stabilisé.
