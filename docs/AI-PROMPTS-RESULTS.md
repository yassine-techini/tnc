# Application des 10 prompts au projet TNC — Résultats

> Résultats de la première exécution des prompts de [`AI-PROMPTS.md`](./AI-PROMPTS.md) sur le code actuel
> (branche `audit/security-correctness-remediation`). Date : 2026-07-04.
> Certains prompts recoupent l'audit déjà mené (voir [`../AUDIT.md`](../AUDIT.md)) ; on note ici le **delta** et les constats neufs.

**Synthèse en une phrase :** le socle est solide (revue prod notée **B+**), mais la **lacune n°1 est que les tests backend s'exécutent contre un D1 mocké** — l'atomicité `db.batch`/rollback qui protège les flux financiers n'est donc prouvée par aucun test.

---

## 1. Construire une spec — ⏭️ non applicable (pas de nouvelle feature)
Prompt destiné au démarrage d'une fonctionnalité. Conservé comme gabarit pour les prochains chantiers (staking, parrainage, nouveau PSP…). Rien à produire sur l'existant.

## 2. Tests UI / composants — 🔴 lacune importante
- `apps/mobile` : **0 test** (aucun runner configuré) — 32 écrans/libs non couverts (login, 2FA, achat, retrait, KYC caméra, SSL pinning, `stores/auth`, `lib/validation`).
- `apps/web` / `apps/admin` : surtout **e2e Playwright (parcours heureux)** + un seul test unitaire (`apps/web/src/hooks/useForm.test.ts`). Composants critiques non testés unitairement : confirmation d'ordre, conversion montant g↔XOF, P&L wallet, formulaire retrait.
- `apps/state-portal` : **aucun test**.
- **À faire :** amorcer Jest/RNTL (ou Maestro) sur mobile en commençant par `lib/validation` + `stores/auth` + écrans login/2FA/withdraw ; ajouter des tests composant Vitest+RTL sur les écrans monétaires web/admin.

## 3. Tests manquants + nettoyage du commit — 🟢 propre
- **`console.log`** du backend = **logging structuré légitime** (préfixés `[Job]`/`[Auth]`/`[PriceRefresh]`…), utiles à l'observabilité Workers — pas des restes de debug.
- **TODO restant** : `durable-objects/analytics-hub.ts:563` (notification analytics email/SMS non câblée) — seul vrai TODO en code de prod.
- **Code mort déjà supprimé** dans les commits récents : job `price-alerts` non câblé, 9 tests « théâtre ». Aucun commentaire gênant / incohérent détecté.
- **Tests manquants :** voir §10 (le plus impactant : harnais D1 réel).

## 4. Permissions mobile (Expo) — 🟢 minimales, 2 nuances
Déclaré vs utilisé (`apps/mobile/app.json` + code) :

| Permission | Déclarée | Réellement utilisée | Verdict |
|---|---|---|---|
| Biométrie (`USE_BIOMETRIC`, iOS `NSFaceIDUsageDescription`, plugin `expo-local-authentication`) | ✅ | ✅ login + écran sécurité | OK |
| Caméra (`CAMERA`, iOS `NSCameraUsageDescription`, plugin `expo-camera`) | ✅ | ✅ KYC | OK |
| `USE_FINGERPRINT` (Android) | ✅ | héritée (legacy API &lt; 28) | 🟡 redondante avec `USE_BIOMETRIC` — tolérable pour compat |
| Notifications (`POST_NOTIFICATIONS` Android 13+) | ❌ | feature push présente mais **non câblée** | 🟡 cohérent avec push non finalisé ; à déclarer **quand** le push sera activé |

- **Pas de bloatware** : aucune permission déclarée inutilisée.
- **SSL pinning** (`plugins/withSSLPinning`, `lib/ssl-pinning.ts`) : pins présents pour `bf-api.tnc.trading` ; à revalider avant build EAS prod (`reportPinningFailure` reste à implémenter, cf. AUDIT.md).

