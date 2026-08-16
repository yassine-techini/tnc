# ADR 006 — Un essai sous l'acompte ne donne lieu à aucune reprise

- **Statut** : accepté
- **Date** : 2026-08-16
- **Contexte** : règlement en deux temps (phase 3.2), confirmé par le métier

## Contexte

L'acompte versé à la réception à Dubaï est calculé sur le **poids déclaré** au
départ, corrigé de la pureté déclarée et d'une décote de prudence. L'essai qui
suit peut ressortir en dessous : un lot moins bon qu'annoncé, ou simplement
surestimé de bonne foi.

Exemple réel du test : 1000 g déclarés à 92 % de pureté, décote 0,90, acompte à
75 % → **621 g avancés en tokens**. L'affinage ne rend que **500 g**.

## Décision

**Aucune reprise.** Le producteur garde les 621 g. Aucun solde n'est versé, et
rien ne lui est repris.

## La conséquence qui n'était pas traitée

Cette décision est commerciale, mais elle a un effet comptable qui, lui, n'est
pas négociable — et il était **faux** jusqu'ici.

L'acompte n'avait pas seulement crédité 621 g au producteur : il avait aussi
**alloué 621 g** à `gold_stock.total_allocated`, sur la foi du poids déclaré,
parce qu'un acompte en tokens doit allouer l'or qu'il émet pour que
`tokens_issued <= total_allocated` tienne à chaque étape.

Quand l'essai ne confirme que 500 g, 121 g **n'ont jamais existé**. Or le calcul
d'allocation à l'audit était borné à zéro :

```ts
const allocateG = Math.max(0, refinedWeightG - advanceTokens); // ← 0 au lieu de -121
```

Le fantôme restait donc dans la réserve. L'invariant continuait de tenir — 621
tokens pour 621 g alloués — mais il tenait parce que l'acompte avait gonflé les
**deux** côtés. La page publique `/reserve` aurait annoncé un adossement
physique supérieur à l'or réellement arrivé, ce qui est exactement la
surestimation que tout le reste du projet refuse.

**Correction** : l'allocation à l'audit est désormais **signée**. Elle
désalloue les 121 g fantômes. `producerTokens`, lui, reste borné à zéro — c'est
la décision de non-reprise.

## Qui supporte la perte

La plateforme, **en métal**. Les 621 tokens restent en circulation ; seuls 500 g
sont arrivés ; les 121 g manquants doivent être adossés par le stock libre de
TNC — de l'or alloué et non encore tokenisé.

Si ce stock libre n'existe pas, la contrainte `CHECK (tokens_issued <=
total_allocated)` **fait échouer le lot entier** et l'audit est refusé. C'est
voulu : on n'émet pas de créances qu'on ne peut pas adosser. L'administrateur
doit alors allouer du stock avant de valider — et cette impossibilité est une
information utile, pas une panne.

## Conséquences

- La décote de prudence (`settlement_advance_haircut`, 0,90 par défaut) et le
  pourcentage d'acompte (0,75) ne sont pas décoratifs : **ce sont eux qui
  bornent l'exposition de la plateforme**. Les relever, c'est accepter d'avaler
  des écarts plus grands.
- Le relevé de règlement dit déjà en toutes lettres qu'aucun remboursement n'est
  demandé, plutôt que d'afficher un solde négatif à interpréter.
- Un essai **exactement** égal à l'acompte ne déplace rien, et un essai
  supérieur suit le chemin normal. Les trois cas sont testés.

## Alternative écartée

Reprendre l'écart sur le portefeuille du producteur. Commercialement
défendable, mais cela reviendrait à débiter un compte pour une estimation faite
par la plateforme sur un poids que le producteur ne maîtrisait pas non plus. La
décote existe précisément pour éviter d'en arriver là ; si les écarts
deviennent fréquents, c'est la décote qu'il faut revoir, pas les comptes des
producteurs.
