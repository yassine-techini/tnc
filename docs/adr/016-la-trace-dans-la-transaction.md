# ADR 016 — La trace dans la transaction de son action

- **Statut** : accepté
- **Date** : 2026-08-18
- **Contexte** : constat Z du neuvième audit

## Contexte

Huit écritures d'audit sur quinze étaient faites en instruction séparée, dont
**six des sept routes d'administration** :

```ts
await c.env.DB.prepare('UPDATE users SET kyc_status = ?, kyc_level = ? …').run();

// Log admin action
await c.env.DB.prepare('INSERT INTO audit_logs …').run();
```

Si la seconde échoue — coupure D1, éviction du worker, expiration — **l'action est
faite et personne ne l'a faite**. Un utilisateur passe à `VERIFIED`, son plafond
d'achat journalier passe de 100 g à 1000 g, et le registre est muet.

La discipline existait pourtant : `/stock/adjust` place déjà sa trace dans le
`db.batch` de l'ajustement, à trente lignes de là, et quatre services
(`lease`, `consignment`, `producer-profile`, `settlement`) la tiennent avec la
même garde répétée sur chaque instruction. C'est la même asymétrie qu'au sixième
audit : une règle réelle, appliquée de mémoire plutôt que par un mécanisme.

## Décisions

### 1. La trace entre dans le lot de son action

Les huit sites écrivent désormais action et trace dans un seul `db.batch`. Un lot
D1 est tout ou rien : la trace ne peut plus manquer sans que l'action soit
annulée avec elle.

### 2. La trace porte la MÊME condition que l'action

Mettre les deux instructions dans un lot ne suffit pas : une trace
inconditionnelle consignerait une décision qu'une mise à jour gardée n'a pas
prise. Chaque trace est donc écrite en `SELECT … FROM <entité> WHERE <même
condition>`.

L'approbation en lot le montrait crûment : sa mise à jour était gardée par
`kyc_status = 'SUBMITTED'`, **sa trace non**. Un dossier déjà approuvé recevait
une trace « approuvé en lot » alors que rien n'avait changé — et la réponse
annonçait « KYC approuvé » sans jamais regarder `changes`. Les deux sont corrigés.

### 3. La décision vient en dernier, et c'est son `changes` qui fait foi

Le contrat de lot gardé déjà en vigueur dans le dépôt : l'appelant décide sur le
nombre de lignes modifiées par la **dernière** instruction. Les routes renvoient
maintenant un 404 ou un 409 explicite là où elles répondaient « succès » sans
vérifier.

### 4. L'état antérieur est capté par `json_object`, sans lecture supplémentaire

La trace s'exécutant **avant** la mise à jour dans le lot, un
`json_object('kycStatus', kyc_status, …)` dans son `SELECT` capture l'état
d'origine gratuitement.

Cela répond à l'observation du neuvième audit : deux écritures sur quinze
renseignaient `old_value`. Une entrée `KYC_APPROVE` dit que le dossier est
approuvé ; elle ne disait pas s'il était en attente, déjà approuvé, ou rejeté la
veille.

## Conséquences

- Six routes d'administration et deux services changent de forme, pas de
  comportement — sauf l'approbation en lot, qui cesse de mentir sur ses
  résultats.
- `reconciliation` était la seule écriture du dépôt à renseigner `old_value`,
  donc la plus informative, et la moins sûre. Elle est désormais dans le lot de
  la correction qu'elle décrit.

## Ce qui n'est pas fait

**Aucun contrôle automatique d'atomicité.** Un script a été écrit puis
**abandonné**. Décider « cet `INSERT` est-il dans un lot » demande de compter les
crochets non fermés en ignorant chaînes, gabarits et commentaires ; la version
obtenue se perdait sur un gabarit imbriqué et signalait comme fautifs des sites
corrects. Et la moitié des traces du dépôt n'ont légitimement **aucune action à
accompagner** : un battement de cron, un webhook sans correspondance ou une sonde
sont à eux-mêmes leur événement.

Un contrôle qui se trompe finit désactivé — trois gardes de cette campagne ont
déjà sous-détecté en silence avant d'être repris. Les huit sites sont donc tenus
par des tests (`test/routes/audit-atomique.test.ts`), qui vérifient la forme des
routes et le comportement du lot sur une vraie base. C'est moins ambitieux qu'un
garde-fou, et c'est vérifié.
