# ADR 022 — Ce que la base calcule elle-même

- **Statut** : accepté
- **Date** : 2026-08-18
- **Contexte** : constats AO et AP du douzième audit

## Contexte

`POST /admin/stock/adjust` lisait `total_allocated`, calculait le nouveau total
en JavaScript, puis écrivait une valeur **absolue** :

```ts
const stock    = await …SELECT total_allocated…;
const newTotal = stock.total_allocated + amount;
…UPDATE gold_stock SET total_allocated = ? WHERE id = ?
```

Rien ne liait l'écriture à la valeur lue. Mesuré sur un vrai moteur : deux
ajustements simultanés de +100 g et +50 g sur 1 000 g donnent **1 050 g**, pas
1 150. Cent grammes d'or national disparaissent, et la piste d'audit enregistre
les **deux** — le registre affirme ce que le stock ne reflète pas.

Séparément, le verrou de transaction était relâché sur chaque `return` mais sans
`try/finally` : une exception entre la prise et le relâchement laissait le
titulaire incapable d'acheter, de vendre ou de retirer, les trois partageant ce
verrou.

## Décisions

### 1. Une quantité s'incrémente, elle ne se réécrit pas

```sql
UPDATE gold_stock
   SET total_allocated = ROUND(total_allocated + ?1, 3), updated_at = datetime('now')
 WHERE id = ?2 AND ROUND(total_allocated + ?1, 3) >= tokens_issued
```

C'est la forme déjà employée partout ailleurs depuis l'ADR 013 pour les soldes et
les compteurs. L'ajustement du stock en était **le seul écart** du dépôt.

### 2. La garde arbitre, le contrôle en JavaScript explique

`verifierAjustementStock` reste : il produit le message utile dans le cas courant
— « 900 g sont déjà émis, l'allocation ne peut pas descendre en dessous ». Mais
ce n'est plus lui qui décide. Sous concurrence, c'est le `WHERE … >= tokens_issued`
qui tranche, et son `changes` que l'appelant lit.

Même partage que sur le chemin d'achat, où le contrôle en JavaScript donne le
motif et la contrainte `CHECK` arbitre. Ce n'est pas une redondance : l'un sert à
parler, l'autre à garantir.

### 3. La trace calcule l'avant et l'après en SQL

L'insertion d'audit vient **en premier** dans le lot : elle voit donc l'état
antérieur, et déduit le nouveau total par `ROUND(total_allocated + ?, 3)` plutôt
que de recopier une valeur calculée en JavaScript. Exact même si un autre
ajustement s'intercale.

Elle porte en outre la **même garde** que l'écriture : un ajustement refusé
n'écrit aucune trace. Une trace annonçant ce qui n'a pas eu lieu serait pire que
pas de trace.

### 4. Le verrou se relâche dans un `finally`

Deux gestionnaires sur trois relâchaient sur chaque chemin de sortie ; le
troisième — le retrait — avait déjà son `try/finally`, et montrait donc la forme
correcte à quelques centaines de lignes de là.

Une libération dispersée dépend de l'exhaustivité du lecteur ; un `finally` n'en
dépend pas.

## Conséquences

- Deux administrateurs peuvent ajuster le stock à la même seconde sans qu'aucune
  livraison ne se perde.
- Un ajustement concurrent qui ferait passer le total sous les jetons émis reçoit
  un 409 explicite, et non un succès silencieux.
- Une erreur passagère pendant un achat ne bloque plus le titulaire deux minutes.

## Ce qui n'est pas fait

**`atomicPurchaseStock` reste sans appelant** (constat AQ). Le supprimer ou le
brancher demande de choisir entre les deux dispositifs corrects qui coexistent
sur le chemin d'achat ; ce choix mérite d'être fait pour lui-même, pas en marge
d'un correctif de concurrence.

**Le niveau KYC voyage toujours dans le jeton.** Une rétrogradation ne s'applique
qu'au prochain rafraîchissement, jusqu'à quinze minutes plus tard. Le middleware
ne touche volontairement pas la base (ADR 017 § 3) ; changer cela est une décision
sur le modèle de session, pas un correctif.
