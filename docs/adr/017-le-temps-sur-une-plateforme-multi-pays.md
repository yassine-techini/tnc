# ADR 017 — Le temps sur une plateforme multi-pays

- **Statut** : accepté
- **Date** : 2026-08-18
- **Contexte** : constats AD, AE, AF et AH du dixième audit, et clarification du périmètre :
  la plateforme n'est pas dédiée au Burkina Faso, elle sera exploitée dans plusieurs pays
  d'Afrique, d'abord par des raffineurs et des coopératives, puis par de petits producteurs.

## Contexte

Le dixième audit a conclu que les travaux de nuit étaient corrects « parce qu'UTC **est** le
fuseau du Burkina Faso ». Ce raisonnement ne tient plus : le continent s'étend de UTC−1 (Cap-Vert)
à UTC+4 (Maurice), et Dubaï, où l'or est gardé, est à UTC+4.

Ce qui passait pour une propriété du système n'était qu'une coïncidence de déploiement.

Deux défauts actifs en découlent, tous deux issus de la même cause : **deux formats de date
coexistent dans la base**, celui de JavaScript (`toISOString()` → `2026-08-18T10:08:06.589Z`)
et celui de SQLite (`datetime('now')` → `2026-08-18 10:08:06`), et les colonnes sont comparées
**comme des chaînes**. Au rang 11, `T` (0x54) l'emporte sur l'espace (0x20).

- `quotes.expires_at` : un devis expiré depuis une heure reste consommable. Le verrou de prix
  de cinq minutes n'expire qu'au passage de minuit UTC.
- `users.suspended_until` : une suspension survit à son terme jusqu'à minuit.

## Décisions

### 1. Une seule horloge écrit les dates : celle de la base

Aucune colonne de date n'est plus alimentée par `new Date().toISOString()`. Les échéances
s'écrivent en SQL :

```sql
datetime('now', '+' || ? || ' minutes')
```

Deux raisons, dans cet ordre :

- **Un seul format.** La comparaison a lieu en SQL ; le format doit donc être celui de SQL.
  Normaliser à la lecture laisserait la porte ouverte à la prochaine écriture.
- **Une seule horloge.** Le worker et la base n'ont pas la même ; une échéance de cinq minutes
  calculée par l'un et jugée par l'autre porte leur écart.

`pnpm check:dates` refuse toute écriture d'une colonne d'échéance depuis JavaScript.

### 2. Le livre tient un seul calendrier, et c'est UTC — par décision, non par hasard

Un jour de rendement, un jour de frais de garde, une période de rapport sont des grandeurs
**de la plateforme**, pas du lecteur. Les rendre locales au pays du titulaire ferait accruer
la même position à des jours différents selon l'endroit où vit son propriétaire, alors que la
réserve, elle, est commune.

Conséquence assumée : un producteur à Nairobi (UTC+3) voit le rendement de la veille arriver à
7 h locales. C'est explicable. Un livre à calendriers multiples ne l'est pas.

Ce choix était déjà celui du code ; il n'était pas écrit, et il était justifié par un argument
faux.

### 3. L'affichage est local au LECTEUR, jamais au Burkina

`TIMEZONE = 'Africa/Ouagadougou'` et `nowInBurkinaFaso()` disparaissent — ils n'étaient
d'ailleurs appelés nulle part.

Un horodatage rendu à l'écran est converti dans le fuseau de l'appareil, que le navigateur
connaît. `country_config.timezone` reste la référence pour ce que le serveur rend **sans
lecteur** : un relevé PDF, une notification programmée, un libellé d'heure dans un courriel.

Corollaire opérationnel : les horodatages sans fuseau de SQLite doivent être lus comme de
l'UTC. `parseApiDate` le fait déjà dans `packages/shared` ; la copie privée de `apps/web`
disparaît au profit de la fonction partagée.

### 4. Le calendrier ouvré appartient à un pays, pas à la plateforme

`country_config` porte désormais `business_holidays`, une liste de dates ISO. La sortie de
location passe la liste du pays concerné à `settlementDate`, dont le paramètre existait depuis
l'origine sans qu'aucun appelant ne le remplisse.

La liste est **vide par défaut**, et c'est délibéré : `business-days.ts` explique depuis le
début qu'« une liste fausse produirait silencieusement de mauvaises dates de règlement ».
Fournir les jours fériés d'un pays est un acte d'exploitation, pas une constante de code. Ce
qui change, c'est qu'il existe enfin un endroit où les mettre.

## Conséquences

- Le verrou de prix de cinq minutes fonctionne. C'était le chemin de l'argent : un devis fige
  un cours, et l'expiration est ce qui borne ce gel.
- Une suspension se lève à l'heure dite.
- Les heures affichées sont justes partout, et non plus seulement sur le méridien de Greenwich.
- Un pays peut déclarer ses jours fériés sans toucher au code.

## Ce qui n'est pas fait

**Le portail de l'État est hors périmètre** et n'est pas modifié ici, y compris le décalage des
bornes du rapport mensuel (constat AG). Cette version fait l'objet d'un traitement à part.

**Aucun rattrapage des devis déjà consommés hors délai.** Rien ne permet de distinguer, dans
l'historique, une exécution tardive d'une exécution normale : les deux ont produit une
transaction valide au prix du devis. Reconstituer le préjudice demanderait de rejouer les cours
minute par minute — et la décision d'indemniser ou non appartient à l'exploitant.

**Les fuseaux ne sont pas rendus configurables par utilisateur.** L'appareil sait où il est ;
lui demander de le redire serait un réglage de plus à maintenir faux.
