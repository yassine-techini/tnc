# TNC Trading — État des lieux, fonctionnalités, et passage au token TNC (ERC-3643)

*Document de référence — 18 août 2026*

---

## 1. En un coup d'œil

| | |
|---|---|
| **Ce qui tourne** | Une plateforme complète de tokenisation d'or, **sans blockchain** : le jeton est une écriture comptable en base |
| **Volumétrie** | 14 modules API · 156 endpoints · 31 services · 38 migrations · 11 travaux planifiés · 4 Durable Objects · 5 applications front |
| **Tests** | **950** côté API, **1 493** au total, tous exécutés |
| **Garde-fous** | 6 contrôles statiques bloquants avant chaque suite de tests |
| **Décisions écrites** | 26 ADR |
| **Audits** | 12 passes, chacune sous un angle différent |
| **Pays décrits** | 6 — Burkina Faso actif ; Côte d'Ivoire, Mali, Sénégal, Ouganda décrits et désactivés |
| **Pour le token TNC** | **Tout l'on-chain reste à faire.** Aucun contrat n'est déployé |
| **Voie retenue** | **A — transférabilité restreinte au périmètre de la plateforme** ([ADR 024](adr/024-la-chaine-reste-une-projection.md), 22 août 2026) |

**Le point à retenir avant de lire la suite** : la plateforme est mûre côté métier et registre
comptable. Un jeton ERC-3643 réellement transférable aurait été un **changement de nature du
registre** ; la **voie A**, retenue, l'évite — la chaîne reste une projection et
`wallets.token_balance` reste la vérité. Ce que cette décision règle, et ce qu'elle laisse entier,
est traité en partie 5.

---

## 2. État des lieux du développement

### 2.1 Ce qui est réellement opérationnel

Le cycle complet est couvert : inscription, vérification d'identité, achat et vente d'or
tokenisé, portefeuille, retraits, consignation de lots par des producteurs, location d'or
rémunérée, frais de garde, certificats de propriété, back-office, portail État.

**Ce qui est vérifié l'est sur une vraie base SQLite**, et non sur des simulacres : les
contraintes `CHECK`, l'atomicité des lots et les clés étrangères y sont réellement appliquées.
C'est ce qui a permis de *démontrer* plusieurs défauts plutôt que de les supposer.

### 2.2 Ce qui est écrit mais inerte

Cinq intégrations sont implémentées et **refusent de fonctionner sans leur clé**, plutôt que de
se dégrader en silence :

| Intégration | État |
|---|---|
| Prix de l'or (GoldAPI) | Inerte sans clé — repli documenté |
| Vérification d'identité (Smile Identity) | Signature HMAC prête, inactive sans clés |
| Paiement mobile (Orange, Moov, CinetPay) | Webhooks signés prêts, inactifs sans clés |
| Attestations signées ES256 | Inertes sans `ATTESTATION_SIGNING_JWK` |
| Liste d'IP admin/État | Inactive tant que la liste est vide — **seul rempart réseau** |

Ce n'est pas un défaut : c'est un échec fermé, appliqué uniformément.

### 2.3 Comment la qualité a été obtenue

Douze audits successifs, chacun sous un angle neuf, ont produit une trentaine de correctifs.
Les plus structurants :

- le **verrou de prix de cinq minutes n'expirait pas** — deux formats de date comparés comme des
  chaînes ; un devis restait consommable jusqu'à minuit UTC ;
- le portail État affichait une couverture **surévaluée de tout l'or en location** ;
- **deux ajustements simultanés du stock national en perdaient un**, et la piste d'audit
  enregistrait les deux ;
- trois achats successifs suffisaient à rendre un solde **invendable** (dérive flottante) ;
- la liste protégeant le registre d'audit **ne correspondait à aucune action réellement écrite** ;
- fermer son compte **échouait pour quiconque avait demandé un devis**.

Six garde-fous statiques empêchent ces classes de revenir : cohérence SQL/schéma, propriété des
ressources, arrondi des grammes, registre des actions d'audit, format des échéances, et — depuis
l'[ADR 025](adr/025-la-langue-d-une-reponse.md) — absence de tout texte littéral dans une réponse
d'erreur.

