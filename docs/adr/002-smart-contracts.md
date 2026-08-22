# ADR 002 : Prise en compte des smart contracts

## Statut

**Partiellement tranché.**

- L'[ADR 003](003-ancrage-attestations.md) tranche la phase 1 (ancrage), qui est livrée.
- L'[ADR 024](024-la-chaine-reste-une-projection.md) retient la **voie A** : la transférabilité
  est restreinte aux adresses détenues par la plateforme. **La règle d'architecture posée plus bas
  — la chaîne est une projection, jamais un second registre — est donc confirmée**, et les
  questions 1 et 2 du § *Ce qu'il faut trancher d'abord* y trouvent leur réponse.
- Restent ouvertes : la question 3 (quelle chaîne) et la question 4 (cadre réglementaire, toujours
  bloquante avant toute émission on-chain).

## Contexte

`CLAUDE.md` pose comme principe fondateur : « Pas de blockchain (V1) — tokens comptables en base
de données ». Le token est aujourd'hui une ligne dans `wallets.token_balance`, et l'invariant qui
fonde la plateforme — `tokens_issued <= total_allocated` — est une contrainte `CHECK` SQL vérifiée
à l'intérieur d'un batch D1 atomique.

Passer aux smart contracts n'est pas un ajout de fonctionnalité : c'est un changement de nature du
registre. Ce document pose le problème d'ingénierie central, les décisions préalables, et un
chemin en trois phases dont **seule la première est recommandée à ce stade**.

---

## Le problème central : deux registres, pas de transaction distribuée

C'est le point qui doit gouverner toute l'architecture.

Aujourd'hui il existe **une** source de vérité. Un achat, une vente, une allocation d'or sont des
batches D1 tout-ou-rien, adossés à des contraintes `CHECK`. Cet audit a précisément consisté à
réparer les endroits où cette atomicité était mal utilisée — notamment `auditValidate`, où une
instruction gardée parmi quatre laissait les trois autres s'appliquer quand même, allouant 900 g
de couverture sans or physique en face.

Avec une chaîne, il y a **deux** registres et aucun moyen de les écrire ensemble atomiquement.
Et surtout : **une transaction minée ne se rollback pas**. La classe de bug corrigée en C1
devient irréparable — on ne « dé-mint » pas.

La règle d'architecture qui en découle, pour les phases 1 et 2 :

> La chaîne est une **projection** du registre comptable, jamais un second registre.
> Un seul écrivain, une table d'*outbox*, des opérations on-chain **idempotentes** clefées sur un
> identifiant D1, et un réconciliateur qui détecte la dérive.

Concrètement : le batch D1 reste la vérité et écrit une intention dans l'outbox ; un consommateur
de queue soumet la transaction on-chain ; le job de réconciliation compare l'offre on-chain à
`tokens_issued` et alerte sur tout écart. Jamais l'inverse.

---

## Ce qu'il faut trancher d'abord

Ces quatre réponses déterminent tout le reste. Aucune ligne de code de contrat ne devrait être
écrite avant.

### 1. Pourquoi la chaîne ?

Trois motivations possibles, qui ne mènent pas à la même architecture :

| Motivation | Ce que ça implique | Phase minimale |
|---|---|---|
| **Auditabilité** — prouver à l'État, aux citoyens, à un partenaire international que la réserve n'a pas été réécrite | Ancrage d'attestations. Aucun solde on-chain | Phase 1 |
| **Transférabilité** — le token circule hors plateforme | Soldes on-chain, custody, conformité | Phase 3 |
| **Liquidité / DeFi** | Contradictoire avec « finance éthique : pas de spéculation, pas d'effet de levier » | — |

Pour un produit **domestique, KYC-gaté et non spéculatif**, le bénéfice réel est l'auditabilité,
pas la liquidité. C'est ce qui motive la recommandation en bas de document.

### 2. Custody : qui détient les clés ?

Si le citoyen détient sa clé privée, il détient son or — et il le perd avec son téléphone. Dans le
contexte visé (inclusion financière, mobile-first, connectivité inégale), la perte de clé est un
risque de premier ordre, pas un cas limite. Si la plateforme détient les clés, la chaîne apporte
de l'auditabilité mais **aucune souveraineté à l'utilisateur** — ce qui est un choix défendable,
à condition de ne pas le vendre comme de l'auto-conservation.

### 3. Chaîne publique ou permissionnée ?

Le point à ne pas manquer : **une chaîne permissionnée opérée par le même acteur reproduit
exactement l'hypothèse de confiance de la base de données**. Elle ajoute un coût d'exploitation
sans ajouter l'auditabilité qui motive le projet. Si l'objectif est la preuve, l'ancrage doit être
là où l'opérateur ne peut pas réécrire l'histoire.

