# ADR 025 — La langue d'une réponse

- **Statut** : accepté
- **Date** : 2026-08-22
- **Contexte** : second volet du constat AN — le catalogue d'erreurs de l'API
- **Prolonge** : [ADR 020](020-la-langue-de-qui-ecoute.md)

## Contexte

L'[ADR 020](020-la-langue-de-qui-ecoute.md) a traduit les **notifications** : un
raffineur ougandais ne reçoit plus « Bienvenue sur TNC Trading ». Les **réponses
de l'API**, elles, sont restées en français, et le premier volet du constat AN
s'était arrêté là volontairement — traduire la moitié des messages aurait produit
un mélange pire que l'uniformité.

L'inventaire complet, mesuré et non estimé :

| | |
|---|---|
| Sites d'erreur | **359**, dans 22 fichiers |
| Codes distincts émis | **119** |
| Codes présents dans le catalogue partagé | **41** |
| Messages interpolés | 33 |
| Codes portant plusieurs messages différents | 29 |

Deux choses que l'inventaire a révélées et que l'on ne cherchait pas :

- **L'API n'était pas « en français », elle était en français *et* en anglais.**
  `Server misconfigured`, `Unable to fetch gold price`, `Admin access required`,
  `direction must be "above" or "below"`, `This endpoint requires a WebSocket
  connection` partaient déjà en anglais. Le mélange existait déjà, il n'était
  simplement pas décidé.
- **`INTERNAL_ERROR` portait 90 sites et une cinquantaine de messages distincts**
  qui nomment l'étape interne ayant échoué : « Erreur lors du chargement du
  dashboard », « Erreur lors de l'ajustement du stock », « Erreur lors de la
  révocation ». Ces phrases ne servent pas le lecteur — elles décrivent la
  plomberie à quelqu'un qui ne peut rien en faire.

## Décision 1 : la langue vient de la requête, pas du pays

Pour une **notification**, il n'y a pas de requête : le seul signal disponible
est le pays du destinataire, et l'ADR 020 lit `country_config.locale`.

Pour une **réponse d'API**, il y a un client qui déclare sa langue. On lit donc
l'en-tête `Accept-Language`, et le français reste le défaut.

Ce n'est pas une contradiction avec l'ADR 020 : c'est la même règle — *la langue
de qui écoute* — appliquée au meilleur signal disponible dans chaque contexte.

**On ne consulte pas la base pour cela**, et c'est délibéré. `langueDeLUtilisateur`
existe et fait une requête ; l'appeler ici mettrait une lecture de base sur le
chemin d'erreur, c'est-à-dire précisément là où la base est parfois la cause de
l'erreur. Une réponse d'erreur ne doit dépendre de rien qui puisse échouer à son
tour. Sans en-tête exploitable, on répond en français.

## Décision 2 : le message quitte le site d'appel

C'est le point qui rend la suite tenable.

Un site d'erreur nomme **un code** et, s'il y a lieu, ses **paramètres**. Il ne
porte plus de texte :

```ts
error: { code: 'WALLET_NOT_FOUND', message: texte(c, 'WALLET_NOT_FOUND') },
error: {
  code: 'TRADING_LIMIT_EXCEEDED',
  message: texte(c, 'TRADING_LIMIT_EXCEEDED', { limiteG: 100, periode: 'jour' }),
},
```

**La forme de la réponse ne bouge pas** — seul le texte s'en va. Réécrire les
359 sites en `return erreur(c, 'CODE', 404)` aurait été plus élégant, et
c'était une transformation *structurelle* sur du code de contrôle de flux : la
classe d'édition qui, deux fois dans cet audit, a supprimé de la logique en
croyant déplacer une accolade. Le remplacement d'une seule valeur sur une seule
ligne obtient la même garantie — plus aucun français au site d'appel — pour une
fraction du risque.

Le code se retrouve donc écrit deux fois, sur deux lignes voisines. C'est
acceptable **parce que c'est vérifié** : `check:messages` refuse un
`texte(c, 'X')` dont l'erreur voisine annonce un autre code. Une duplication
contrôlée par une machine n'est pas une duplication.

L'alternative — garder le français au site d'appel et n'ajouter qu'une couche
anglaise — a été écartée. Elle laisse **deux sources de vérité pour le même
message**, qui divergent en silence dès la première retouche, et aucun contrôle
statique ne peut rattraper la dérive puisque les deux textes sont légitimes
chacun de leur côté. Le catalogue possède les deux langues, ou il n'en possède
aucune.

Conséquence directe : un sixième garde-fou, `check:messages`, refuse désormais
toute réponse d'erreur portant un texte littéral, et vérifie que **tout code émis
existe dans le catalogue dans les deux langues**.

## Décision 3 : `INTERNAL_ERROR` dit une seule chose

Les cinquante variantes deviennent un message unique. L'étape qui a échoué part
dans les journaux, où elle a toujours eu sa place, et le `requestId` reste le
lien entre le lecteur et le support.

Ce n'est pas qu'un gain de traduction. Une réponse d'erreur qui annonce « Erreur
lors du chargement des logs d'audit » renseigne un appelant non authentifié sur
la structure interne de la plateforme. Le détail ne lui est d'aucun usage, et il
n'a pas à le recevoir.

Même raisonnement pour les messages qui reversaient un texte interne au client —
`err.message`, `lockError.message`, `paymentResult.error`, les `issues` de Zod.
Ils sont remplacés par le message du catalogue ; le détail technique reste
disponible dans `details`, qui n'est peuplé qu'en développement.

## Ce que cette décision ne change pas

- **Les codes ne bougent pas.** Un client peut aiguiller dessus ; les renommer
  serait une rupture de contrat. Les doublons repérés à l'inventaire
  (`INVALID_PASSWORD` / `AUTH_INVALID_PASSWORD`, `KYC_PENDING` /
  `KYC_ALREADY_PENDING`, `RATE_LIMITED` / `RATE_LIMIT_EXCEEDED` /
  `AUTH_RATE_LIMITED`) sont **conservés tels quels** et documentés dans le
  catalogue. Les unifier est une décision d'API, pas de traduction.
- **`ERROR_MESSAGES` du paquet partagé reste** : il sert les applications front,
  qui affichent un message à partir d'un code reçu. Le catalogue de l'API le
  recouvre pour les 119 codes réellement émis.

## Ce que cet ADR ne tranche pas

- **Les autres langues.** Le catalogue est structuré par langue et en accueille
  une troisième sans changement de forme, mais rien n'est promis : une langue de
  plus, c'est 119 textes à écrire et à maintenir.
- **La négociation fine de `Accept-Language`** (poids `q`, variantes
  régionales) : on lit la première langue reconnue, ce qui suffit tant qu'il y en
  a deux.