### 2.4 Ce que le code ne prétend pas être

- **Pas de blockchain.** Le jeton est `wallets.token_balance`, un `REAL` quantifié au milligramme.
- **Pas de conversion entre devises.** Un portefeuille en UGX ne devient pas un portefeuille en XOF.
- **Pas de reprise rétroactive** des périodes déjà rapportées.
- **Le portail État est hors périmètre** de la version multi-pays.

---

## 3. Liste des fonctionnalités

Légende : ✅ opérationnel · ⚙️ implémenté mais inerte sans configuration · ⚠️ avec réserve

### Comptes et sécurité

| Fonctionnalité | |
|---|---|
| Inscription, connexion, déconnexion — 19 endpoints | ✅ |
| Mots de passe Argon2id, migration transparente depuis PBKDF2 | ✅ |
| 2FA (TOTP), secrets chiffrés au repos, anti-rejeu | ✅ |
| 2FA **obligatoire** pour les administrateurs, sans échappatoire | ✅ |
| Second facteur au-delà d'un seuil, **fixé par pays** | ✅ |
| Verrouillage après échecs, sessions, révocation globale | ✅ |
| Jetons liés à leur portail — un jeton client n'ouvre pas le back-office | ✅ |
| Liste d'IP sur les portails privilégiés | ⚙️ |
| Limitation de débit par IP et par utilisateur, échec fermé | ✅ |

### Identité — KYC et KYB

| Fonctionnalité | |
|---|---|
| KYC particulier — pièces **déclarées par le pays** | ✅ |
| Pièces chiffrées au repos (AES-256-GCM), échec fermé sans clé | ✅ |
| Contrôle du type réel des fichiers, décidé sur les octets | ✅ |
| Trois niveaux — BASIC / STANDARD / VERIFIED — et leurs plafonds | ✅ |
| Revue en back-office : validation, rejet motivé, notification | ✅ |
| **KYB entité** — coopérative, société : RCCM, autorisation, IFU | ✅ |
| Vérification par prestataire (Smile Identity) | ⚙️ |

### Marché

| Fonctionnalité | |
|---|---|
| Prix de l'or temps réel, historique 24 h / 7 j / 30 j / 1 an | ⚙️ |
| Devis avec expiration réelle ; montant minimal **dérivé du cours** | ✅ |
| Achat et vente atomiques — `db.batch` + contraintes `CHECK` | ✅ |
| Spreads configurables, alertes de prix | ✅ |
| Verrou anti-double-dépense — Durable Object par utilisateur | ✅ |
| Invariant `tokens_issued ≤ total_allocated` | ✅ |

### Portefeuille et paiements

| Fonctionnalité | |
|---|---|
| Soldes or et espèces, **portant leur devise** | ✅ |
| Historique des transactions — web et mobile | ✅ |
| Dépôts — Orange Money, Moov, CinetPay, Stripe | ⚙️ |
| Retraits : débit atomique, plafonds **par pays**, validation admin | ✅ |
| Certificat de propriété **PDF** — un poids, jamais une valeur | ✅ |
| Vérification publique d'un certificat, sans compte | ✅ |
| Fermeture de compte : anonymisation, registre conservé | ✅ |

### Filière or

| Fonctionnalité | |
|---|---|
| Déclaration d'un lot par le producteur — web et appareil photo mobile | ✅ |
| Photos et documents d'origine, chiffrés, cloisonnés par producteur | ✅ |
| Géolocalisation de l'origine, avec repli en saisie manuelle | ⚠️ |
| Machine à états transitaire → transit → Dubaï → audit | ✅ |
| Rôles dédiés `TRANSITAIRE` et `DUBAI_VALIDATOR` | ✅ |
| Paiement du producteur en jetons, atomique | ✅ |
| **Règlement en deux temps** — acompte à Dubaï, solde à l'outturn | ✅ |
| Relevé de règlement PDF par lot | ✅ |
| **Location d'or** 6 %/an, avec rattrapage des jours manqués | ✅ |
| Frais de garde 0,5 %/an ; impayés en dette lisible | ✅ |
| Répartition d'un lot — vente / location / garde | ✅ |
| **Profil raffineur avec corridor** — API, web et mobile | ✅ |

