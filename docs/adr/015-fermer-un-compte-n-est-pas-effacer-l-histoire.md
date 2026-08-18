# ADR 015 — Fermer un compte n'est pas effacer l'histoire

- **Statut** : accepté
- **Date** : 2026-08-18
- **Contexte** : constat AB du neuvième audit

## Contexte

`DELETE /users/me` supprimait en cascade douze tables, puis la ligne `users`.

Le garde était sérieux — mot de passe exigé, solde nul, aucune transaction en
cours. Mais **douze autres tables référencent `users(id)` sans
`ON DELETE CASCADE`** et ne figuraient pas dans le lot : `quotes`,
`transaction_verifications`, `certificates`, `lease_positions`, `lease_accruals`,
`lot_dispositions`, `storage_fee_accruals`, les quatre tables de consignation, le
profil raffineur.

Les clés étrangères étant appliquées, `DELETE FROM users` échouait, tout le lot
était annulé, et l'utilisateur recevait :

```
INTERNAL_ERROR — « Erreur lors de la suppression du compte »   (500)
```

`quotes` suffisait : **tout utilisateur ayant demandé un seul devis** ne pouvait
pas fermer son compte, et n'apprenait pas pourquoi. Aucun test ne couvrait ce
chemin.

Deux défauts de conception se cachaient derrière la panne :

- **Le solde à zéro ne prouve pas qu'on ne détient rien.** La location sort les
  grammes du portefeuille : un utilisateur avec 100 g en position active affiche
  un solde nul et franchissait le garde.
- **Les transactions terminées auraient été effacées** si la suppression avait
  abouti — un registre qui alimente les volumes publiés à l'État et la
  réconciliation des périodes passées.

Et un troisième, indépendant de la panne : les lignes `kyc_documents` étaient
supprimées, mais **les images chiffrées restaient dans R2**, désormais sans
aucune ligne pour les désigner. La donnée personnelle survivait à sa propre
suppression, et personne ne pouvait plus la retrouver pour l'effacer.

## Décisions

### 1. Fermer, ce n'est pas supprimer

La ligne `users` **subsiste**, anonymisée. C'est ce qui permet de tenir les deux
obligations à la fois : retirer la donnée personnelle, et conserver le registre
des opérations.

Sont **retirés** : pièces d'identité et leurs objets R2, sessions, appareils de
confiance, codes de récupération, préférences, alertes de prix, notifications,
historique de mots de passe, événements de sécurité.

Sont **conservés** : transactions, piste d'audit, certificats, positions de
location closes, historique de consignation. Ce sont des écritures, pas des
données de profil.

L'identité est remplacée par une valeur dérivée de l'identifiant technique —
`closed+<id>@invalid`, un téléphone inutilisable — parce que `email` et `phone`
sont `UNIQUE NOT NULL` et qu'un compte fermé ne doit ni bloquer une réinscription,
ni se faire passer pour un compte vide.

### 2. Ce qui empêche la fermeture se dit

Trois vérifications s'ajoutent, chacune avec son code et son message :

| Condition | Code |
|---|---|
| Position de location active | `LEASE_POSITION_OPEN` |
| Lot de consignation en cours | `CONSIGNMENT_IN_PROGRESS` |
| Frais de garde impayés | `STORAGE_FEES_OUTSTANDING` |

La première est celle qui manquait vraiment : le solde à zéro d'un prêteur est
un solde à zéro **parce que** son or est prêté.

Un utilisateur doit comprendre ce qu'il lui reste à faire. `INTERNAL_ERROR` ne le
lui dit pas.

### 3. Les objets R2 partent avant la ligne qui les désigne

L'ordre est imposé : lire les clés, supprimer les objets, **puis** supprimer les
lignes. L'inverse — celui qui était en place — perd le pointeur et laisse la
donnée.

Une suppression R2 qui échoue **interrompt la fermeture**. Annoncer un compte
fermé en laissant les pièces d'identité en ligne serait le pire des deux mondes :
l'utilisateur croit ses documents détruits, et ils ne le sont pas.

### 4. La fermeture est tracée

`ACCOUNT_CLOSED` est une action permanente du registre (ADR 014) : elle porte
`user_id`, la date, et ce qui a été conservé. Fermer un compte est une opération
sur des avoirs — elle appartient à la piste au même titre qu'un retrait.

## Conséquences

- Le chemin fonctionne enfin. Il ne fonctionnait pour personne ayant demandé un
  devis, c'est-à-dire pour personne ayant utilisé la plateforme.
- Les volumes publiés à l'État ne changent plus quand un utilisateur s'en va.
  Auparavant, une fermeture aurait modifié rétroactivement des rapports déjà
  transmis.
- `GET /users/me` et l'authentification refusent un compte fermé : la ligne existe,
  le compte non.

## Ce qui n'est pas fait

**Aucune purge différée des transactions conservées.** Une obligation de
conservation a une durée, et cette durée est juridique, pas technique — elle
dépend du régulateur burkinabè et du statut retenu pour la plateforme. Le code
conserve donc sans limite plutôt que d'inventer un délai. Le jour où la durée sera
fixée, c'est cette décision qu'il faudra rouvrir.

**La révocation joue au rafraîchissement, pas à chaque requête.**
`authMiddleware` ne touche pas la base : ajouter une lecture par requête serait un
changement de modèle de session, pas un effet de bord de ce correctif. Un jeton
d'accès déjà émis reste donc valide jusqu'à son expiration (15 minutes), exactement
comme après une déconnexion ou une réinitialisation de mot de passe.

**Pas de suppression administrative.** Un exploitant ne peut pas fermer le compte
d'un tiers par cette voie ; seul le titulaire le peut, avec son mot de passe. Un
retrait de compte imposé est une sanction, et une sanction se conçoit avec son
propre circuit d'autorisation.
