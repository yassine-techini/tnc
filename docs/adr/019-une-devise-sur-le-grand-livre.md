# ADR 019 — Une devise sur le grand livre

- **Statut** : accepté
- **Date** : 2026-08-18
- **Contexte** : constat AK du onzième audit (et son corollaire AL)

## Contexte

`wallets.cash_balance`, `transactions.cash_amount`, `fees`, `total_spent` :
**aucune colonne ne porte de devise.** L'unité vit dans un commentaire du schéma
— « Total XOF dépensés ».

`gold_prices` ne stocke qu'une conversion : `price_usd`, un `exchange_rate`
unique, et `price_xof`. Un utilisateur ougandais recevrait donc un prix en francs
CFA, présenté comme le sien.

Le dépôt le savait : la migration ougandaise dit « UGX n'est pas XOF : le flux de
prix est coté en USD et converti, donc un pays en UGX a besoin de son propre
taux, pas d'un FCFA relabellisé ». L'écart n'était pas entre ignorance et savoir,
mais entre ce qui était su et ce que le schéma permettait.

## Décisions

### 1. La devise vit sur l'argent, pas sur le lecteur

Un solde et une transaction portent leur devise, **figée à l'écriture**.

Dériver la devise du pays de l'utilisateur au moment de la lecture serait faux :
un titulaire peut changer de pays, et une écriture passée doit garder l'unité
dans laquelle elle a été faite. Un registre financier porte sa propre unité —
c'est exactement ce que le constat reproche à l'état actuel.

Deux colonnes suffisent : `wallets.currency` et `transactions.currency`. Les
autres montants (devis, rendements, frais, acomptes) se règlent **dans** un
portefeuille et partagent sa devise par construction. Ajouter dix-neuf colonnes
répéterait la même information sans rien garantir de plus.

### 2. Le prix a une référence, pas une conversion figée

`gold_prices` garde `price_usd` comme **référence** — le métal est coté en USD.
Les taux vivent dans `exchange_rates`, une ligne par devise et par relevé.

Le prix local se calcule : `price_usd × taux(devise)`.

`price_xof` n'est pas renommé, et ce n'est pas un compromis : la colonne contient
bien le prix en XOF, elle reste donc exacte. Ce qui change est qu'elle cesse
d'être **la** conversion pour devenir **une** conversion, celle de la zone franc.

### 3. Pas de taux pour cette devise ⇒ on refuse

Servir un prix en francs CFA à un Ougandais parce que le sien manque serait pire
que de ne rien servir : le chiffre aurait l'air juste. Le lecteur de prix échoue
donc **fermé**, comme la clé de chiffrement absente ou l'export introuvable.

### 4. L'arrondi suit la devise, pas le franc CFA

Corollaire indissociable (constat AL) : dès qu'une ligne connaît sa devise,
l'arrondi doit suivre les décimales de cette devise. `Math.round` était juste
pour le XOF et l'UGX, qui n'ont pas de sous-unité, et faux pour le cedi, le
shilling kényan, le naira ou le rand, qui en ont deux — chaque frais et chaque
rendement y aurait perdu ses centimes, toujours dans le même sens.

`arrondirMonnaie(montant, decimales)` remplace les quatre copies de
`const xof = (n) => Math.round(n)`.

## Conséquences

- Ouvrir un pays hors zone franc devient : une ligne de pays, un taux, une liste
  de jours fériés, des seuils. Plus une migration.
- Un solde sait ce qu'il vaut. Un relevé aussi.
- Le prix servi à un utilisateur est dans sa devise, ou n'est pas servi.

## Ce qui n'est pas fait

**Aucune conversion entre devises.** Un portefeuille en UGX ne devient pas un
portefeuille en XOF : il n'existe pas de chemin qui change la devise d'un solde.
C'est volontaire — convertir des avoirs est une opération de change, avec son
cours, sa marge et sa trace, et elle mérite sa propre décision.

**Le champ de contrat `priceXof` n'est pas renommé.** Il est exact pour la zone
franc et le renommer toucherait 70 sites dans les contrats et quatre clients. Le
renommage est mécanique et guidé par le compilateur ; il mérite son propre
commit, pas d'être enfoui dans celui-ci.

**Les taux ne sont pas alimentés automatiquement pour les nouvelles devises.** Le
travail de rafraîchissement écrit le taux qu'il obtient de son fournisseur ;
ajouter une devise demande que ce fournisseur la couvre. La table le rend
possible, elle ne le fait pas.
