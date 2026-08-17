# ADR 008 — Maestro pour le bout-en-bout mobile, et un contrôle statique qui, lui, tourne partout

- **Statut** : accepté
- **Date** : 2026-08-17
- **Contexte** : point laissé ouvert par [ADR 007](./007-tests-d-interface.md)

## Contexte

L'ADR 007 a fermé la question du rendu de composants et laissé une seule chose
ouverte : la couverture bout-en-bout du mobile, sur appareil ou émulateur. Deux
outils la couvrent, Detox et Maestro.

Une contrainte s'est ajoutée en cours de route : **la machine de développement ne
peut pas exécuter ces parcours**. Le SDK Android est installé et `adb` répond,
mais il n'y a aucune image système, aucun AVD, et pas de JDK. Y remédier veut
dire télécharger plusieurs gigaoctets (image système, JDK, Maestro, puis la
chaîne Gradle/NDK pour compiler l'application native).

## Décision

**Maestro plutôt que Detox.**

- Detox injecte un lanceur de tests dans la compilation native et demande macOS
  pour iOS. Il faut donc une variante de build dédiée, maintenue en parallèle de
  celle qui part en production.
- Maestro pilote l'application **telle qu'elle est livrée**. Les parcours sont
  du YAML déclaratif, lisibles par quelqu'un qui ne code pas — utile pour des
  parcours qui décrivent des règles métier (« un compte BASIC ne peut pas
  acheter »). Les attentes implicites et les reprises intégrées évitent l'essentiel
  des `sleep` qui rendent ce genre de suite instable.
- Le coût : un langage de moins d'expressivité que du JavaScript. Pour trois
  parcours critiques, c'est le bon échange.

**Les parcours désignent des `testID`, pas des libellés.** L'application n'en
portait aucun. Ils ont été ajoutés sur le chemin critique — connexion, onglets,
marché, portefeuille, bannières de message, dialogue de confirmation. Un
sélecteur fondé sur le texte affiché casse à la première reformulation, et ne
distingue pas deux boutons qui portent le même mot.

**Un contrôle statique fait la moitié du chemin, sans appareil.**
`scripts/check-e2e-selectors.mjs` confronte chaque sélecteur des parcours aux
`testID` réellement posés dans les sources, et chaque `runFlow:` à un fichier
existant. Il ne prouve pas qu'un parcours passe ; il prouve qu'il ne désigne rien
d'imaginaire.

C'est la transposition exacte du travail sur les contrats de réponse. Un parcours
qui nomme `marche-valider` alors que rien ne porte cet identifiant est le même
mensonge qu'un type de client qui déclare un champ qu'aucune route ne renvoie —
sauf qu'il se paie plus cher : l'échec arrive sur un appareil, après une
compilation complète, sous la forme d'un délai dépassé qui ressemble à une
lenteur réseau.

Corollaire assumé : **les `testID` s'écrivent en entier**, jamais assemblés par
interpolation. Un identifiant construit à l'exécution est introuvable
statiquement, donc invérifiable ; le contrôle le refuse plutôt que de devenir
silencieusement inopérant.

## Conséquences

- 3 parcours + 1 sous-parcours réutilisable dans `apps/mobile/e2e/`.
- 25 `testID` posés sur le chemin critique.
- Le contrôle statique est **aussi** un test (`check-e2e-selectors.test.mjs`), donc
  il part avec `pnpm test` : un renommage de `testID` est attrapé sans qu'il faille
  penser à lancer le script.
- `pnpm e2e` et `pnpm e2e:critique` sont câblés mais **inutilisables en l'état** sur
  cette machine.

## Ce qui n'est pas fait, et doit être dit

**Les trois parcours n'ont jamais été exécutés contre un appareil.** Ils sont
écrits et leurs sélecteurs sont prouvés existants ; ils ne sont pas prouvés
passants. Un premier passage sur émulateur révélera vraisemblablement des attentes
à ajuster — c'est le comportement normal d'une suite bout-en-bout neuve, et ce
n'est pas une raison pour présenter ces fichiers comme une couverture acquise.

Ce qu'il faut pour franchir ce pas est listé dans `apps/mobile/e2e/README.md`.
Tant que ce n'est pas fait, l'entrée reste ouverte au carnet — au même titre
qu'avant, mais avec le travail préparatoire fait et vérifiable.
