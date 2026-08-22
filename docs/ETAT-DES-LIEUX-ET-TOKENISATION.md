# TNC Trading — État des lieux, fonctionnalités, et passage au token TNC (ERC-3643)

*Document de référence — 18 août 2026*

---

## 1. En un coup d'œil

| | |
|---|---|
| **Ce qui tourne** | Une plateforme complète de tokenisation d'or, **sans blockchain** : le jeton est une écriture comptable en base |
| **Volumétrie** | 14 modules API · 156 endpoints · 31 services · 38 migrations · 11 travaux planifiés · 4 Durable Objects · 5 applications front |
| **Tests** | **920** côté API, **1 463** au total, tous exécutés |
| **Garde-fous** | 5 contrôles statiques bloquants avant chaque suite de tests |
| **Décisions écrites** | 23 ADR |
| **Audits** | 12 passes, chacune sous un angle différent |
| **Pays décrits** | 6 — Burkina Faso actif ; Côte d'Ivoire, Mali, Sénégal, Ouganda décrits et désactivés |
| **Pour le token TNC** | **Tout l'on-chain reste à faire.** Aucun contrat n'est déployé |

**Le point à retenir avant de lire la suite** : la plateforme est mûre côté métier et registre
comptable. Le passage à un jeton ERC-3643 n'est pas une fonctionnalité de plus — c'est un
**changement de nature du registre**, traité en partie 5.

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

Cinq garde-fous statiques empêchent ces classes de revenir : cohérence SQL/schéma, propriété des
ressources, arrondi des grammes, registre des actions d'audit, format des échéances.

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
| Profil raffineur avec corridor | ⚠️ écrans non branchés |

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
| Messages d'erreur de l'API, en français uniquement | ⚙️ |

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
| Messages d'erreur de l'API en anglais — 108 codes distincts | Un passage entier ; le mécanisme existe, le catalogue non |
| Rapport mensuel de l'État — bornes calculées en heure locale | Hors périmètre ; latent en production (Workers en UTC) |
| Exécution des parcours mobiles bout-en-bout | Écrits, jamais exécutés |
| QR du certificat mobile rendu par un tiers | Dépendance externe à lever |
| Écrans du profil raffineur | Modèle en base, interface absente |

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
| `forcedTransfer` | *Rien d'équivalent* | **Décision** : l'exploitant peut-il déplacer les avoirs d'un tiers ? |

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

Deux voies, et il faut en choisir une explicitement :

| Voie | Ce que ça implique |
|---|---|
| **A — Transférabilité restreinte au périmètre de la plateforme** | La conformité n'autorise que des adresses détenues par la plateforme. La chaîne reste une projection ; D1 reste la vérité. On garde l'architecture actuelle et l'auditabilité, sans transférabilité réelle |
| **B — Transférabilité réelle** | La chaîne devient la source de vérité des soldes. D1 devient un index. **Toute la logique métier qui lit `token_balance` doit être revue** — c'est un chantier de refonte, pas une intégration |

La voie B est celle qui justifie ERC-3643. Elle doit être choisie les yeux ouverts.

### 5.6 Les quatre décisions préalables, revues à la lumière d'ERC-3643

**1. Pourquoi la chaîne ?** Choisir ERC-3643 répond implicitement : *pour la transférabilité*.
L'ADR 002 notait que pour un produit non spéculatif, le bénéfice réel était l'auditabilité. Il
existe pourtant un usage de transférabilité **non spéculatif et cohérent** avec la cible
annoncée — raffineurs et coopératives, plusieurs pays : le **règlement entre professionnels**,
transfrontalier, adossé au métal. C'est un motif défendable, mais il doit être énoncé, car il
gouverne tout le reste.

**2. Qui détient les clés ?** Pour des coopératives puis de petits producteurs, la perte de clé
est un risque de premier ordre. La conservation par la plateforme est presque certaine au départ
— ERC-3643 la supporte, et `recoveryAddress` existe pour cela. **À condition de ne pas la vendre
comme de l'auto-conservation.**

**3. Quelle chaîne ?** ERC-3643 impose une chaîne EVM. Le critère décisif reste le **coût par
transfert converti en monnaie locale** : un jeton vaut ~53 000 XOF, et des frais de quelques
centaines de francs sur un transfert d'un gramme changent l'économie du produit. À cela s'ajoute
que **les porteurs ne détiendront pas de jeton natif pour payer le gaz** : il faut prévoir un
relayeur (méta-transactions) ou de l'abstraction de compte.

**4. Cadre réglementaire.** ERC-3643 existe pour des instruments **régulés**. Adopter la norme,
c'est admettre que le jeton en est un. La qualification dans chaque juridiction servie — et pas
seulement en zone UEMOA — conditionne l'émission bien plus que la technique. **Question
bloquante, à poser à un conseil juridique avant tout engagement.**

### 5.7 Chemin proposé

| Phase | Contenu | Risque |
|---|---|---|
| **0 — Décider** | Voie A ou B ; qualification juridique ; chaîne et coût réel ; conservation | Aucun code |
| **1 — Ancrage** *(déjà en place)* | Publier le digest d'attestation. Aucun solde on-chain | Nul |
| **2 — Identité on-chain** | ONCHAINID par titulaire, l'exploitant devient émetteur d'attestations, registres déployés — **sans jeton** | Faible : rien ne bouge |
| **3 — Jeton en miroir** | Émission et destruction pilotées par le registre comptable, via **outbox** et opérations **idempotentes** clefées sur un identifiant D1 ; réconciliation `totalSupply()` ↔ `tokens_issued` | Élevé : une transaction minée ne se rembobine pas |
| **4 — Transferts** | Conformité modulaire active, relayeur de gaz, récupération de clé | Le plus élevé — change la nature du produit |

**Les phases 2 et 3 sont séparables, et c'est précieux** : déployer les registres d'identité sans
jeton apporte une identité vérifiable réutilisable, sans aucun risque sur les avoirs.

### 5.8 Points durs, nommés

- **Pas de rollback.** Le travail des douze audits a consisté à rendre les écritures atomiques et
  réparables. Un *mint* erroné ne se répare pas ; il se compense, ce qui est visible à jamais.
- **L'invariant devient inter-systèmes.** `totalSupply()` doit égaler `tokens_issued`. Tout écart
  est un **incident**, pas un avertissement — et il faut décider qui fait foi en cas de désaccord.
- **La clé d'administration du proxy devient le secret le plus critique de la plateforme**, devant
  `JWT_SECRET`. Multisig et HSM ne sont pas optionnels.
- **Le gaz.** Aucun producteur ne détiendra de jeton natif. Sans relayeur, le produit est
  inutilisable pour sa cible.
- **La location.** Elle sort aujourd'hui les grammes du portefeuille. On-chain, c'est un gel
  (`freezePartialTokens`) ou un transfert vers un contrat — deux modèles aux conséquences
  fiscales et comptables différentes.
- **Le multi-pays.** `IdentityRegistry` porte un code pays ; la conformité modulaire peut
  restreindre par pays. Les six pays déjà décrits s'y projettent bien — mais chaque activation
  devient aussi une décision réglementaire on-chain.

---

## 6. Ce que ce document ne tranche pas

- La **qualification juridique** du jeton dans chaque juridiction servie.
- Le **choix de la chaîne** et son coût réel converti en monnaie locale.
- **Voie A ou voie B** — la question qui gouverne tout le reste.
- Si l'exploitant doit pouvoir **déplacer les avoirs d'un tiers** (`forcedTransfer`).
- La **durée de conservation** des registres, qui est une contrainte réglementaire.
