# ADR 011 — Rattraper un jour manqué, au prix de ce jour-là

- **Statut** : accepté
- **Date** : 2026-08-18
- **Contexte** : constat R du septième audit

## Contexte

Les travaux de nuit `lease-accrual` (rendement de location) et `storage-fee`
(frais de garde) parcourent leurs bénéficiaires sans gestion d'erreur par
élément. Une erreur passagère sur le 300ᵉ arrête la boucle : les 200 suivants ne
sont jamais traités ce jour-là.

Le commentaire en tête du fichier promet pourtant l'inverse :

> *Skipping leaves the day unaccrued and the job picks it up on the next run
> rather than booking a wrong figure.*

**Le code ne fait pas ce que le commentaire annonce.** `positionsToAccrue` retient
bien les positions en retard, mais le travail les crédite ensuite pour la date
**courante**. La position est reprise ; le jour perdu, jamais. Le rendement de ce
jour n'est pas versé, et le frais de garde de ce jour n'est pas facturé.

Un détail aggrave le rattrapage : le prix utilisé est le dernier connu
(`ORDER BY timestamp DESC LIMIT 1`), pas celui du jour valorisé. Sur un jour de
décalage, l'approximation est mince. Sur un rattrapage de deux semaines, elle est
fausse.

## Décisions

### 1. Un jour manqué se rattrape au prix de ce jour-là

Le rendement d'un jour est la valeur du métal **ce jour-là**. Le rattraper au
cours d'aujourd'hui reviendrait à payer un rendement que le marché n'a pas
produit — dans un sens ou dans l'autre, au hasard de la direction du cours.

Le prix retenu pour une date est **le dernier relevé de cette journée**
(`timestamp` dans les bornes du jour). C'est la clôture de fait, cohérente avec la
règle existante « un jour n'est révolu qu'une fois terminé ».

### 2. Pas de prix pour ce jour-là ⇒ on ne rattrape pas ce jour

Si le relevé de prix a lui aussi échoué ce jour-là, il n'existe aucune
valorisation défendable. Inventer une valeur — interpoler, reprendre la veille,
prendre celle d'aujourd'hui — produirait un chiffre qu'aucun audit ne pourrait
justifier.

Le jour reste donc **non rattrapé**, et il est signalé. C'est l'échec fermé déjà
retenu ailleurs : mieux vaut un trou visible qu'un chiffre inventé.

### 3. Le rattrapage est borné, et la borne se voit

Une position ouverte depuis un an avec `last_accrued_on` à `NULL` demanderait 365
itérations. Le rattrapage est plafonné (`accrual_backfill_max_days`, 30 par
défaut, ajustable en base).

Atteindre le plafond **n'est pas un succès partiel silencieux** : le travail
consigne explicitement les bénéficiaires restés en retard. Le précédent est celui
de la sauvegarde — une table tronquée fait échouer l'exécution plutôt que de se
dire complète.

### 4. Une position jamais créditée part de sa date d'ouverture

`last_accrued_on` à `NULL` ne veut pas dire « on ne sait pas depuis quand » : la
position porte sa date d'ouverture. Le travail valorise la veille, donc une
position ouverte le 10 voit son 10 crédité dans la nuit du 11 — son premier jour
dû est bien son jour d'ouverture.

Sans cette référence, une panne de cinq jours ne rattraperait qu'une seule
journée pour une position récente : les quatre autres seraient perdues au moment
même où le mécanisme est censé les sauver.

Ceci ne change pas l'économie du produit — le jour d'ouverture était déjà
crédité. C'est le rattrapage qui s'aligne sur la règle existante.

### 5. Le rendement se rattrape, les frais de garde non

Les deux travaux ont la même forme, mais **une asymétrie de données** interdit de
les traiter pareil.

Une position de location fige son `principal_g` à l'ouverture : rattraper un jour
ancien ne demande que le prix de ce jour-là, et la quantité est certaine.

Un frais de garde porte sur `wallets.token_balance` — le solde **du moment**.
Aucune table ne conserve le solde d'un titulaire jour par jour. Facturer un jour
d'il y a deux semaines au solde d'aujourd'hui reviendrait à faire payer la garde
d'un or qu'il ne détenait peut-être pas alors, dans un sens comme dans l'autre.

Les frais de garde ne sont donc **pas rattrapés**. Le jour manqué est signalé,
pas reconstitué. Le reconstituer demanderait de rejouer les mouvements pour
retrouver le solde de chaque jour — un travail comptable qui mérite sa propre
décision, pas un effet de bord de ce correctif.

### 6. Une défaillance par bénéficiaire ne fait plus tomber les suivants

Chaque bénéficiaire est traité dans son propre `try`. Une erreur est consignée,
comptée, et la boucle continue.

Le motif existait déjà dans le même dossier : `lease-settlement` attrape par
élément, appelle `failExit`, et poursuit. Il ne manquait qu'à l'appliquer.

## Conséquences

- `LeaseService.accrueDay` et `StorageFeeService.accrueDay` sont inchangés : ils
  prennent déjà une date et un prix en paramètre. C'est l'appelant qui itère.
- Le rattrapage ne concerne que la location. Les frais de garde gagnent la reprise
  par élément et la visibilité, pas le rattrapage (§ 5).
- Les deux travaux renvoient désormais un compte-rendu : traités, rattrapés, en
  échec, sans prix, encore en retard.
- Le diagnostic de disponibilité peut s'en saisir plus tard ; pour l'instant le
  compte-rendu part au journal, avec un niveau d'erreur dès qu'un bénéficiaire
  reste en retard.

## Ce qui n'est pas fait

**Aucun rattrapage rétroactif des jours déjà perdus.** Ce correctif protège
l'avenir ; il ne reconstitue pas ce qu'une défaillance passée aurait effacé.
Reconstituer demanderait de décider quels jours sont dus à qui — une question
comptable, pas technique, et qui appartient à l'exploitant.