### Preuve de réserve

| Fonctionnalité | |
|---|---|
| Rapport Proof of Reserve — statut dérivé de la couverture réelle | ✅ |
| Export JSON **et PDF** | ✅ |
| **Attestations signées et chaînées** — ES256, digest chaîné | ⚙️ |
| Divulgation or en coffre / or prêté, contreparties nommées | ✅ |
| **Ancrage on-chain du digest** (ADR 003) | ⚙️ |
| Vérification publique indépendante — SHA-256 et ECDSA **dans le navigateur** | ✅ |

### Exploitation

| Fonctionnalité | |
|---|---|
| Back-office — 39 endpoints : utilisateurs, KYC, stock, retraits, rapports | ✅ |
| Portail État en lecture seule | ✅ |
| Piste d'audit — 34 actions enregistrées, 27 **jamais purgées** | ✅ |
| Sauvegarde quotidienne — secrets exclus, relecture vérifiée | ✅ |
| Réconciliation quotidienne, rapports mensuels | ✅ |
| Diagnostic de disponibilité | ✅ |
| Notifications **dans la langue du pays** — 7 courriels, 5 SMS | ✅ |
| Réponses d'erreur de l'API **dans la langue du client** — 143 codes, deux langues | ✅ |
| Forme d'erreur unique, **y compris en validation** — code, message, `requestId` | ✅ |

---

## 4. Reste à faire

### 4.1 Décisions qui vous appartiennent — le code attend

| Sujet | Ce qui bloque |
|---|---|
| **Paiements hors zone franc** | MTN MoMo et Airtel Money déclarés non implémentés ; licences et adaptateurs |
| **Seuils réglementaires par pays** | Les montants semés sont **indicatifs** ; un plafond de retrait est fixé par un régulateur, pas par un taux de change |
| **Jours fériés par pays** | La table existe et est vide — la remplir est un acte d'exploitation |
| **Destinataire des alertes** | Aucune adresse configurée pour les alertes d'exploitation |
| **Recouvrement des arriérés de garde** | Question juridique |
| **Copie de sauvegarde hors Cloudflare** | Identifiants d'un second fournisseur |
| **Qualification réglementaire du jeton** | **Bloquant pour toute émission on-chain** — partie 5 |

### 4.2 Travaux techniques identifiés

| Sujet | Ampleur |
|---|---|
| Messages de validation des schémas Zod, en français | Surface distincte de celle des erreurs d'API, qui est faite ([ADR 025](adr/025-la-langue-d-une-reponse.md)) |
| Rapport mensuel de l'État — bornes calculées en heure locale | Hors périmètre ; latent en production (Workers en UTC) |
| Exécution des parcours mobiles bout-en-bout | Écrits, jamais exécutés |
| QR du certificat mobile rendu par un tiers | Dépendance externe à lever |

### 4.3 Avant toute mise en production

- [ ] Variables d'environnement et clés API actives
- [ ] 38 migrations D1 appliquées
- [ ] Liste d'IP renseignée pour admin et État
- [ ] Sauvegarde au vert dans le diagnostic
- [ ] Parcours bout-en-bout exécutés
- [ ] **Pentest réalisé**
- [ ] Seuils par pays revus par un conseil juridique local

---

## 5. Tokenisation

### 5.1 Le jeton aujourd'hui — un jeton comptable

| Propriété | Valeur |
|---|---|
| Unité | **1 jeton = 1 gramme** d'or physique |
| Précision | **Milligramme** — 3 décimales, quantifiées à l'écriture |
| Registre | `wallets.token_balance` (SQLite/D1) |
| Offre totale | `gold_stock.tokens_issued` |
| Invariant | `CHECK (tokens_issued <= total_allocated)` — au niveau du schéma |
| Émission | Validation d'audit d'un lot à Dubaï, dans un lot atomique |
| Destruction | Vente ou rachat, dans le même lot que le crédit espèces |
| Transférabilité | **Aucune.** Il n'existe aucun transfert d'utilisateur à utilisateur |

