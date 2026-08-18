# ADR 012 — Un seul vocabulaire pour la réserve

- **Statut** : accepté
- **Date** : 2026-08-18
- **Contexte** : constats U et V du huitième audit

## Contexte

Cinq routes du portail État et deux routes d'administration calculaient leurs
chiffres de réserve à partir de `SUM(wallets.token_balance)`.

Ce n'est pas le nombre de jetons émis. La location **sort les grammes du
portefeuille** et alimente `gold_on_loan` sans toucher `tokens_issued` : le jeton
existe toujours, il est seulement prêté. La somme des portefeuilles vaut donc
`tokens_issued − gold_on_loan`.

Le portail affichait ce nombre sous l'étiquette **« Tokens Émis »**. Avec
1 000 g alloués, 900 g émis et 400 g en location :

| | Affiché à l'État | Réel |
|---|---|---|
| « Tokens Émis » | 500 g | 900 g |
| « Disponible » | 500 g | 100 g |
| Couverture | 200,0 % | 111,1 % |

L'écart est exactement l'or en location, et il va dans le sens flatteur.

Un second désordre, de nommage celui-là. Le fichier de contrats distinguait
délibérément deux notions :

> `coverage` est ici le taux d'UTILISATION (émis / alloué), l'inverse du
> `coverageRatio` du portail État (alloué / émis). Deux notions, deux noms —
> **les confondre inverserait la lecture.**

La distinction était juste. Ce que le commentaire n'a pas vu, c'est que
`MarketStockData.coverage` employait le **même nom** `coverage` pour la notion de
*ratio*. Deux contrats, un seul mot, deux valeurs réciproques.

Et le back-office confondait exactement comme annoncé :

```tsx
const isCovered = (stock?.coverage || 0) >= 1;   // apps/admin/src/pages/Stock.tsx
```

Appliqué à un taux d'utilisation, que l'invariant `tokens_issued <=
total_allocated` maintient sous 1. L'écran affichait donc « non couvert » en
permanence, et ne passait au vert **qu'au moment où l'utilisation atteint 100 %**
— c'est-à-dire quand il ne reste plus un gramme disponible. Le voyant s'allumait
au moment le plus tendu.

## Décisions

### 1. `tokens_issued` est la seule mesure des jetons émis

Aucune route ne dérive « jetons émis » d'une somme de portefeuilles. La somme des
portefeuilles reste légitime là où la question porte réellement sur les
portefeuilles — la répartition par tranche —, et nulle part ailleurs.

### 2. Un module unique porte l'arithmétique de la réserve

`src/lib/reserve.ts` calcule une fois pour toutes : émis, en coffre, disponible,
couverture, utilisation, invariant, entièrement en coffre. Les routes ne
recalculent plus, elles lisent.

Le précédent est `stock-invariant.ts`, pour la même raison qui y est écrite :
« une règle extraite se teste ; reproduire la même arithmétique dans un test
prouverait la copie, pas la route ».

### 3. Un mot, une grandeur

| Nom | Formule | Sens |
|---|---|---|
| `coverageRatio` | `alloué / émis` | ≥ 1 est sain — combien d'or garantit un jeton |
| `utilisationRate` | `émis / alloué` | ≤ 1 — quelle part de l'allocation est engagée |

`MarketStockData.coverage` devient `coverageRatio` : c'était un ratio portant le
nom de l'autre notion. `AdminStockData.coverage` devient `utilisationRate` :
sous ce nom, `>= 1` ne s'écrit plus par distraction.

Renommer coûte du remaniement sur du code par ailleurs correct. Ce coût n'est
accepté que là où **le nom lui-même a produit le défaut** — ces deux champs, et
`StateDashboardData.totalTokens` qui devient `tokensIssued` parce qu'il était
étiqueté « Tokens Émis » en portant autre chose. Les noms exacts et non trompeurs
(`tokensInCirculation`) ne sont pas touchés : du remaniement sur du code juste
achète du risque, pas de la sûreté.

### 4. `entièrement en coffre` prend la définition de l'attestation

Deux définitions coexistaient et se contredisaient le même jour :

```
attestation      tokens_issued <= (alloué − prêté)
tableau de bord  gold_on_loan === 0
```

Avec 1 000 g alloués, 900 g émis et 50 g en location, l'attestation **signée**
répond oui (900 ≤ 950) et le tableau de bord affichait l'alerte rouge.

C'est la définition de l'attestation qui l'emporte : c'est elle qui est signée,
publiée et opposable. « Aucun gramme n'est prêté » est une autre question — elle
reste lisible dans `goldOnLoan`, qui est déjà divulgué.

### 5. Sans jeton émis, la couverture n'est pas un nombre

`alloué / 0` valait `Infinity`, que `JSON.stringify` transforme en `null` : le
contrat annonçait `number` et la route livrait `null`, sur le chemin le plus
public de la plateforme.

La couverture devient explicitement `number | null`, `null` signifiant « aucun
jeton émis, le ratio est sans objet ». Les écrans affichent alors `—` et **ne
déclenchent pas d'alerte** : une réserve sans engagement n'est pas une réserve
sous-couverte.

## Conséquences

- Sept routes changent de source de données. Aucune ne change de forme, sauf les
  trois champs renommés ci-dessus.
- L'émission n'était pas en cause et ne change pas : `canPurchase` lisait déjà
  `total_allocated − tokens_issued`, et la contrainte `CHECK` tenait. Ce
  correctif porte sur ce qui est **affiché**, pas sur ce qui est permis.
- Les chiffres publiés au ministère baissent. C'est le but : ils étaient
  surévalués de tout l'or en location.

## Ce qui n'est pas fait

**Aucune reprise de l'historique.** Les rapports mensuels déjà exportés portent
les anciens chiffres. Les recalculer demanderait de reconstituer `gold_on_loan`
jour par jour, qu'aucune table ne conserve — la même limite que celle rencontrée
en ADR 011 § 5. Un rapport déjà transmis se corrige par un rectificatif, pas par
une réécriture silencieuse.
