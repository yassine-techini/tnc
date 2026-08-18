# ADR 018 — Ce qui appartient au pays

- **Statut** : accepté
- **Date** : 2026-08-18
- **Contexte** : constats AI et AJ du onzième audit

## Contexte

`country_config` a été construite pour qu'un second pays coûte une ligne plutôt
qu'un projet. Deux choses lui échappaient encore.

**Les pièces d'identité.** La colonne qui les reçoit était contrainte aux
documents d'un seul pays :

```sql
CHECK (document_type IN ('CNIB', 'PASSPORT', 'PERMIT', 'CEDEAO'))
```

Confrontée aux valeurs déjà semées : `CNI` — la carte nationale de la Côte
d'Ivoire, du Mali et du Sénégal — refusée ; et sur les quatre documents ougandais,
seul le passeport passait. **Un Ougandais sans passeport ne pouvait pas faire de
KYC du tout.** La même énumération était répétée en `z.enum` sur la route de
dépôt.

**Les seuils d'argent.** Trois garde-fous sont des clés globales nommées en XOF,
appliquées telles quelles partout. Ce que « 1 000 000 » signifie réellement :

| Devise | Seuil 2FA |
|---|---|
| XOF | 1 626 USD |
| UGX | 270 USD |
| GHS | 83 333 USD |

En Ouganda le second facteur serait réclamé pour presque chaque opération — la
friction qui fait relever un seuil jusqu'à l'éteindre. Au Ghana il ne se
déclencherait jamais.

## Décisions

### 1. La base garde la forme, le pays décide du contenu

Un `CHECK` ne peut pas interroger une autre table, et énumérer l'union de tous les
pays ramènerait une migration à chaque ouverture — exactement ce que
`country_config` existe pour éviter.

La contrainte retenue est donc celle qui vaut pour **tous** les pays : un jeton
non vide, en majuscules, sans espace. L'appartenance à la liste du pays est
vérifiée **au dépôt**, là où le pays de l'utilisateur est connu.

### 2. Un refus nomme ce qui est accepté

```
Ce type de document n'est pas accepté pour Uganda.
Documents acceptés : NATIONAL_ID, PASSPORT, DRIVING_PERMIT, REFUGEE_ID.
```

« Type de document invalide » n'apprend rien à quelqu'un qui tient sa carte
nationale à la main. Le message porte la liste, et les détails la portent aussi
sous forme exploitable par un client.

### 3. Les seuils monétaires appartiennent au pays ; ceux en grammes, non

Distinction qui n'avait pas été faite, et qui règle la moitié du problème toute
seule : **les plafonds d'achat sont en grammes**, donc identiques partout. Un
gramme est un gramme à Ouagadougou comme à Kampala. Ils restent globaux.

Seuls trois seuils sont monétaires, et passent dans `country_config` :

| Colonne | Rôle |
|---|---|
| `high_value_threshold` | au-delà, second facteur exigé (ADR 009) |
| `withdraw_daily_standard` | plafond de retrait quotidien, niveau STANDARD |
| `withdraw_daily_verified` | idem, niveau VERIFIED |

`NULL` signifie « non fixé » et fait retomber sur la clé globale, qui garde son
rôle de valeur par défaut plutôt que de valeur universelle.

### 4. Les montants semés sont indicatifs, et le disent

Les valeurs par pays sont dérivées d'une référence en USD (1 500 / 800 / 8 000)
et arrondies à un chiffre lisible dans la devise locale.

Elles sont **indicatives**. Un plafond de retrait est une contrainte
réglementaire, fixée par un régulateur, pas par un taux de change : la migration
le dit, et l'exploitant doit les revoir pour chaque juridiction avant ouverture.
Les semer permet qu'un pays activé ne parte pas avec les seuils d'un autre ; cela
ne remplace pas la décision.

## Conséquences

- Ouvrir un pays reste une ligne de configuration, y compris pour ses documents et
  ses seuils.
- Un utilisateur non burkinabè peut déposer sa pièce d'identité. C'était un
  blocage dur au premier utilisateur hors du pays d'origine.
- Le second facteur se déclenche sur un montant comparable d'un pays à l'autre.

## Ce qui n'est pas fait

**Le grand livre n'a toujours qu'une devise** (constat AK). `cash_balance` et
`cash_amount` ne portent aucune devise, et `gold_prices` ne stocke qu'une
conversion. Les seuils par pays fonctionnent aujourd'hui parce qu'un utilisateur
et son pays partagent la même devise implicite ; ils resteront corrects une fois
la dimension devise ajoutée, mais ils ne la remplacent pas.

**Les décimales ne sont toujours pas honorées** (constat AL). Arrondir à l'entier
reste juste pour le XOF et l'UGX, faux pour le cedi ou le naira. Ce correctif ne
touche pas l'arithmétique.

**Aucune reprise des seuils déjà appliqués.** Les transactions passées ont été
jugées avec l'ancien seuil ; les rejuger n'aurait aucun sens.
