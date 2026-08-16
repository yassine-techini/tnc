# Fonctionnalités implémentées — 16 août 2026

Inventaire établi à partir du code, destiné à être confronté ligne à ligne aux promesses du deck.

## Comment lire ce document

Une fonctionnalité peut être écrite, compilée, testée — et malgré tout ne rien faire. Cet audit
en a trouvé plusieurs. Cocher une ligne de deck sur la seule existence du code serait donc
trompeur. Chaque entrée porte un statut :

| Statut | Signification |
|---|---|
| ✅ | Implémenté et vérifié (tests et/ou exécution réelle) |
| ⚙️ | Implémenté, mais **inerte tant qu'une clé de configuration n'est pas fournie** |
| ⚠️ | Implémenté avec une réserve explicite — lire la colonne |
| 🚫 | Non implémenté (voir [RESTE-A-FAIRE.md](RESTE-A-FAIRE.md)) |

**Volumétrie** : 159 endpoints API sur 12 modules, 21 services métier, 21 migrations, 6 jobs
planifiés, 4 Durable Objects, 4 applications front, 706 tests automatisés (387 API, 285 `shared`,
34 web — le mobile et le portail État n'en ont aucun).

---

## 1. Comptes et sécurité

| Fonctionnalité | Statut | Détail |
|---|---|---|
| Inscription, connexion, déconnexion | ✅ | 19 endpoints d'auth |
| Mots de passe Argon2id | ✅ | Migration transparente depuis PBKDF2 hérité |
| 2FA (TOTP) utilisateur | ✅ | Secrets chiffrés au repos (AES-256-GCM), anti-rejeu |
| 2FA **obligatoire** pour les admins | ✅ | Sans échappatoire : pas de secret ⇒ configuration forcée |
| Connexion sans mot de passe (code) | ✅ | |
| Verrouillage après échecs répétés | ✅ | Espace de noms séparé pour les admins |
| Sessions, révocation, epoch d'invalidation | ✅ | Révocation globale par utilisateur |
| Jetons liés à leur portail | ✅ | Un jeton client ne peut plus ouvrir le back-office |
| Liste d'IP sur les portails privilégiés | ⚙️ | Inactive tant que `admin_ip_allowlist` / `state_ip_allowlist` sont vides — **seul rempart réseau**, Cloudflare Access n'étant pas utilisé |
| Rate limiting | ✅ | Par IP et par utilisateur, fail-closed |

## 2. KYC et KYB

| Fonctionnalité | Statut | Détail |
|---|---|---|
| KYC particulier (CNIB, passeport, permis, CEDEAO) | ✅ | Web ; mobile réparé le 16/08 — il était inopérant |
| Pièces chiffrées au repos | ✅ | AES-256-GCM, **fail-closed** : pas de clé ⇒ refus d'upload |
| Contrôle du type réel des fichiers | ✅ | Décidé sur les octets, pas sur l'en-tête client |
| Niveaux et limites (BASIC / STANDARD / VERIFIED) | ✅ | Plafonds journaliers et mensuels |
| Revue KYC en back-office | ✅ | Validation, rejet motivé, notification |
| **KYB entité** (coopérative, société) | ✅ | RCCM, autorisation d'exploitation, IFU, représentant légal |
| Vérification KYC par prestataire (Smile Identity) | ⚙️ | Signature HMAC implémentée ; inactif sans clés |

## 3. Marché et trading

| Fonctionnalité | Statut | Détail |
|---|---|---|
| Prix de l'or temps réel + taux de change | ⚙️ | GoldAPI avec repli ; inactif sans clé |
| Historique des prix | ✅ | 24 h / 7 j / 30 j / 1 an |
| Devis avec expiration | ✅ | Restauration du devis si la transaction échoue |
| Achat / vente de tokens | ✅ | Atomique (`db.batch` + contraintes CHECK) |
| Spreads configurables | ✅ | |
| Alertes de prix | ✅ | Livraison par email/SMS |
| Verrou anti-double-dépense | ✅ | Durable Object par session de transaction |
| Invariant `tokens_issued ≤ total_allocated` | ✅ | Contrainte SQL + tests de concurrence |

## 4. Portefeuille et paiements

| Fonctionnalité | Statut | Détail |
|---|---|---|
| Soldes tokens et XOF | ✅ | |
| Historique des transactions | ✅ | Web et mobile |
| Dépôts | ⚙️ | Orange Money, Moov Money, CinetPay, Stripe — webhooks signés implémentés ; inactifs sans clés |
| Retraits | ✅ | Débit atomique, plafonds par niveau KYC, validation admin |
| Certificat de propriété | ⚠️ | Généré en **HTML**, pas en PDF |
| Vérification publique de certificat | ✅ | Sans authentification |

## 5. Filière or — consignation à l'export

| Fonctionnalité | Statut | Détail |
|---|---|---|
| Déclaration d'un lot par le producteur | ✅ | Web et mobile (appareil photo natif) |
| Photos du lot | ✅ | Chiffrées, cloisonnées par producteur |
| **Documents d'origine par lot** | ✅ | Certificat d'origine, déclaration minière, transport, essai — typés, avec émetteur et référence. Chiffrés *fail-closed*, espace de clés distinct des photos |
| **Géolocalisation de l'origine** | ⚠️ | Capture mobile implémentée, avec repli en saisie manuelle. `origin_verified` sépare une **position relevée** d'une **zone déclarée**. Nécessite `pnpm install` (`expo-location` ajouté au manifeste) |
| Machine à états (transitaire → transit → Dubaï → audit) | ✅ | Transitions gardées, piste d'audit immuable |
| Rôles dédiés (`TRANSITAIRE`, `DUBAI_VALIDATOR`) | ✅ | |
| **Paiement du producteur en tokens** | ✅ | À la validation d'audit, atomique. Part configurable |
| **Règlement en deux temps** | ✅ | Acompte à la réception à Dubaï (défaut 75 %, avec décote de prudence), solde à l'outturn. En tokens ou en XOF. Un acompte en tokens **alloue l'or qu'il émet**, donc l'invariant tient à chaque étape |
| **Profil raffineur avec corridor** | ⚠️ | Type `REFINER` et corridor origine→destination en base ; écrans non branchés |
| **Location d'or (6 %/an)** | ✅ | API `/lease` complète et **écrans web + mobile** : conditions, ouverture avec accord explicite, positions, relevé jour par jour, sortie. Accrual quotidien en **XOF** (cron 4 h UTC), règlement des sorties à T+3 jours ouvrés (cron 5 h UTC) avec notification. Les grammes loués **quittent le portefeuille** et alimentent `gold_on_loan`, donc l'attestation les divulgue. La sortie **rend l'or, elle ne le vend pas** ([ADR 004](adr/004-sortie-de-location.md)). L'avertissement affiché vient de l'API, jamais reformulé |
| **Relevé de règlement par lot (PDF)** | ✅ | `GET /producer/consignments/:id/statement.pdf` et l'équivalent back-office, **même document**. Poids déclaré, essai, part appliquée, acompte, solde, total, parcours du lot. Un lot encore en transit est documenté « en attente », pas réglé à zéro |
| Traçabilité du montant payé par lot | ✅ | Visible producteur et back-office |
| Suivi d'état par le producteur | ✅ | Web et mobile |

## 6. Preuve de réserve

| Fonctionnalité | Statut | Détail |
|---|---|---|
| Rapport Proof of Reserve | ✅ | Statut dérivé de la couverture réelle |
| Export du rapport | ✅ | JSON **et PDF** (`GET /admin/reports/por.pdf`), générateur sans dépendance. Le PDF porte la divulgation du prêt et renvoie à l'attestation vérifiable |
| **Attestations signées et chaînées** | ⚙️ | Pipeline vérifié de bout en bout avec une vraie clé ES256. Inertes sans `ATTESTATION_SIGNING_JWK` et sans le cron `30 0 * * *` |
| **Divulgation or en coffre / or prêté** | ✅ | La location étant financée par le prêt de l'or, l'attestation distingue `vaultedG` de `onLoanG`, expose `fullyVaulted` et **nomme les contreparties** |
| Vérification publique indépendante | ✅ | Page `/reserve` : SHA-256 et signature ECDSA recalculés **dans le navigateur** |
| **Ancrage sur chaîne publique** | ⚙️ | Implémenté ([ADR 003](adr/003-ancrage-attestations.md)) : empreinte en calldata, sans smart contract. Testnet par défaut, mainnet sur opt-in explicite. Inerte sans `ANCHOR_RPC_URL` / `ANCHOR_PRIVATE_KEY` |

## 7. Administration (back-office)

| Fonctionnalité | Statut | Détail |
|---|---|---|
| 18 écrans, 56 endpoints | ✅ | |
| RBAC : 8 rôles + surcharges par admin | ✅ | |
| Gestion utilisateurs, KYC, KYB, transactions | ✅ | |
| Stock d'or, retraits, réconciliation | ✅ | Job de réconciliation quotidien |
| Configuration en base (sans redéploiement) | ✅ | |
| Journal d'audit | ✅ | Sur toutes les opérations sensibles |
| Analytics | ✅ | Durable Object dédié |
| **Diagnostic de configuration** | ✅ | `GET /admin/readiness` + `scripts/readiness.mjs`. N'expose jamais une valeur ; ne sonde **jamais** une passerelle de paiement |

## 8. Portail État

| Fonctionnalité | Statut | Détail |
|---|---|---|
| Accès dédié en lecture seule | ✅ | Authentification séparée, jeton lié au portail |
| Tableau de bord, stock, rapports | ✅ | 4 écrans, 12 endpoints |
| **Traçabilité des lots** | ✅ | Écran dédié : origine, parcours, pièces justificatives. **N'expose pas l'identité des producteurs** — l'État supervise le flux d'or, pas les personnes |
| Accès aux attestations de réserve | ✅ | Lien vers la vérification publique `/reserve` |

## 9. Notifications

| Fonctionnalité | Statut | Détail |
|---|---|---|
| Email (Resend, repli SendGrid) | ⚙️ | Inactif sans clés |
| SMS (Twilio) | ⚙️ | Inactif sans clés |
| Push mobile (FCM HTTP v1) | ⚙️ | Réparé le 16/08 — l'API legacy était **coupée par Google depuis juin 2024**. Inactif sans compte de service |
| Enregistrement des appareils | ✅ | Un jeton = une installation |
| Fil de notifications in-app | ✅ | Réparé le 16/08 — n'avait **jamais écrit une ligne** |

## 10. Applications

| Application | Statut | Détail |
|---|---|---|
| Web (PWA) | ✅ | 12 pages + authentification + vitrine |
| Back-office | ✅ | 18 écrans |
| Mobile (iOS/Android) | ⚠️ | Complet côté investisseur et producteur ; **aucun test**, pins SSL de production vides |
| Portail État | ⚠️ | 4 écrans seulement |

---

## Points à ne pas cocher trop vite face au deck

Trois promesses classiques de deck méritent une lecture attentive.

**« Notifications push »** — la mécanique est complète et testée, mais aucun compte de service
Firebase n'est provisionné : à ce jour, aucune notification ne part.

**« Preuve de réserve vérifiable »** — la vérification publique est réelle et indépendante (le
navigateur du visiteur recalcule tout). Mais aucune attestation n'est encore publiée faute de clé
de signature, et l'ancrage sur chaîne publique n'est pas fait.

**« Blockchain / smart contracts »** — le token est **comptable en base**, pas on-chain. C'est un
choix documenté ([ADR 002](adr/002-smart-contracts.md)), et la phase 1 livrée apporte
l'auditabilité sans registre on-chain. Si le deck promet un token transférable, l'écart est réel.

**« Preuve de réserve » face au produit de location** — le rendement étant financé par le **prêt
de l'or**, une partie de la réserve peut être détenue et absente. L'attestation le dit désormais
explicitement (`vaultedG`, `onLoanG`, `fullyVaulted`, contreparties nommées), et la page `/reserve`
affiche un avertissement dès qu'une partie est prêtée. Un deck qui promettrait « or intégralement
détenu en coffre » entrerait en contradiction directe avec ce que la preuve publie.

Plus généralement : les mentions ⚙️ ne sont pas du développement restant, mais de la
configuration. C'est le meilleur rapport effort/effet du projet — et tant qu'elle n'est pas faite,
ces fonctionnalités ne sont pas démontrables.

**Pour savoir où en est un déploiement donné**, sans lire ce document ni deviner :

```bash
node scripts/readiness.mjs --url <api> --token <jwt admin>
```

Le tableau sort clé par clé, avec la fonctionnalité que chaque manque désactive, et se termine en
code d'erreur s'il reste des trous — utilisable comme garde-fou avant une démonstration. Procédure
détaillée dans [CONFIGURATION.md](CONFIGURATION.md).
