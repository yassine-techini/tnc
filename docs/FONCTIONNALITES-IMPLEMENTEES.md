# Fonctionnalités implémentées — 16 août 2026

Inventaire établi à partir du code, destiné à être confronté ligne à ligne aux promesses du deck.

> Pour **montrer** ce document plutôt que le lire : [DEMO-SCRIPT.md](DEMO-SCRIPT.md) déroule les
> quatre parcours en indiquant, à chaque étape, la configuration qu'elle exige.

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

**Volumétrie** : 14 modules API, 30 services métier, **31 migrations**, 11 jobs planifiés,
4 Durable Objects, 5 applications front, **1 320 tests automatisés** (788 API, 314 `shared`,
63 back-office, 61 mobile, 60 web, 34 portail État).

**Tous s'exécutent.** Les 26 tests d'`auth.service.test.ts` étaient jusqu'ici absents du
décompte : `argon2-browser` faisait tomber le worker vitest sous Node ≥ 18, et un fichier
qui meurt ne se signale pas en échec — il disparaît du total. `test/argon2-wasm.setup.ts`
fournit désormais le wasm à la bibliothèque, et les tests s'exécutent contre le vrai argon2
(constat S de [RESTE-A-FAIRE.md](RESTE-A-FAIRE.md)).

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
| Certificat de propriété | ✅ | **PDF** téléchargeable (`/wallet/certificate/:id`), vue HTML conservée via `?format=html`. Aucune valeur imprimée — seulement un poids. Les grammes **en location sont comptés et affichés à part** : ils appartiennent au titulaire mais ne sont pas en coffre. Le montant loué est **stocké**, pas recalculé, pour qu'un ancien certificat ne change jamais |
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
| **Règlement en deux temps** | ✅ | Acompte à la réception à Dubaï (défaut 75 %, avec décote de prudence), solde à l'outturn. En tokens ou en XOF. Un acompte en tokens **alloue l'or qu'il émet**, donc l'invariant tient à chaque étape. Si l'essai ressort **sous** l'acompte : aucune reprise, et l'or que l'affinage n'a pas confirmé est **désalloué** de la réserve — la plateforme absorbe l'écart sur son stock libre, ou l'audit est refusé ([ADR 006](adr/006-essai-sous-acompte.md)) |
| **Profil raffineur avec corridor** | ⚠️ | Type `REFINER` et corridor origine→destination en base ; écrans non branchés |
| **Location d'or (6 %/an)** | ✅ | API `/lease` complète et **écrans web + mobile** : conditions, ouverture avec accord explicite, positions, relevé jour par jour, sortie. Accrual quotidien en **XOF** (cron 4 h UTC), avec **rattrapage d'un jour manqué au prix de ce jour-là** et reprise par position ([ADR 011](adr/011-rattrapage-des-jours-manques.md)), règlement des sorties à T+3 jours ouvrés (cron 5 h UTC) avec notification. Les grammes loués **quittent le portefeuille** et alimentent `gold_on_loan`, donc l'attestation les divulgue. La sortie **rend l'or, elle ne le vend pas** ([ADR 004](adr/004-sortie-de-location.md)). L'avertissement affiché vient de l'API, jamais reformulé |
| **Relevé de règlement par lot (PDF)** | ✅ | `GET /producer/consignments/:id/statement.pdf` et l'équivalent back-office, **même document**. Poids déclaré, essai, part appliquée, acompte, solde, total, parcours du lot. Un lot encore en transit est documenté « en attente », pas réglé à zéro. Reprend aussi la **destination du lot** (vendu / loué / gardé) une fois réparti — et le dit explicitement quand la répartition est incomplète |
| **Répartition d'un lot : vendre / louer / stocker** | ✅ | En **une instruction**, éventuellement les trois à la fois, **écrans web et mobile compris**. Le raffineur ne saisit que la vente et la location : le stockage est le reste, donc la règle « la somme couvre exactement le lot » est **structurelle** et non un message d'erreur. Chaque jambe délègue au chemin existant (vente marché, position de location) et porte son propre statut, donc une exécution partielle est **visible et reprenable**. Un lot ne se répartit qu'une fois. Les répartitions **incomplètes remontent au back-office** (`/admin/dispositions`), sinon un échec d'argent n'aurait été visible que du producteur |
| **Frais de garde à Dubaï** | ✅ | 0,5 %/an prélevés **en XOF** sur l'or réellement gardé (cron 6 h UTC). L'or en location n'est **pas** facturé : il n'est pas en coffre et rémunère déjà son détenteur. Un frais que le solde espèces ne couvre pas devient une **dette lisible** plutôt que d'être perdu ou imposé ([ADR 005](adr/005-frais-de-garde-impayes.md)). S'applique aux profils `REFINER` par défaut. Une défaillance sur un titulaire n'interrompt plus les suivants ; le jour manqué est **signalé et non reconstitué**, faute d'un relevé quotidien du solde ([ADR 011](adr/011-rattrapage-des-jours-manques.md) § 5). Ardoise visible côté producteur, jour par jour. Les arriérés sont consultables au back-office (`/admin/storage-fees/outstanding`), solde espèces joint — un arriéré sur un compte approvisionné signale un prélèvement en panne, pas un débiteur |
| Traçabilité du montant payé par lot | ✅ | Visible producteur et back-office |
| Suivi d'état par le producteur | ✅ | Web et mobile |

