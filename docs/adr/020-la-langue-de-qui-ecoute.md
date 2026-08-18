# ADR 020 — La langue de qui écoute

- **Statut** : accepté
- **Date** : 2026-08-18
- **Contexte** : constat AN du onzième audit (et achèvement d'AL)

## Contexte

`country_config.locale` était exposée par la route publique et **jamais consultée
côté serveur**. L'Ouganda est déclaré `en-UG` : un raffineur ougandais recevait
« Bienvenue sur TNC Trading », puis « Votre KYC a été approuvé ».

Ce n'est pas une question de confort. Ces messages portent des instructions —
quel document fournir, quelle limite est atteinte, pourquoi un retrait est refusé
— et un message incompris devient un appel au support, ou un abandon.

## Décisions

### 1. Le texte est séparé de la mise en page

Les gabarits mêlaient l'un et l'autre sur des centaines de lignes de HTML.
Les dupliquer par langue aurait doublé un fichier de 943 lignes et créé un piège
d'entretien : deux coquilles à corriger pour un bouton déplacé.

**Une coquille, un texte par langue.** Ajouter une troisième langue coûte
désormais un bloc de chaînes, pas un gabarit.

### 2. La langue vient du pays, pas d'un réglage de plus

`langueDeLUtilisateur(db, userId)` lit la locale du pays du titulaire. Aucun
réglage supplémentaire à maintenir faux : le pays est déjà connu, et il porte
déjà sa locale.

Le français reste le repli — d'une locale inconnue comme d'un pays absent. C'est
la langue d'origine de la plateforme, et un repli explicite vaut mieux qu'une
chaîne vide.

### 3. L'accroche ne nomme aucun pays

Le courriel de bienvenue disait « la plateforme souveraine de tokenisation d'or
**du Burkina Faso** » et « Investissez dans l'or **du Burkina Faso** ». Vrai d'un
pays, faux dès le deuxième, et adressé à des raffineurs qui n'y sont pas.

### 4. Corollaire — l'arrondi suit enfin la devise partout (constat AL)

Les quatre services portaient chacun `const xof = (n) => Math.round(n)`. Ils
passent tous par `arrondirMonnaie(montant, décimales)`, et les décimales
**voyagent avec la ligne** qui en a besoin : `positionsToAccrue` et
`holdersToCharge` les joignent, plutôt qu'une requête par calcul dans un travail
qui parcourt toutes les positions.

Deux libellés figés tombent avec :

- le relevé de règlement PDF imprimait « XOF » quel que soit le pays ;
- `AdvanceCurrency = 'TOKENS' | 'XOF'` désignait un **mode** de règlement, où
  « XOF » signifiait « en espèces ». Pour un raffineur ougandais, « payé en XOF »
  n'a aucun sens : il est payé en espèces, et ses espèces sont des shillings.
  La valeur devient `'CASH'` (migration 0041).

## Conséquences

- Un utilisateur reçoit ses courriels et ses SMS dans la langue de son pays.
- Ajouter une langue est un bloc de chaînes ; ajouter un pays reste une ligne.
- Aucun montant calculé ne perd ses centimes dans une devise qui en a.

## Ce qui n'est pas fait

**Les 338 messages d'erreur en ligne de l'API restent en français.** Le contrat
avec les clients est le **code** (`error.code`), pas le texte : le web traduit
déjà côté client à partir du code, et c'est la bonne place — elle ne demande pas
un aller-retour serveur pour changer de langue.

Ce qui manque est donc un **catalogue bilingue partagé par code**, remplaçant la
copie privée de `apps/web/src/hooks/useApiError.ts`. L'API émet 108 codes
distincts, dont 41 figurent dans le catalogue partagé actuel : compléter et
traduire cet ensemble est un travail à part entière, et le livrer à moitié
donnerait un mélange de langues, pire que du français cohérent.

**Le portail de l'État n'est pas concerné** : il est hors périmètre.