**Ce qui rend l'ensemble sûr aujourd'hui** tient en une phrase : il y a *une* source de vérité,
et toute opération est un lot tout-ou-rien adossé à des contraintes vérifiées par le moteur.
L'or prêté sort du portefeuille et alimente `gold_on_loan` ; l'attestation signée le divulgue.

### 5.2 Ce qui existe déjà et qui servira

L'ancrage on-chain **existe** (ADR 003) : le digest d'attestation est écrit dans la donnée d'appel
d'une transaction sans valeur, horodatée et non réécrivable. Il ne prouve pas que l'or existe —
seulement qu'un digest existait à un instant et n'a pas changé. Aucun contrat n'a été déployé,
délibérément.

**L'ADR 002 (« Prise en compte des smart contracts ») est en statut *proposé*** et pose déjà le
problème central ainsi que quatre décisions préalables. Ce qui suit le prolonge ; il ne le
remplace pas.

### 5.3 ERC-3643 (T-REX) — ce que la norme apporte

ERC-3643 est une norme de **jeton permissionné** compatible ERC-20 : tout transfert est soumis à
la vérification d'identité de l'émetteur *et* du destinataire, et à des règles de conformité
programmables. La suite de référence s'appelle **T-REX**.

| Composant | Rôle |
|---|---|
| **Token** | Interface ERC-20 + restrictions de transfert, gel, pause, transfert forcé, récupération |
| **IdentityRegistry** | Associe une adresse à une identité on-chain et à un **code pays** |
| **IdentityRegistryStorage** | Stockage d'identités partageable entre plusieurs jetons |
| **ClaimTopicsRegistry** | Quelles attestations sont **exigées** (KYC, AML, accréditation…) |
| **TrustedIssuersRegistry** | Quels émetteurs sont **habilités** à signer chaque type d'attestation |
| **ModularCompliance** | Règles de transfert enfichables : pays autorisés, nombre de porteurs, plafonds… |
| **ONCHAINID** | Contrat d'identité portant les attestations signées |

> **À vérifier avant tout développement.** Les signatures exactes, la version de la suite T-REX et
> l'état des audits de sécurité doivent être confrontés à l'implémentation de référence courante.
> Ce document décrit l'architecture, pas une API figée.

### 5.4 Correspondance avec l'existant

C'est le point encourageant : **la plateforme possède déjà la matière conceptuelle** que T-REX
attend. Ce qui manque est sa projection on-chain.

| Composant T-REX | Ce qui existe déjà | Ce qu'il reste à construire |
|---|---|---|
| `ClaimTopicsRegistry` | Niveaux `BASIC` / `STANDARD` / `VERIFIED` | Traduire les niveaux en sujets d'attestation |
| `TrustedIssuersRegistry` | Revue KYC en back-office + Smile Identity | Faire de l'exploitant un **émetteur d'attestations** avec sa clé |
| `IdentityRegistry` | `users.country`, `country_config` (6 pays) | Un ONCHAINID par titulaire ; lien adresse ↔ identité |
| `ModularCompliance` | `KYC_LIMITS`, seuils par pays, `country_config.enabled` | Modules on-chain équivalents |
| `decimals` du jeton | Milligramme = **3 décimales** | Correspondance directe |
| `totalSupply()` | `gold_stock.tokens_issued` | L'invariant devient **inter-systèmes** |
| `freezePartialTokens` | La location **sort déjà** les grammes du portefeuille | Traduire la location en gel plutôt qu'en débit |
| `recoveryAddress` | Récupération de compte | Procédure et gouvernance des clés |
| `pause` | Suspension de compte | Correspondance directe |
| `forcedTransfer` | *Rien d'équivalent* | Sans objet sous la voie A — toutes les adresses sont détenues par la plateforme |

L'attestation signée et chaînée déjà en place est par ailleurs un excellent candidat pour la
**preuve de réserve on-chain** : son digest est déjà ancré.

### 5.5 La conséquence qu'il ne faut pas manquer

L'ADR 002 pose une règle d'architecture pour ses phases 1 et 2 :

> La chaîne est une **projection** du registre comptable, jamais un second registre.

**ERC-3643 est incompatible avec cette règle**, et c'est la conséquence la plus lourde du choix.