Critères de sélection, à évaluer chiffres en main :
- coût par transaction **converti en XOF** (un token = ~53 000 XOF ; des frais de 300 XOF sur un
  transfert de 1 g changent l'économie du produit) ;
- finalité et disponibilité réelles ;
- souveraineté : un État partenaire acceptera-t-il que le registre de son or vive sur une
  infrastructure qu'il ne contrôle pas — et inversement, une chaîne qu'il contrôle prouve-t-elle
  quoi que ce soit à un tiers ?

### 4. Cadre réglementaire

Un instrument adossé à l'or, émis dans la zone UEMOA, touche à la BCEAO. Ce n'est ni de la monnaie
électronique ni un actif purement numérique, et la qualification conditionne la phase 3 bien plus
que la technique. **Question bloquante, à poser à un conseil juridique avant tout engagement sur
la transférabilité** — ce document ne tranche pas ce point.

---

## Chemin en trois phases

### Phase 1 — Ancrage de la Proof of Reserve (aucun token on-chain)

Publier périodiquement, sur une chaîne publique, une attestation signée de l'état de la réserve :
empreinte de `(total_allocated, tokens_issued, références des lots audités, horodatage)`.

- **Aucun solde ne bouge.** Zéro risque de custody, zéro impact réglementaire, zéro changement
  pour l'utilisateur.
- Délivre exactement la promesse d'auditabilité : personne — pas même l'opérateur — ne peut
  réécrire rétroactivement l'historique de la réserve.
- **Réutilise l'existant** : l'endpoint `GET /admin/reports/por` existe déjà
  (`admin.ts:1948`), et l'infrastructure de jobs planifiés aussi
  (`src/scheduled/jobs/daily-reconciliation.ts`). C'est un job supplémentaire, pas une refonte.
- Coût : quelques transactions par jour.
- **Ce que ça n'apporte pas** : aucune transférabilité.

Travail estimé : contrat d'ancrage trivial (une fonction `anchor(bytes32)` + événement), un service
de signature, un job planifié, une page de vérification publique. C'est la seule phase sans risque
irréversible.

### Phase 2 — Token ERC-20 en miroir, custody plateforme

Le token existe on-chain, l'utilisateur ne détient pas ses clés.

- `auditValidate` déclenche un *mint* du poids alloué ; le rachat déclenche un *burn*.
- **Pattern outbox obligatoire** : le batch D1 écrit l'intention, un consommateur de queue soumet,
  le réconciliateur vérifie. L'infrastructure de queues existe déjà (`[[queues.producers]]`).
- **Idempotence indispensable** : l'appel on-chain doit être clefé par l'identifiant de la
  consignation ou de la transaction, pour qu'un retry ne puisse pas minter deux fois. C'est le
  même raisonnement que la garde de statut des batches — mais sans filet de rollback.
- L'invariant devient inter-systèmes : `totalSupply()` on-chain doit égaler `tokens_issued`. Tout
  écart est un incident, pas un warning.
- Gestion des clés : multisig + HSM. L'admin d'un proxy upgradable devient **le secret le plus
  critique de la plateforme**, devant `JWT_SECRET`.
- Un bug de contrat ne se corrige pas comme un déploiement Worker.

### Phase 3 — Auto-conservation et transferts

Le saut le plus important, et le seul qui change la nature du produit.

Points durs : récupération de clé pour un public non technique ; abstraction du gas (un
utilisateur burkinabè ne détiendra pas de token natif pour payer les frais) ; et surtout
**restrictions de transfert** — un token librement transférable entre en tension directe avec
« pas de spéculation » et avec le KYC qui gouverne aujourd'hui les limites (`KYC_LIMITS`).
Techniquement : allowlist on-chain adossée au niveau KYC.

---

## Risques propres à ce code

| Risque | Détail |
|---|---|
| **Mint dérivé d'un batch mal gardé** | Le paiement producteur (`0018`) mint déjà des tokens comptables. Le mint on-chain doit dériver du **même** batch gardé, sinon on reproduit C1 sans possibilité de correction |
| **Genesis** | La migration des soldes existants est un mint unique et massif, à faire de façon vérifiable et publiquement justifiable |
| **Réserve ≠ offre** | Aujourd'hui un `CHECK` SQL garantit l'invariant. On-chain, plus rien ne le garantit : c'est le réconciliateur qui devient le garde-fou, et il est *a posteriori* |
| **Contrats non patchables** | Prévoir la stratégie d'upgrade **avant** le premier déploiement, pas après |

---

## Recommandation

**Faire la phase 1, et seulement elle, dans un premier temps.**

Elle délivre le bénéfice qui motive réellement le projet — une réserve vérifiable par un tiers —
pour un coût faible, sans toucher à la custody, sans exposition réglementaire, et sans introduire
un second registre irréversible dans un système dont l'atomicité vient tout juste d'être réparée.

Puis réévaluer honnêtement si la phase 2 apporte quelque chose à l'utilisateur. Pour un produit
domestique, KYC-gaté et explicitement non spéculatif, des soldes on-chain custodiaux ajoutent
surtout du risque opérationnel : l'utilisateur ne gagne ni souveraineté, ni liquidité, ni frais
réduits. La phase 2 ne se justifie que si la phase 3 est le but réel — auquel cas la question
réglementaire du § 4 doit être tranchée **avant**, pas après.

Enfin : rien de tout ceci ne devrait passer avant les bloquants go-live déjà identifiés
(Cloudflare Access sur les portails, clés providers, alerting, push FCM mort). Un ancrage on-chain
d'une plateforme dont le back-office n'est pas encore derrière un Zero-Trust prouverait surtout la
solidité du mauvais maillon.
