# ADR 003 : Ancrage on-chain des attestations de réserve

## Statut

**Accepté** — tranche l'[ADR 002](002-smart-contracts.md) pour le seul périmètre de l'ancrage.
L'émission d'un token transférable on-chain reste hors périmètre et n'est pas décidée ici.

## Contexte

La phase 1 de l'ADR 002 publie des attestations de réserve signées et chaînées. Chacune embarque
l'empreinte de la précédente : réécrire une attestation ancienne casse la sienne et rompt tout ce
qui suit. Ancrer **une seule** empreinte récente à l'extérieur couvre donc tout l'historique
derrière elle — quelques transactions par mois suffisent, pas une par mouvement.

Reste à décider où, et comment.

## Décision 1 : pas de smart contract, l'empreinte va dans les données de transaction

L'ancrage consiste à écrire 32 octets de façon horodatée et non réécrivable. Un contrat n'est pas
nécessaire pour ça : une transaction de valeur nulle vers soi-même, portant l'empreinte en
*calldata*, est immuable, lisible par n'importe qui, et coûte le minimum.

Déployer un contrat aurait ajouté ce que l'ADR 002 signalait comme le risque le plus lourd de la
phase 2 : **l'administrateur d'un proxy évolutif devient le secret le plus critique de la
plateforme**, devant `JWT_SECRET`, et un bug de contrat ne se corrige pas comme un déploiement
Worker. Pour un usage qui n'a besoin d'aucune logique on-chain, c'est un coût de sécurité sans
contrepartie.

**Conséquence pour le vérificateur** : il récupère la transaction par son hash et lit son champ
`input`. Aucune ABI, aucune adresse de contrat à faire confiance.

## Décision 2 : adaptateur chaîne-agnostique, EVM en première implémentation

L'ADR 002 laissait ouverte la question de la chaîne, avec un avertissement qui tient toujours :
**une chaîne permissionnée opérée par le même acteur reproduit l'hypothèse de confiance de la base
de données**. Si l'objectif est la preuve, l'ancrage doit vivre là où l'opérateur ne peut pas
réécrire l'histoire — donc une chaîne publique.

L'interface `AnchorAdapter` isole ce choix. La première implémentation vise une chaîne EVM à frais
faibles (Base ou Polygon PoS), sélectionnée par configuration et non codée en dur.

**Testnet par défaut.** L'ancrage mainnet exige de renseigner explicitement le réseau : un
déploiement mal configuré ancre sur un testnet, il ne dépense pas de fonds réels par accident.

## Décision 3 : la clé de signature de chaîne n'est pas la clé d'attestation

Deux secrets distincts, deux rôles :

| Secret | Rôle | Conséquence d'une fuite |
|---|---|---|
| `ATTESTATION_SIGNING_JWK` | Signe le contenu de l'attestation (ES256) | Un tiers peut forger une déclaration de réserve |
| `ANCHOR_PRIVATE_KEY` | Signe la transaction on-chain (secp256k1) | Un tiers peut vider le portefeuille d'ancrage et publier de faux ancrages |

Les mélanger donnerait à une clé de portefeuille chaud la capacité de forger la réserve. Le
portefeuille d'ancrage ne détient que de quoi payer ses frais.

## Décision 4 : l'ancrage est idempotent et découplé de la publication

Le job d'ancrage tourne **après** celui d'attestation, séparément. Une attestation existe et se
vérifie sans ancrage ; l'ancrage est une confirmation supplémentaire, pas une condition.

`recordAnchor()` est gardé sur `anchor_tx_hash IS NULL` : un retour en double, ou un retry après
timeout réseau, ne peut pas réécrire quelle transaction a ancré quoi.

## Ce que l'ancrage ne prouve pas

À énoncer clairement, parce que c'est là que ce genre de dispositif est sur-vendu.

L'ancrage prouve qu'une empreinte **existait à une date donnée** et n'a pas été modifiée depuis.
Il ne prouve **pas** que l'or existe, ni que le contenu de l'attestation est vrai. La véracité
repose sur l'audit physique à Dubaï et sur les lots référencés dans la charge utile. La chaîne
n'apporte que l'horodatage infalsifiable et l'impossibilité de réécrire l'historique.

Depuis 0025, la charge utile distingue l'or **en coffre** de l'or **prêté**. Un lecteur qui ne
regarderait que `invariantHolds` conclurait à une couverture intégrale alors qu'une partie de la
réserve est chez une contrepartie. C'est `fullyVaulted` et `activeLoans` qui portent cette
information — l'ancrage les rend infalsifiables, il ne les rend pas vraies.

## Dépendance

La construction et la signature d'une transaction EVM demandent keccak256, RLP et secp256k1.
WebCrypto ne fournit pas secp256k1, donc une bibliothèque est nécessaire (`viem`). L'adaptateur
l'importe **paresseusement** : sans la dépendance ou sans configuration, l'ancrage se signale
indisponible au lieu de casser le déploiement — même logique fail-closed que le reste.
