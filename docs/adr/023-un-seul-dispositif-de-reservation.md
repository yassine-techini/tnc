# ADR 023 — Un seul dispositif de réservation

- **Statut** : accepté
- **Date** : 2026-08-18
- **Contexte** : constat AQ du douzième audit

## Contexte

`MarketService.atomicPurchaseStock` et `atomicSellStock` réservaient le stock
correctement — incrément relatif et garde de disponibilité dans la **même**
instruction — et n'avaient **aucun appelant**. Le chemin d'achat réel passe par
`WalletService.executeBuyAtomic`.

Les deux avaient des tests, verts. C'est précisément pour cela qu'ils ont
survécu : des tests verts sur du code mort ressemblent à une couverture.

## Décisions

### 1. La réservation vit là où elle peut être atomique

Elle est retirée de `MarketService` plutôt que branchée.

La raison n'est pas que le code mort dérange, mais qu'**un seul des deux
emplacements peut être correct**. Réserver le stock, débiter les espèces et
écrire la transaction doivent réussir ou échouer ensemble ; cela n'est possible
que dans un lot unique, et ce lot est dans `executeBuyAtomic`. Une méthode
séparée, si soignée soit-elle, réserve dans sa propre transaction — donc réserve
parfois sans que l'achat aboutisse.

Un lecteur cherchant comment le stock est réservé trouvait d'abord la méthode
nommée pour cela, et en tirait une conclusion fausse sur ce qui s'exécute.

### 2. Le motif d'un échec se lit dans l'état, pas dans le message

Le classement des échecs cherchait un nom de colonne dans le texte de l'erreur :

```ts
if (msg.includes('tokens_issued') || msg.includes('total_allocated')) …
```

Cela tient tant que SQLite recopie l'expression de la contrainte. Mesuré :

```
contrainte anonyme : "CHECK constraint failed: tokens_issued <= total_allocated"  → reconnu
contrainte NOMMÉE  : "CHECK constraint failed: stock_couvert"                     → NON
```

Nommer une contrainte est banal dans une migration. `INSUFFICIENT_STOCK` serait
alors devenu `CONFLICT` en silence, et le titulaire se serait entendu dire
« réessayez » alors qu'il n'y a pas assez d'or.

`raisonDeLEchec` relit l'état. Le lot ayant été annulé, cet état est celui d'avant
la tentative — donc exactement celui qui explique l'échec. Une requête de plus,
sur un chemin qui a déjà échoué.

### 3. Le contrôle préalable reste, et n'est pas une redondance

`executeBuyAtomic` vérifie toujours le stock et le solde en JavaScript avant le
lot. Ce n'est pas ce qui garantit — c'est ce qui **explique**, dans le cas
courant, sans faire échouer une transaction pour produire un message.

La garantie reste la contrainte `CHECK`, qui annule le lot entier. Le partage est
le même que sur l'ajustement de stock (ADR 022) : l'un sert à parler, l'autre à
garantir.

## Conséquences

- Une seule réponse à « où le stock est-il réservé ».
- Le motif rendu à l'utilisateur ne dépend plus du texte d'un moteur.

## Ce qui n'est pas fait

**Le contrôle préalable court-circuite la fonction de classement**, ce qui rend
celle-ci intestable à travers `executeBuyAtomic` : un test passant par lui
n'atteint jamais le `catch`. Elle est donc exportée et testée directement.

Ce n'est pas satisfaisant — une fonction exportée pour ses tests l'est un peu
pour de mauvaises raisons. L'alternative serait de supprimer le contrôle
préalable et de laisser la contrainte tout arbitrer, au prix d'un message moins
direct dans le cas courant. Cet arbitrage mérite d'être fait sur pièces, en
mesurant ce que coûte réellement une transaction annulée sur D1.