## 5. Revue de code stricte A→F — 🟡 Note : **B+**
Constats neufs (non couverts par l'audit précédent) :

| # | Sévérité | Constat | Fichier | Correctif |
|---|---|---|---|---|
| M1 | Majeur | Classification d'erreur financière par **string-match** du message D1 (`includes('cash_balance')`…) — format non stable | `wallet.service.ts` `classifyTradeError` | Faire précéder le batch d'un `UPDATE … WHERE cash_balance >= ?` conditionnel (`meta.changes===0` = raison déterministe), CHECK en filet ; ou CHECK nommés |
| M2 | Majeur | **TOCTOU** sur la limite de retrait journalière : `SUM(...)` puis INSERT hors même transaction → plafond KYC franchissable par course (le retrait n'a pas le lock DO de buy/sell) | `routes/wallet.ts` | Protéger `/withdraw` par le même lock Durable Object par-utilisateur, ou intégrer le plafond comme condition SQL dans le batch |
| m1 | Mineur | Devis marqué `USED` avant le batch : sur `CONFLICT`, le devis reste consommé → « réessayez » trompeur | `routes/market.ts` | Sur `CONFLICT`, remettre le devis en `PENDING` avant le 409 |
| m2 | Mineur | Anti-rejeu TOTP **fail-open** sur erreur KV — défendable pour users, discutable pour le **login admin** | `security.service.ts` | Comportement paramétrable (fail-closed admin) + alerte |
| N1 | Note | `WHERE id = '${GOLD_STOCK_ID}'` par interpolation (sûr car constante, mais anti-pattern) | `market.service.ts` | Utiliser `.bind(GOLD_STOCK_ID)` |
| N3 | Dette | `strictNullChecks:false` sur une base fintech (force le type `TradeResult` non-discriminé) | `packages/api/tsconfig.json` | Activer `strictNullChecks` à terme |

**Points jugés excellents** par la revue : migration vers `db.batch` atomique adossé aux CHECK réels ; crédit du montant **net dérivé de la DB** (jamais du webhook) ; `isProviderEnabled` fail-closed ; setup gated par `SETUP_SECRET` ; correction de `checkPasswordHistory` ; époque d'invalidation de token ; chiffrement TOTP au repos.

## 6. Compromis (trade-offs) des choix de remédiation — ℹ️
- **`db.batch` + CHECK constraints** (atomicité) : ✅ tout-ou-nothing sans verrou applicatif, invariants garantis par la base ; ⚠️ dépend du format d'erreur D1 pour distinguer les causes (cf. M1), et le batch ne couvre pas les plafonds réglementaires hors-batch (cf. M2).
- **Époque d'invalidation (`tokens_invalid_before`)** vs table de refresh tokens : ✅ révocation immédiate, stateless, 1 colonne ; ⚠️ granularité **par utilisateur** (pas par appareil) — un logout révoque tous les appareils.
- **Anti-rejeu TOTP via KV** : ✅ simple, TTL auto ; ⚠️ fail-open sur panne KV (fenêtre 30–90 s).
- **CSP `imgSrc 'self' data:`** : ✅ durcissement ; ⚠️ bloquerait des images servies depuis un domaine tiers (R2) — à valider avant prod.
- **Spread live** (recalcul au devis) : ✅ un changement de spread s'applique immédiatement ; ⚠️ légère charge config supplémentaire par devis (négligeable, caché).

## 7. Checklist de revue haut-risque pour la stack — ✅ (à réutiliser en PR)
Zones à auditer manuellement sur **Cloudflare Workers + Hono + D1 + React/Expo** :
- [ ] **JWT** : algo HS256 fixé (pas `alg:none`), payload validé (Zod), `type` access/refresh vérifié, expiration + révocation (epoch) testées.
- [ ] **D1** : aucune concaténation SQL (uniquement `.bind()`), écritures multi-lignes dans un `db.batch`, invariants en contraintes `CHECK`, `meta.changes` vérifié sur les UPDATE conditionnels.
- [ ] **Webhooks** : signature HMAC **constant-time** obligatoire, montant re-dérivé de la DB (jamais du payload), idempotence par état final + `meta.changes`.
- [ ] **Secrets** : jamais en dur, entropie validée au boot, séparation dev/staging/prod, pas de secret réutilisé à double usage.
- [ ] **KV/cache** : décider fail-open vs fail-closed **explicitement** par usage (rate-limit fail-closed sur endpoints sensibles ; anti-rejeu ?).
- [ ] **RBAC** : `requirePermission` sur chaque route admin, scoping par `userId` du token (anti-IDOR).
- [ ] **React** : pas de token en `localStorage` (cookies httpOnly), `credentials:'include'`, pas de `dangerouslySetInnerHTML` non assaini.
- [ ] **Expo** : permissions minimales + demande runtime + gestion du refus ; SSL pinning prod.

## 8. Regard neuf par itération — ✅ convergence
Deux agents **indépendants** (revue A→F et analyse DAG) ont été lancés en sessions séparées (« yeux neufs »). Convergence sur les points forts (atomicité, webhooks). L'analyse DAG a apporté le constat **unique et le plus important** que la revue A→F n'avait pas isolé : **les tests valident l'atomicité contre un mock** (cf. §10) → le filet de sécurité réel n'est pas exercé.

## 9. Revue IA de chaque PR — ✅ scaffold livré
Workflow ajouté : [`.github/workflows/ai-pr-review.yml`](../.github/workflows/ai-pr-review.yml). **Inactif par défaut** ; s'active en posant la variable `AI_PR_REVIEW_ENABLED=true` et le secret `GEMINI_API_KEY`. Poste une revue priorisée en commentaire de PR (premier passage avant relecteur humain).

## 10. Analyse DAG des tests — 🔴 lacune P0 structurelle
**Constat dominant :** `packages/api/test/setup.ts` mocke entièrement D1 (`batch: vi.fn()` no-op, `run()` → `{changes:1}`, aucun `CHECK`). Donc l'atomicité/rollback/invariant — cœur de la remédiation — **n'est validée par aucun test**.

**Les 6 tests manquants les plus critiques (P0) :**
1. **Harnais d'intégration Miniflare D1 réel** — charger `migrations/0001_initial_schema.sql` (avec les CHECK) dans une D1 Miniflare (déjà en devDependency) et y router les tests trading/retrait/webhook. **Prérequis à tous les autres.**
2. **`executeBuyAtomic` rollback tout-ou-rien** (solde insuffisant → wallet/gold_stock/transactions strictement inchangés ; reason `INSUFFICIENT_BALANCE`) ; symétrique vente.
3. **Invariant de stock sous concurrence** (2 achats de 1g sur 1g dispo → exactement un réussit, `tokens_issued <= total_allocated` toujours vrai).
4. **Idempotence webhook = crédit exactement une fois** (rejeu du même SUCCESS → crédit net une seule fois ; 2e appel `alreadyProcessed`).
5. **Révocation par epoch** (unitaire, sans DB) : `refreshAccessToken(token, invalidBefore)` — `iat < epoch` → `null`, sinon nouvelle paire.
6. **Débit atomique du retrait + double-retrait concurrent** (un seul débite, pas de solde négatif, exerce la branche `catch → INSUFFICIENT_BALANCE`).

**Puis (P1) :** anti-rejeu TOTP sur la route `/login` ; `admin.patch(/withdrawals/:id)` (reject→recrédit, payout échoué→FAILED) ; `KycService.processCallback` (transitions de niveau) ; routes `webhooks.ts` (401 signature, `sanitizeAmount`) ; amorcer les tests mobile.

**Note de cohérence :** `PaymentService.isProviderEnabled` = fail-**closed**, `KycService.isProviderEnabled` = fail-**open** — asymétrie à figer par un test.

---

## Actions recommandées (issues de l'application des prompts)

| Priorité | Action | Prompt |
|---|---|---|
| **P0** | Harnais Miniflare D1 réel + les 6 tests d'atomicité/idempotence/epoch | #10, #3 |
| **Haut** | Verrou DO (ou condition SQL) sur le retrait pour fermer le TOCTOU du plafond (M2) | #5 |
| **Haut** | Rendre déterministe la classification d'erreur de trade (M1) | #5 |
| Moyen | Restaurer le devis en `PENDING` sur `CONFLICT` (m1) | #5 |
| Moyen | Amorcer les tests mobile (0 aujourd'hui) | #2 |
| Bas | `.bind(GOLD_STOCK_ID)` (N1) ; envisager `strictNullChecks` (N3) | #5 |

_Prompts adaptés à partir de l'article Google Cloud « 10 indispensable prompts our team refuses to build without »._
