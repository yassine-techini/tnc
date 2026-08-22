# ADR 026 — Une erreur de validation est une erreur comme les autres

- **Statut** : accepté
- **Date** : 2026-08-22
- **Contexte** : trouvé en instruisant le second volet du constat AN
- **Prolonge** : [ADR 025](025-la-langue-d-une-reponse.md)

## Contexte

`CLAUDE.md` fixe la forme d'une erreur d'API :

```ts
interface ApiError {
  success: false;
  error: { code: string; message: string; details?: object };
  requestId: string;
}
```

Trois cent cinquante-neuf sites la respectent. **Vingt-six ne la respectent pas**,
et ce sont ceux qui n'écrivent aucun code : les routes qui délèguent la
validation à `zValidator`.

`@hono/zod-validator` 0.4.3, quand aucun *hook* ne lui est fourni, répond :

```js
if (!result.success) {
  return c.json(result, 400);
}
```

`result` est le résultat brut de Zod. Mesuré sur la version installée :

```json
{"success":false,"error":{"issues":[{"validation":"email","code":"invalid_string",
 "message":"Email invalide","path":["email"]}],"name":"ZodError"}}
```

```
error.code    → undefined
error.message → undefined
requestId     → undefined
```

Trois conséquences, par ordre de gravité :

1. **Un client qui aiguille sur `error.code` reçoit `undefined`.** C'est le
   contrat que tout le reste de la plateforme tient, et c'est celui sur lequel
   les applications web et mobile branchent leur affichage.
2. **Il existe pourtant un `code` dans la réponse** — `issues[0].code`,
   c'est-à-dire `invalid_string`, `too_small`, un code *interne à Zod*. Un client
   qui le trouverait en cherchant « code » aiguillerait sur le vocabulaire d'une
   bibliothèque tierce.
3. **Aucun `requestId`** : la seule erreur qu'un utilisateur rencontre
   couramment est justement celle qu'il ne peut pas rapporter au support.

Ce n'est pas un cas limite. Ces vingt-six routes couvrent l'inscription, la
connexion, le rafraîchissement de jeton, le dépôt, le retrait.

## Décision 1 : un hook partagé, pas vingt-six hooks

Un seul hook, appliqué à chaque `zValidator`, rend la forme de la plateforme :

```ts
{
  success: false,
  error: {
    code: 'VALIDATION_ERROR',
    message: <message du premier problème> || texte(c, 'VALIDATION_ERROR'),
    details: <les problèmes>,
  },
  requestId,
}
```

Vingt-six hooks écrits à la main auraient diverge — c'est le raisonnement de
l'[ADR 023](023-un-seul-dispositif-de-reservation.md) sur la réservation de
stock, et de l'[ADR 009](009-second-facteur-sur-les-transactions.md) sur le
second facteur : une règle recopiée ne protège plus que les chemins dont on se
souvient.

**Un garde-fou l'impose.** `check:messages` refuse désormais un `zValidator`
dépourvu du hook. Sans cela, la prochaine route ajoutée réintroduit la forme
brute, et personne ne le verra avant qu'un client ne s'en plaigne.

## Décision 2 : le message précis reste, le catalogue est le repli

Le message affiché est celui du **premier problème** rencontré — « Montant
minimum : 1000 XOF » —, et le catalogue prend le relais quand il n'y en a pas.

C'est exactement la forme retenue par l'[ADR 025](025-la-langue-d-une-reponse.md)
pour les six routes qui parsent à la main. Deux formes pour la même situation
auraient été une incohérence de plus, pas une amélioration.

**Conséquence assumée** : ces messages-là sont rédigés dans les schémas Zod et
restent **en français**. Le message de repli, lui, est bilingue. On ne traduit
pas ici les quatre-vingt-un libellés des schémas : c'est une surface distincte
(`packages/shared/validators` et les schémas en ligne), et la mélanger à celle-ci
aurait reproduit le mélange que l'ADR 025 a précisément défait.

Ce qui est acquis en revanche : **le code et le `requestId` sont là**, donc un
client peut afficher son propre texte à partir du code — ce que l'application web
fait déjà.

## Ce que cet ADR ne tranche pas

- **La traduction des libellés de schéma.** Elle demande soit de les retirer au
  profit d'un `errorMap` bilingue reconstruit depuis le type de problème et ses
  paramètres, soit de les dupliquer par langue. Le premier est plus propre et
  change le texte de toutes les validations : cela se décide, cela ne se glisse
  pas dans un correctif de forme.
- **Le plafonnement du nombre de problèmes renvoyés** dans `details`.