Si le jeton est réellement transférable, un porteur peut le déplacer **sans passer par la
plateforme**. Dès cet instant, `wallets.token_balance` cesse d'être la vérité : la chaîne le
devient. Or aujourd'hui, la location, les frais de garde, la répartition des lots, les plafonds
KYC et les certificats **lisent tous ce solde**.

Deux voies étaient possibles :

| Voie | Ce que ça implique | |
|---|---|---|
| **A — Transférabilité restreinte au périmètre de la plateforme** | La conformité n'autorise que des adresses détenues par la plateforme. La chaîne reste une projection ; D1 reste la vérité. On garde l'architecture actuelle et l'auditabilité, sans transférabilité réelle | **retenue** |
| **B — Transférabilité réelle** | La chaîne devient la source de vérité des soldes. D1 devient un index. **Toute la logique métier qui lit `token_balance` doit être revue** — c'est un chantier de refonte, pas une intégration | écartée |

**La voie A est retenue** ([ADR 024](adr/024-la-chaine-reste-une-projection.md)). En restreignant
les adresses autorisées, elle supprime la cause de l'incompatibilité et non seulement son symptôme :
la règle de l'ADR 002 tient, et **aucune ligne du métier n'est à reprendre**.

Ce qu'il faut avoir en tête en contrepartie :

- **La voie A retire le chantier de refonte, pas l'irréversibilité de la chaîne.** Un *mint* erroné
  ne se répare toujours pas, et l'invariant `totalSupply()` ↔ `tokens_issued` devient inter-systèmes
  avec un réconciliateur *a posteriori* pour seul garde-fou.
- **Elle diffère le coût de la voie B, elle ne le supprime pas.** Élargir la liste d'adresses
  autorisées est une modification de module de conformité ; la reprise du métier reste entière, à
  l'identique, si la bascule est décidée un jour.
- **Elle change ce qui justifie ERC-3643.** Sans transferts, la norme n'est plus choisie pour ses
  transferts sous conformité : elle l'est pour sa **couche d'identité** et pour garder la porte
  ouverte. C'est défendable, mais il faut l'énoncer.

### 5.6 Les quatre décisions préalables, après le choix de la voie A

La voie A en résout deux par construction et en allège une troisième. La quatrième reste entière.

**1. Pourquoi la chaîne ? — Répondu, et ce n'est pas la transférabilité.** Il restait un usage de
transférabilité non spéculatif et cohérent avec la cible — le règlement entre professionnels,
transfrontalier, adossé au métal. La voie A y renonce. Ce qui subsiste comme justification :
l'**auditabilité**, déjà livrée par l'ancrage, et une **identité vérifiable réutilisable**. C'est
la seule raison restante d'aller on-chain, et elle doit être assumée comme telle.

**2. Qui détient les clés ? — Répondu : la plateforme.** Si seules ses adresses sont autorisées, la
conservation est custodiale par construction. `recoveryAddress` existe pour cela et la perte de clé
cesse d'être un risque de premier ordre pour le porteur. **À condition de ne jamais présenter cela
comme de l'auto-conservation.**

**3. Quelle chaîne ? — Allégé.** ERC-3643 impose une chaîne EVM, mais le coût par transfert cesse
d'être le critère décisif : il n'y a pas de transfert d'utilisateur à utilisateur. Seule la
plateforme paie du gaz, sur des émissions et destructions peu nombreuses et prévisibles.
**Le problème du gaz disparaît** — ni relayeur ni abstraction de compte, puisque aucun porteur ne
signe de transaction. L'avertissement de l'ADR 002 tient en revanche toujours : une chaîne
permissionnée opérée par le même acteur reproduit l'hypothèse de confiance de la base et ne prouve
rien à un tiers.

**4. Cadre réglementaire — toujours ouvert, toujours bloquant.** ERC-3643 existe pour des
instruments **régulés**. Adopter la norme, c'est admettre que le jeton en est un. Un instrument non
transférable pose une question *différente* d'un instrument négociable, pas une question *absente*.
La qualification dans chaque juridiction servie — et pas seulement en zone UEMOA — conditionne
l'émission bien plus que la technique. **À poser à un conseil juridique avant tout engagement.**

