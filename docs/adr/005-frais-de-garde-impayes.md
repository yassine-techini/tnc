# ADR 005 — Un frais de garde que le solde ne couvre pas est enregistré impayé

- **Statut** : accepté
- **Date** : 2026-08-16
- **Contexte** : phase 5 (répartition d'un lot, frais de garde à Dubaï)

## Contexte

Le stockage chez TNC à Dubaï est désormais facturé : 0,5 %/an, prélevés **en
XOF** sur le solde espèces du raffineur.

Or `wallets.cash_balance` porte une contrainte `CHECK (cash_balance >= 0)`. Un
prélèvement supérieur au solde ne « passe pas en force » : il fait échouer
l'écriture. Un raffineur qui garde 900 g et n'a aucun solde espèces — cas
parfaitement normal, puisqu'il a livré de l'or et non de l'argent — se trouve
donc dans cette situation dès le premier jour.

Trois issues étaient possibles, et il fallait en choisir une explicitement.

## Décision

**Le frais est enregistré, avec le statut `OUTSTANDING`.** Il n'est ni perdu, ni
imposé. Le job de prélèvement repasse ensuite sur les impayés dès que le solde
le permet, du plus ancien au plus récent.

## Raisons

**Ne pas facturer quand le solde est vide reviendrait à offrir la garde à ceux
qui n'ont pas d'espèces** — c'est-à-dire à la quasi-totalité des raffineurs, dont
le métier est de livrer du métal. Le service serait facturé sur le papier et
gratuit en pratique.

**Assouplir la contrainte `cash_balance >= 0` est hors de question.** C'est elle
qui empêche un retrait concurrent de mettre un compte à découvert ; elle protège
une invariante bien plus large que les frais de garde. On ne relâche pas un
garde-fou financier pour faire passer une ligne de facturation.

**Prélever en grammes à la place** aurait détruit des tokens et donc touché à
`tokens_issued`, sur un chemin automatique tournant chaque jour. La décision
prise est de facturer en XOF ; convertir silencieusement en or quand les espèces
manquent contredirait ce choix au pire moment.

**Un impayé enregistré est une dette lisible.** Le raffineur voit ce qu'il doit,
la plateforme sait ce qu'elle n'a pas encaissé, et le total se reconstitue ligne
à ligne — même propriété que l'accrual de location.

## Conséquences

- Le job quotidien fait deux choses : calculer le frais du jour, puis tenter de
  régler les impayés les plus anciens. Un raffineur qui vend une part de son lot
  solde mécaniquement son arriéré au prélèvement suivant.
- L'accrual reste **idempotent par jour** (`UNIQUE (user_id, accrual_date)`) :
  rejouer le job ne facture pas deux fois, qu'il ait payé ou non.
- **L'or en location n'est pas facturé.** Il n'est pas dans le coffre, et il
  rémunère déjà son détenteur ; facturer une garde qui n'a pas lieu serait
  prélever deux fois pour le même gramme.
- Les frais ne s'appliquent qu'aux profils `REFINER` (clé
  `storage_fee_applies_to`). Un investisseur particulier finance déjà la
  plateforme par le spread d'achat et de vente ; l'étendre à tous est un
  changement de configuration, pas de code — mais c'est une décision produit,
  pas une décision technique, et elle n'a pas été prise ici.
- **Aucune relance, aucune pénalité, aucun blocage** n'est implémenté sur un
  arriéré. Un impayé n'empêche ni de vendre, ni de retirer. Si le recouvrement
  doit avoir des conséquences, c'est une décision à prendre séparément — et il
  vaut mieux qu'elle soit absente et visible que devinée dans un job.

## Alternative écartée

Bloquer le retrait tant qu'un arriéré existe. Cela rendrait le recouvrement
automatique, mais transformerait un job de facturation en contrôle sur les
fonds d'un tiers — avec le risque de bloquer les espèces d'un raffineur pour
quelques milliers de francs de garde. À rouvrir avec le juridique, pas dans le
code.
