# ADR 014 — Un registre pour les actions d'audit

- **Statut** : accepté
- **Date** : 2026-08-18
- **Contexte** : constat AA du neuvième audit

## Contexte

Un cron purge `audit_logs` au-delà de la rétention (`cleanup_audit_log_days`,
365 jours par défaut), en épargnant une liste d'actions réputées critiques :

```ts
const criticalActions = [
  'KYC_APPROVED', 'KYC_REJECTED', 'USER_SUSPENDED',
  'WITHDRAWAL_APPROVED', 'STOCK_ADJUSTED', 'ADMIN_CREATED',
];
```

Les routes écrivaient `KYC_APPROVE`, `WITHDRAWAL_APPROVE`, `STOCK_ADJUST` — des
infinitifs, là où la liste attendait des participes passés. **Une entrée sur six
protégeait quelque chose.** La trace de qui a ajusté le stock d'or national
disparaissait donc au bout d'un an, alors qu'un mécanisme explicite existait pour
l'en empêcher.

Deux aggravations :

- `KYC_APPROVED` **est** écrite — par le rappel du prestataire de vérification,
  pas par la décision de l'administrateur. Les deux noms diffèrent d'une lettre et
  désignent des événements différents. La liste protégeait le verdict automatique
  et laissait purger la décision humaine.
- `ADMIN_CREATED` n'était écrite **nulle part**. Créer un administrateur — un
  compte qui peut valider un KYC, ajuster le stock et approuver un retrait — ne
  laissait aucune trace. La liste protégeait une action qui n'existait pas.

La purge s'exécutait sans la moindre erreur. C'est la forme de défaut la plus
coûteuse : un mécanisme qui rassure sans protéger décourage de regarder.

## Décisions

### 1. Une seule table, et le purgeur en dérive sa liste

`src/lib/audit-actions.ts` déclare chaque action avec son caractère permanent et,
pour les permanentes, **le motif écrit**. `session-cleanup` importe
`ACTIONS_PERMANENTES` au lieu de recopier une liste.

Deux listes écrites à la main divergent ; c'est arrivé, et personne ne pouvait le
voir.

### 2. Une action permanente porte sa justification

Le motif est obligatoire, comme pour les tables exclues de la sauvegarde
(ADR 010) et les routes dispensées de garde de propriété. Une exception sans
justification n'en est pas une : c'est un oubli qui a l'air d'une décision.

### 3. Aucune action construite par gabarit

`` `KYC_${action.toUpperCase()}` `` rendait la valeur écrite invisible à la
lecture comme au contrôle — et c'est exactement ainsi que l'écart a pu se creuser
en silence. Les trois sites concernés écrivent désormais des littéraux explicites.

Le contrôle **refuse** un gabarit au lieu de le tolérer. Une première version
bénissait toute action du registre partageant le préfixe : une entrée fantôme
`KYC_APPROVED_LEGACY` passait alors le contrôle sans être écrite nulle part. La
tolérance recréait le défaut qu'elle devait empêcher.

### 4. Le contrôle vérifie les DEUX sens

`pnpm check:audit` refuse :

- une action **écrite** absente du registre — elle échapperait à toute décision de
  rétention et serait purgée par défaut ;
- une entrée du registre que **personne n'écrit** — c'est ce sens qui manquait, et
  c'est lui qui attrape `ADMIN_CREATED` comme les participes passés.

Un contrôle qui ne vérifie que le premier sens se serait tu sur les deux vrais
défauts.

### 5. Créer un administrateur et réinitialiser son mot de passe sont tracés

Les deux actions existaient sans trace, dans les routes de bootstrap. Elles sont
écrites **dans le même lot** que l'action, et `admin_id` vaut `NULL` : le
bootstrap n'a pas d'auteur identifié, il est porté par le secret d'installation.
Le dire est plus honnête que de s'attribuer l'action.

La trace de la réinitialisation est gardée par la même condition que la mise à
jour : si aucun administrateur ne porte cet e-mail, rien n'est écrit — ni le mot
de passe, ni une trace annonçant une réinitialisation qui n'a pas eu lieu.

## Conséquences

- 33 actions enregistrées, dont **26 permanentes**. La rétention ne s'applique plus
  qu'aux traces d'exploitation : crons, sondes, alertes.
- Ajouter une écriture d'audit sans l'enregistrer fait échouer la suite de tests.
- Le volume conservé augmente. C'était le but : un registre qui oublie les
  décisions n'est pas un registre.

## Ce qui n'est pas fait

**La purge reste possible sur les traces d'exploitation.** Rien n'empêche un
exploitant de fixer `cleanup_audit_log_days` à 1 ; les permanentes survivraient,
le reste non. Rendre la rétention elle-même opposable — un plancher que la
configuration ne peut pas franchir — relève du contrat avec l'État plutôt que du
code, et rejoint le constat AC : le souverain n'a aujourd'hui aucun accès en
lecture au registre.