### 5.7 Chemin proposé

| Phase | Contenu | Risque |
|---|---|---|
| **0 — Décider** *(en partie faite)* | ~~Voie A ou B~~ · ~~conservation des clés~~ — **tranchés**. Restent la qualification juridique et le choix de la chaîne | Aucun code |
| **1 — Ancrage** *(déjà en place)* | Publier le digest d'attestation. Aucun solde on-chain | Nul |
| **2 — Identité on-chain** | ONCHAINID par titulaire, l'exploitant devient émetteur d'attestations, registres déployés — **sans jeton** | Faible : rien ne bouge |
| **3 — Jeton en miroir** | Émission et destruction pilotées par le registre comptable, via **outbox** et opérations **idempotentes** clefées sur un identifiant D1 ; réconciliation `totalSupply()` ↔ `tokens_issued` | Élevé : une transaction minée ne se rembobine pas |
| ~~**4 — Transferts**~~ | **Hors périmètre** sous la voie A | — |

**Les phases 2 et 3 sont séparables, et la voie A rend cette séparation décisive.** La phase 2
apporte désormais la totalité du bénéfice restant — une identité vérifiable, rattachée à un code
pays, réutilisable — sans aucun risque sur les avoirs.

La phase 3, elle, porte l'essentiel du risque irréversible **et n'apporte plus la transférabilité
qui la justifiait**. Ce qu'elle ajoute encore : une offre publiquement lisible en continu là où
l'attestation ancrée la publie périodiquement, et un galop d'essai vers une éventuelle voie B. Ce
n'est pas rien, mais ce n'est plus évident — **elle doit être justifiée pour elle-même avant d'être
engagée**, et non héritée comme une étape obligatoire.

### 5.8 Points durs, nommés

- **Pas de rollback.** Le travail des douze audits a consisté à rendre les écritures atomiques et
  réparables. Un *mint* erroné ne se répare pas ; il se compense, ce qui est visible à jamais.
- **L'invariant devient inter-systèmes.** `totalSupply()` doit égaler `tokens_issued`. Tout écart
  est un **incident**, pas un avertissement — et il faut décider qui fait foi en cas de désaccord.
- **La clé d'administration du proxy devient le secret le plus critique de la plateforme**, devant
  `JWT_SECRET`. Multisig et HSM ne sont pas optionnels.
- **Le gaz — levé par la voie A.** Aucun producteur ne détiendra de jeton natif, mais aucun n'aura à
  signer de transaction : seule la plateforme paie du gaz, sur des émissions et destructions peu
  nombreuses. Ce point dur disparaît avec les transferts.
- **La location.** Elle sort aujourd'hui les grammes du portefeuille. On-chain, c'est un gel
  (`freezePartialTokens`) ou un transfert vers un contrat — deux modèles aux conséquences
  fiscales et comptables différentes.
- **Le multi-pays.** `IdentityRegistry` porte un code pays ; la conformité modulaire peut
  restreindre par pays. Les six pays déjà décrits s'y projettent bien — mais chaque activation
  devient aussi une décision réglementaire on-chain.

---

## 6. Ce que ce document ne tranche pas

**Tranché depuis** : la voie A est retenue, et avec elle la conservation des clés — custodiale par
construction ([ADR 024](adr/024-la-chaine-reste-une-projection.md)).

Restent ouverts :

- La **qualification juridique** du jeton dans chaque juridiction servie — **bloquante** pour toute
  émission on-chain, quelle que soit la voie.
- Le **choix de la chaîne** et son coût réel d'exploitation. Le critère a changé : ce n'est plus le
  coût par transfert, mais le coût des seules émissions et destructions.
- Si la **phase 3 — jeton en miroir** doit être construite, maintenant qu'elle n'apporte plus la
  transférabilité.
- La **durée de conservation** des registres, qui est une contrainte réglementaire.

`forcedTransfer` sort de la liste : sous la voie A, toutes les adresses sont déjà détenues par la
plateforme, et l'opération n'a plus de sens externe. La gouvernance de la **récupération de compte**
reste entière.
