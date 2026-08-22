# ADR 027 — La langue d'une validation

- **Statut** : accepté
- **Date** : 2026-08-22
- **Contexte** : le reste nommé par l'[ADR 025](025-la-langue-d-une-reponse.md) et l'[ADR 026](026-une-erreur-de-validation-est-une-erreur.md)

## Contexte

L'ADR 025 a rendu bilingues les réponses d'erreur de l'API, et a nommé son reste :
les messages **rédigés dans les schémas Zod**. L'ADR 026 les a conservés à
l'affichage, avec le catalogue en repli. Ils restaient donc en français.

Ce n'est pas un détail d'affichage. Ces messages sont ceux qu'un utilisateur voit
le plus souvent — un champ mal rempli est plus fréquent qu'un stock insuffisant —
et ils portent une instruction : *quel* caractère manque au mot de passe, *quel*
format la date attend.

Un point technique gouverne la solution : **un message posé sur un schéma
l'emporte sur toute carte d'erreurs**. Zod construit l'issue avec
`issueData.message || errorMessage` : le message du schéma gagne, toujours. Une
carte d'erreurs bilingue seule ne pouvait donc rien traduire tant que les
messages restaient écrits.

## Décision : deux mécanismes, parce qu'il y a deux situations

### Ce qui se déduit du problème n'est plus écrit

Un champ requis, une longueur, un courriel mal formé, une valeur hors
énumération : Zod décrit tout cela dans l'issue — `code`, `minimum`, `type`,
`validation`, `options`. `traduireProbleme` le remet en mots, dans les deux
langues, et **ces messages disparaissent des schémas**.

```ts
.min(12, 'Le mot de passe doit contenir au moins 12 caractères')   // avant
.min(12)                                                            // après
```

→ « Mot de passe : 12 caractères au minimum » / "Password : At least 12 characters"

### Ce qui ne s'en déduit pas devient une clé

`.regex(/[A-Z]/)` et `.regex(/[0-9]/)` produisent le **même** problème,
`invalid_string`. Rien dans l'issue ne dit laquelle des deux règles a échoué.
Supprimer leur message aurait remplacé « au moins une majuscule » par « format
invalide » — une perte, pas une traduction.

Ces règles gardent donc un message, mais ce message est une **clé** :

```ts
.regex(/[A-Z]/, 'MDP_MAJUSCULE')
```

Quatorze clés couvrent les règles de mot de passe, le format téléphonique, la
date ISO, les caractères d'un nom, et les quatre affinements (`refine`) qui
portaient une phrase.

## Le nom du champ est traduit aussi

« Mot de passe : au moins une majuscule » se lit mieux que « format invalide », et
c'est ce que les anciens messages disaient chacun à leur manière. Un catalogue de
champs fournit le préfixe.

**Un champ absent du catalogue n'est pas une erreur** : le message se passe alors
de préfixe, plutôt que d'afficher `corridorOriginCountry` à un lecteur.

Une leçon de la première version, corrigée : les phrases **ne renomment pas le
champ**. « Adresse e-mail invalide » préfixé donnait « Adresse e-mail : adresse
e-mail invalide ». Les phrases sont désormais neutres — « Adresse invalide ».

## Où la traduction a lieu

**Au rendu, pas à l'analyse.** Puisque le message d'un schéma l'emporte, la carte
d'erreurs ne suffirait pas ; c'est le constructeur de la réponse qui traduit,
qu'il s'agisse d'une clé ou d'un message engendré.

Conséquence heureuse : **`zValidator` n'a pas eu à être remplacé.** La première
version de cette décision prévoyait un validateur maison pour injecter la carte
au moment de l'analyse — 26 sites de plus à réécrire. Traduire au rendu obtient
le même résultat sans y toucher.

La carte d'erreurs `carteErreursZod` reste exportée pour les **clients qui
valident en local** : eux n'ont pas de réponse d'API à traduire, et lisent le
message de Zod directement.

Deux points d'entrée, un seul catalogue :

- `surErreurDeValidation` — les 26 routes qui passent par `zValidator` ;
- `messageValidation(c, issues)` — les six routes qui analysent à la main. À
  utiliser **partout** plutôt que de lire `issues[0].message`, qui rendrait
  désormais `CORRIDOR_REQUIS` au lecteur.

## Ce qu'un garde-fou impose

`check:messages` refuse désormais **toute prose dans un schéma Zod**, dans l'API
comme dans le paquet partagé — c'est là que vivent l'inscription et le mot de
passe. Une chaîne contenant un espace ou un accent, sur une ligne de schéma,
échoue le contrôle. Les clés et les expressions régulières passent.

## Ce que cet ADR ne tranche pas

- **Une troisième langue.** Le catalogue en accueille une sans changer de forme,
  mais rien n'est promis : c'est un jeu de textes de plus à tenir.
- **Les libellés de documents** — types de pièces, natures de transaction,
  niveaux de vérification — restent en français. Ils composent des documents
  français (certificats, relevés) et relèvent d'une autre décision.