## 6. Preuve de réserve

| Fonctionnalité | Statut | Détail |
|---|---|---|
| Rapport Proof of Reserve | ⚠️ | Chiffres corrigés : « jetons émis » vient de `tokens_issued`, plus de la somme des portefeuilles — qui en excluait l'or placé en location et surévaluait la couverture d'autant ([ADR 012](adr/012-un-seul-vocabulaire-pour-la-reserve.md)). **L'écran back-office reste inutilisable** : il lit une forme imbriquée que la route n'émet pas (constat X) |
| Export du rapport | ✅ | JSON **et PDF** (`GET /admin/reports/por.pdf`), générateur sans dépendance. Le PDF porte la divulgation du prêt et renvoie à l'attestation vérifiable |
| **Attestations signées et chaînées** | ⚙️ | Pipeline vérifié de bout en bout avec une vraie clé ES256. Inertes sans `ATTESTATION_SIGNING_JWK` et sans le cron `30 0 * * *` |
| **Divulgation or en coffre / or prêté** | ✅ | La location étant financée par le prêt de l'or, l'attestation distingue `vaultedG` de `onLoanG`, expose `fullyVaulted` et **nomme les contreparties**. Le tableau de bord État répondait à la même question par « aucun gramme n'est prêté » et contredisait l'attestation signée ; il suit désormais sa définition |
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

## 9 bis. Multi-pays

| Fonctionnalité | Statut | Détail |
|---|---|---|
| **Configuration par pays** | ✅ | Table `country_config` : devise et symbole, décimales, indicatif, documents d'identité, moyens de paiement, préfixe de certificat, locale, fuseau. Endpoint public `/public/countries` pour le formulaire d'inscription |
| Burkina Faso | ✅ | Seul pays **ouvert** aujourd'hui : XOF, +226, CNIB, Orange Money / Moov / virement |
| UEMOA (CI, ML, SN) | ⚙️ | Déclarés et désactivés. Même devise et mêmes documents, donc une ligne chacun — mais partager une devise n'est pas détenir les agréments |
| Ouganda | ⚙️ | Déclaré et désactivé : UGX/USh, +256, pièces ougandaises (National ID, passeport, permis, carte de réfugié). **MTN MoMo et Airtel Money sont déclarés non implémentés** — aucun adaptateur n'existe, et `serviceable` est faux tant que c'est le cas |

> Un pays n'est *ouvert* que s'il a au moins un moyen de paiement réellement branché. Le contrôle est volontairement plus strict que le drapeau `enabled` : basculer la colonne à la main n'ouvre pas un pays qui ne peut pas être payé.

---

## 10. Applications

| Application | Statut | Détail |
|---|---|---|
| Web (PWA) | ✅ | 12 pages + authentification + vitrine |
| Back-office | ✅ | 19 écrans, dont un **écran Support** : répartitions incomplètes et arriérés de garde, avec la lecture qui distingue un débiteur d’un prélèvement en panne |
| Mobile (iOS/Android) | ⚠️ | Complet côté investisseur, producteur et location. **29 tests** sur la logique pure (formatage, règles d'épinglage). Pins SSL de production **déclarés une seule fois** dans `expo.extra.sslPinning`, vérifiés avant chaque build par `pnpm check:pins`. Reste : tests de composants et bout-en-bout sur appareil (Detox/Maestro) |
| Portail État | ⚠️ | 5 écrans, **23 tests** sur ce qui fonde l'argument fait à l'État : aucune route d'écriture hors authentification, cloisonnement des jetons, et **aucune identité exportée** — l'export CSV livrait l'adresse e-mail de chaque détenteur, il ne porte plus qu'une référence pseudonyme. Les **trois exports sont tracés** (`action=STATE_EXPORT`, consultable via `/admin/audit-logs`) : appelant, filtres, volume et IP — jamais les données. L'export transactionnel est **refusé** si la trace ne peut pas être écrite. Le tableau de bord **divulgue l'or prêté** — il ne le voyait pas, et affichait de surcroît 0 g de réserve en permanence, les noms de champs du client ne correspondant à aucune réponse |

---

## Points à ne pas cocher trop vite face au deck

Cinq promesses classiques de deck méritent une lecture attentive.

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

**« Location d'or à 6 %/an, vente possible à tout moment »** — la location est complète, du back-end aux écrans. Mais « vente possible à tout moment » se lit : *sortie demandable à tout moment*, puis vente une fois les grammes revenus au portefeuille. La sortie **rend** l'or, elle ne le vend pas ([ADR 004](adr/004-sortie-de-location.md)), et le délai T+n est le **rappel du prêt**, pas un délai de règlement boursier. Un deck qui laisserait entendre une liquidation instantanée promettrait autre chose que ce qui est livré.

**« Multi-pays »** — la configuration existe et l'Ouganda est décrit, mais **aucun moyen de paiement ougandais n'est implémenté** et le pays est marqué non ouvrable tant que c'est le cas. Annoncer une présence multi-pays sur la base de cette table serait prématuré.

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
