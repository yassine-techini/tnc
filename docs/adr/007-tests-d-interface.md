# ADR 007 — Tests d'interface : le web et l'État en jsdom, le mobile sur appareil

- **Statut** : accepté
- **Date** : 2026-08-17
- **Contexte** : couverture des interfaces (carnet § 2), quatre applications

## Contexte

Quatre applications ont des règles de couverture différentes, et l'écart n'avait
jamais été décidé — il s'était installé.

- `apps/web` : jsdom + Testing Library installés, mais deux fichiers de tests
  seulement (un hook, une vérification d'attestation).
- `apps/admin` : une configuration vitest, un fichier de mise en place, **53
  tests écrits** — et ni script `test` ni dépendances. Ils n'avaient jamais
  tourné une seule fois.
- `apps/state-portal` : rien.
- `apps/mobile` : 29 tests de logique pure, avec un commentaire refusant
  explicitement les tests de composants.

La question posée : faut-il un rendu de composants partout, y compris en React
Native ?

## Décision

**Les trois applications web (`web`, `admin`, `state-portal`) sont testées en
jsdom, rendu de composants compris.** Elles partagent React DOM, un même
lanceur (vitest) et une même bibliothèque. Le rendu y est fidèle : ce que jsdom
affiche est ce que le navigateur affiche, aux détails de mise en page près — et
la mise en page n'est pas ce qu'on teste.

**L'application mobile reste testée sur sa logique, pas sur ses composants.**
Le rendu de React Native sous vitest demanderait de transformer les sources
Flow de `react-native` 0.81, donc en pratique d'ajouter **jest** à côté de
vitest pour une seule application. Deux lanceurs dans un dépôt, c'est deux
configurations, deux façons d'écrire un doublon, et deux endroits où chercher
quand un test échoue — pour vérifier qu'un `<Text>` contient bien un texte.

Ce que le mobile gagne à la place : ses **magasins** et sa **validation**
passent sous test (session, jetons, expiration, réveil de l'application, bornes
de saisie). C'est là que se décident des résultats ; un composant qui affiche
une valeur déjà vérifiée n'en décide aucun.

La couverture bout-en-bout du mobile (Detox ou Maestro, sur appareil ou
émulateur) reste **manquante et assumée comme telle**. C'est elle qui apporterait
la garantie qu'un rendu simulé n'apporte pas — pas un rendu simulé de plus.

## Conséquences

- `apps/admin` : dépendances et script `test` ajoutés. Les 53 tests existants
  passent — ils étaient justes, seulement muets.
- `apps/state-portal` : mise en place jsdom + 33 tests (client API, magasin de
  session, écrans Stock, Tableau de bord et Connexion).
- `apps/mobile` : 29 → 50 tests, sans nouveau lanceur.
- Le carnet garde une entrée ouverte pour le bout-en-bout mobile. Elle ne se
  ferme pas en simulant un appareil.

## Ce qui a été trouvé en écrivant ces tests

Écrire les tests a mis au jour trois défauts réels, tous décrits dans le commit
correspondant : l'écran *Stock d'Or National* ne divulguait pas l'or prêté (le
tableau de bord le faisait), il affichait « 0 g » quand l'API ne répondait pas,
et les trois écrans de connexion à double facteur envoyaient la graine TOTP à
`api.qrserver.com` pour faire dessiner leur QR code.
