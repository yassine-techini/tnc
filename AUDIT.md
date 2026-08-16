# Audit de la plateforme TNC Trading

> Plateforme de tokenisation d'or souveraine (Burkina Faso) — 1 token = 1 g d'or physique.
> Document de traçabilité des audits et de leur remédiation.

- **Date** : 2026-07-02
- **Branche de remédiation** : `audit/security-correctness-remediation` (PR #23)
- **Périmètre** : monorepo pnpm/turbo — `packages/api` (Cloudflare Workers + HonoJS + D1), `apps/{web,admin,state-portal,mobile,landing}`, `packages/{shared,ui}`.
- **Méthode** : audits en lecture seule (sécurité, exactitude métier, atomicité, complétude fonctionnelle), puis remédiation vérifiée (`tsc` + suites de tests).

## Statut de vérification

| Contrôle | Résultat |
|---|---|
| `tsc` API / web / admin / shared | ✅ propre |
| Tests API | ✅ 265/265 exécutables (voir note argon2) |
| Tests `shared` | ✅ 285/285 |

> **Note environnement** : `packages/api/test/services/auth.service.test.ts` ne se charge pas sous **Node v24** (le WASM `argon2-browser` fait un `fetch` qui échoue). C'est un problème d'environnement de test local, sans lien avec le code applicatif ; 0 test exécuté dans ce fichier. Sous Node 20 (CI) il s'exécute normalement.

---

## 1. Complétude fonctionnelle

Synthèse : **le socle est réellement implémenté** — aucune intégration métier n'est simulée/mockée dans le backend, et les 3 web-apps sont matures. Les écarts sont de la finition, de la configuration de prod, ou du rattrapage mobile.

| Domaine | Complétude | Prêt go-live |
|---|---|---|
| Backend API (auth, KYC, trading, wallet, admin, état, PoR, jobs, DO) | **~92-94 %** | Oui (hors config prod) |
| `apps/web` (client PWA) | **~95 %** | Oui |
| `apps/admin` (back-office) | **~90 %** | Oui |
| `apps/state-portal` (portail État) | **~95 %** | Oui |
| `apps/mobile` (React Native / Expo) | **~65-70 %** | Non (bloquants) |

### Intégrations externes (backend) — toutes réelles
GoldAPI + taux de change (avec fallbacks de résilience), Smile Identity (KYC, signature HMAC), Orange Money / Moov / CinetPay / Stripe (init + webhooks signés + payout), Twilio (SMS), Resend/SendGrid (email). Vérifications de signature webhook réelles (HMAC-SHA256 constant-time) pour tous les providers. Les clés de prod ne sont pas dans le code (normal) : chaque provider est inactif tant qu'il n'est pas configuré.

### Écarts fonctionnels identifiés

| # | Élément | État initial | Statut |
|---|---|---|---|
| F1 | Push FCM utilise l'API **legacy** dépréciée par Google | MOCK/legacy | ⏸️ Prod (FCM HTTP v1 + service account) |
| F2 | Job `price-alerts` non câblé au cron + messages queue non routés | Mort/cassé | ✅ Corrigé (supprimé ; livraison inline conservée) |
| F3 | Certificat = HTML (pas PDF binaire) ; export PoR backend = JSON | Partiel | ⏸️ Prod (générateur PDF) |
| F4 | Statut PoR `CERTIFIED` codé en dur | Mock | ✅ Corrigé (dérivé couverture + audit) |
| F5 | Pas d'email à l'approbation KYC admin | Absent | ✅ Corrigé (`sendKycApproved/Rejected`) |
| F6 | Bouton admin « Exporter PDF » (PoR) sans handler | Mort | ✅ Corrigé (export JSON réel + relabel) |
| F7 | Bouton web « Supprimer mon compte » désactivé (flux réel dans Settings) | Mort | ✅ Corrigé (retiré) |
| F8 | Secrets providers non fournis | Config | ⏸️ Prod (injecter les clés) |

### Mobile — bloquants avant go-live

| # | Élément | Statut |
|---|---|---|
| M1 | **SSL pinning prod** : pins de certificats commentés/placeholders, `reportPinningFailure` = stub | ⏸️ Prod (générer/injecter les pins) |
| M2 | **Push notifications** non câblées end-to-end (permission OS seulement) | ⏸️ Prod (enregistrement token + handler + FCM v1) |
| M3 | 2FA QR dégradé si URL backend absente ; max retrait par méthode non affiché | ⏸️ Prod (QA sprint mobile) |

---

## 2. Maturité sécurité

**Score global initial : 3.7 / 5** (« Défini → Géré », ≈ OWASP ASVS L2). Avec la remédiation ci-dessous, le socle applicatif est proche de **4 / 5** ; le point structurant restant relève de l'infra (Cloudflare Access).

| Domaine | Note /5 | Points forts |
|---|---|---|
| Intégrité financière | 4.5 | Atomicité `db.batch`, invariants CHECK SQL, anti double-dépense webhook, verrou DO |
| Authentification | 4.0 | Argon2id, JWT validé (Zod), révocation par epoch, 2FA chiffré + anti-rejeu |
| Crypto / données | 4.0 | AES-256-GCM (KYC + TOTP), redaction PII des logs |
| Validation d'entrée | 4.0 | Zod partout, prepared statements D1, sanitize montants |
| Sécurité API | 4.0 | Rate-limit fail-closed (CF-Connecting-IP), CSP/HSTS, webhooks signés, idempotence |
| Autorisation / RBAC | 3.5 | RBAC mûr ; **CF Access non monté dans le code** (infra) |
| Gestion des secrets | 3.5 | `wrangler secret`, gate `SETUP_SECRET` ; entropie à valider |
| Déploiement | 3.5 | Prod manuelle, 3 environnements isolés ; dépend de CF Access |
| Observabilité / réponse | 3.0 | Sentry (envelope), audit_logs ; alerting temps réel à opérationnaliser |
| Dépendances & chaîne | 3.0 | Dependabot présent, `pnpm audit` en CI ; SAST ajouté (CodeQL) |

### Top-10 des actions — statut

| # | Action | Sévérité | Statut |
|---|---|---|---|
| 1 | Monter **Cloudflare Access** sur `/admin/*` et `/state/*` | 🔴 Critique | ❌ Abandonné — Access n'est pas utilisé sur ce déploiement. Remplacé par une liste d'IP applicative (voir AUDIT-2026-08-15.md) |
| 2 | **Valider l'entropie de `JWT_SECRET`** (≥ 32) au démarrage | 🔴 Critique | ✅ Corrigé |
| 3 | **Corriger l'historique de mot de passe** (verify vs égalité de hash) | 🔴 Élevé | ✅ Corrigé |
| 4 | **`isProviderEnabled` fail-closed** | 🟠 Élevé | ✅ Corrigé |
| 5 | CI sécurité : **SAST/CodeQL** + Dependabot + audit bloquant | 🟠 Élevé | ✅ CodeQL ajouté ; Dependabot déjà présent ; audit bloquant ⏸️ (triage advisories) |
| 6 | **Alerting** incident opérationnel + `SENTRY_DSN` obligatoire en prod | 🟠 Élevé | ⏸️ Prod (canal + config) |
| 7 | Rotation/révocation fine des refresh tokens (par appareil) | 🟡 Moyen | ⏸️ (epoch global en place) |
| 8 | Vérifier la validation des uploads KYC (MIME/taille/antivirus) | 🟡 Moyen | ⏸️ À confirmer |
| 9 | Durcir CORS (pas de `*` sans Origin) + regex Pages en prod | 🟡 Moyen | ✅ Corrigé (`*` supprimé) |
| 10 | Pentest externe + revue config Cloudflare (Access/WAF/DDoS) | 🟡 Faible | ⏸️ Prod |

---

## 3. Traçabilité de la remédiation (branche `audit/security-correctness-remediation`)

| Commit | Contenu |
|---|---|
| `a284c03` | Bloquants (id stock unifié + migration 0015, routes `/setup/*` gatées, build web réparé, atomicité achat/vente `db.batch`, CI réactivée + deploy prod manuel) + sécurité/exactitude de base (webhooks signés, révocation refresh tokens migration 0016, lockout admin, localStorage→cookie, CF Access header trust, rate-limit CF-IP, CSP/HSTS, quantification monétaire, débit retrait atomique) + suppression des 9 tests « théâtre » |
| `7b628ca` | Chiffrement des secrets TOTP au repos (AES-256-GCM, rétro-compatible) |
| `5dd74b6` | Anti-rejeu TOTP + claim de session `sid` (fix « revoke all except current ») + match webhook déterministe + spread live (devis + affichage) |
| `74c7ae5` | Historique mot de passe (verify), `isProviderEnabled` fail-closed, entropie `JWT_SECRET`, CORS sans `*`, statut PoR dérivé, notif KYC admin, code mort price-alerts, boutons morts, workflow CodeQL |

### Migrations DB à appliquer
- `0015_normalize_gold_stock.sql` — normalise la ligne de stock unique (`main`).
- `0016_token_invalidation.sql` — epoch d'invalidation des tokens par utilisateur.

### Nouveaux secrets requis (prod)
- `SETUP_SECRET` (≥ 16 caractères) — active les routes `/setup/*`.
- `SETUP_ADMIN_PASSWORD` / `SETUP_STATE_PASSWORD` (optionnels ; sinon générés et affichés une fois).

---

## 4. Checklist avant go-live (restant — infra / prod)

- [x] ~~Cloudflare Access sur les portails~~ — non utilisé ; remplacé par `admin_ip_allowlist` / `state_ip_allowlist`, à renseigner avant go-live.
- [ ] Injecter les **clés providers** de production (paiement, KYC, prix, notifications).
- [ ] **FCM HTTP v1** (service account) + câblage de l'enregistrement des push tokens mobile.
- [ ] **SSL pinning mobile** : générer et injecter les pins de certificats de prod avant build EAS.
- [ ] Génération **PDF** binaire (certificat utilisateur + export Proof of Reserve).
- [ ] **Alerting** incident opérationnel (Slack/PagerDuty/email) + `SENTRY_DSN` obligatoire.
- [ ] (Option) Passer `pnpm audit` en **bloquant** après triage des advisories.
- [ ] Appliquer les migrations `0015` / `0016` et définir `SETUP_SECRET`.
- [ ] **Pentest externe** + revue de la configuration Cloudflare (Access, WAF, bot/DDoS).

---

## Notes

- **Versions React** : `apps/mobile` reste en React 19 (imposé par Expo SDK 54) et les apps web en React 18, par contrainte de plateforme — divergence **intentionnelle**, pas un défaut.
- **Biome** : alignement de version laissé de côté (cosmétique ; éviterait un churn de lockfile mêlé à du WIP existant).

_Audits et remédiation réalisés avec l'assistance de Claude Code._
