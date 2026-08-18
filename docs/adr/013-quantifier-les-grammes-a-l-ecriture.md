# ADR 013 — Quantifier les grammes à l'écriture

- **Statut** : accepté
- **Date** : 2026-08-18
- **Contexte** : constat T du huitième audit

## Contexte

`wallets.token_balance` est un `REAL`, et chaque achat écrivait
`token_balance = token_balance + ?`. L'addition flottante de valeurs pourtant
quantifiées au milligramme dérive. **Trois achats suffisent** :

```
0.018 + 2.106 + 4.337
  solde stocké  = 6.4609999999999994102
  affiché       = 6.461 g          (formatGrams → toFixed(3))
  token_balance >= 6.461  →  FAUX  (il manque 8,9 × 10⁻¹⁶ g)
```

L'écran montre `6.461 g`. L'utilisateur saisit `6.461`. Le garde
`WHERE id = ? AND token_balance >= ?` ne modifie **aucune ligne**, et la
contrainte `CHECK (token_balance >= 0)` refuserait de toute façon le débit.
Réponse : **solde insuffisant**, sur le solde exact que l'interface vient
d'afficher.

Quelqu'un l'avait déjà rencontré. `disposition.service.ts` comparait avec une
tolérance d'un demi-milligramme — mais c'était le **seul** endroit à la porter,
alors que la vente, la mise en location et le pré-contrôle d'`executeSellAtomic`
comparaient sans indulgence. Une correction avait été appliquée là où le problème
s'était manifesté, pas là où il vit.

## Décisions

### 1. La quantification se fait à l'ÉCRITURE, en SQL

Ajouter des tolérances aux comparaisons n'aurait pas suffi : le garde qui décide
n'est pas le `if` en JavaScript, c'est la contrainte `CHECK` de la base. Débiter
6,461 d'un solde de 6,4609999999999994 produit −8,9 × 10⁻¹⁶, que `CHECK
(token_balance >= 0)` refuse. Une tolérance en amont aurait laissé passer le
pré-contrôle pour échouer plus loin, avec un message pire.

Toutes les accumulations arrondissent donc au milligramme :

```sql
token_balance = ROUND(token_balance + ?, 3)
```

Le solde stocké devient alors **exactement** le double que produit le littéral
décimal correspondant. Vérifié sur le moteur réel, pas déduit :

```
sans arrondi : 6.4609999999999994102   → vendre 6.461 modifie 0 ligne
avec arrondi : 6.4610000000000002984   → vendre 6.461 modifie 1 ligne
                                          (et vaut === 6.461)
```

### 2. Les quatre colonnes de grammes, pas seulement les portefeuilles

`token_balance`, `tokens_issued`, `gold_on_loan` et `total_allocated` portent
toutes un poids au milligramme et s'accumulent toutes par `± ?`.

`tokens_issued` et `total_allocated` sont comparées entre elles par
`CHECK (tokens_issued <= total_allocated)`. Si l'une dérive et l'autre non, la
contrainte refuse une émission légitime — ou en laisse passer une qui ne l'est
pas. Corriger les portefeuilles seuls aurait corrigé l'instance, pas la catégorie,
soit exactement le reproche fait à la tolérance isolée de `disposition`.

### 3. Le XOF n'est pas concerné

`cash_balance` accumule des entiers : tous les montants passent par
`xof() = Math.round`. L'addition d'entiers est exacte en virgule flottante
jusqu'à 2⁵³, très au-delà de toute somme en francs CFA. Y ajouter un arrondi
n'aurait rien garanti de plus et aurait suggéré un risque qui n'existe pas.

La migration normalise tout de même `cash_balance` une fois, au cas où une
écriture passée aurait introduit une fraction.

### 4. Le contrôle remplace la convention

`pnpm check:grams` refuse toute accumulation écrite sans `ROUND(..., 3)`, et
tourne avant la suite de tests avec `check:sql` et `check:ownership`. Dix-huit
requêtes portent désormais cette règle : une règle répétée dix-huit fois est une
règle qu'on oubliera la dix-neuvième.

Le contrôle **ne comporte aucune expression régulière**. La première version
construisait la sienne dans une chaîne gabarit, où `\b` est l'échappement
« backspace » et non une limite de mot : elle ne trouvait rien et se déclarait
satisfaite. Le piège est déjà documenté dans `state-payload.test.ts`, et j'y suis
retombé en écrivant ce contrôle. Comparer des chaînes après normalisation des
espaces n'a pas d'échappement, donc pas de piège.

### 5. La dérive déjà accumulée est réparée

Sans reprise, un portefeuille existant garderait son écart jusqu'à sa prochaine
écriture. La migration 0035 requantifie les soldes en place.

**Aucun solde ne change de valeur** : 6,4609999999999994 devient 6,461, soit le
même poids au millionième de milligramme près. Ce qui change, c'est la
**comparabilité**.

## Conséquences

- Un utilisateur peut vendre, louer ou répartir la totalité de ce que son écran
  affiche. C'était le symptôme.
- Un portefeuille vidé retombe **exactement** à zéro. Un résidu de 10⁻¹⁵ g le
  laissait compté comme détenteur par les écrans et suivi par les frais de garde.
- La tolérance d'un demi-milligramme de `disposition.service.ts` est retirée :
  elle masquerait désormais un retour de la dérive au lieu de la compenser.

## Ce qui n'est pas fait

**Les grammes restent un `REAL`.** Les stocker en entiers de milligrammes
supprimerait la question au lieu de la traiter, mais toucherait chaque requête,
chaque contrainte et chaque charge utile du dépôt. La quantification à l'écriture
donne la même garantie pratique pour un coût sans commune mesure. Si la précision
devait un jour descendre sous le milligramme, c'est cette décision qu'il faudrait
rouvrir — pas ajouter une décimale.
