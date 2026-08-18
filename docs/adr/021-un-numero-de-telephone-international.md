# ADR 021 — Un numéro de téléphone international

- **Statut** : accepté
- **Date** : 2026-08-18
- **Contexte** : constat AM du onzième audit

## Contexte

Deux règles coexistaient pour un même champ.

L'inscription acceptait n'importe quel numéro international :

```ts
phone: z.string().min(10).max(20).regex(/^\+?[0-9]{10,15}$/)
```

La mise à jour du profil imposait le Burkina :

```ts
phone: z.string().regex(/^\+226\d{8}$/, 'Format de téléphone invalide (+226XXXXXXXX)')
```

Un raffineur ougandais s'inscrivait donc sans peine, puis **ne pouvait plus
jamais corriger son numéro** — la règle la plus stricte étant au mauvais bout.

## Décisions

### 1. Une seule règle, partagée

`phoneSchema` de `packages/shared` devient la règle internationale, et
l'inscription comme la mise à jour l'importent. Deux copies d'une règle sur un
même champ divergent ; c'est exactement ce qui s'est produit.

Le validateur partagé portait déjà la règle burkinabè — mais **personne ne
l'importait**. Il décrivait une intention que le code ne suivait pas.

### 2. L'indicatif du pays n'est pas imposé

Tentant, puisque le pays est connu. Mais le téléphone sert à deux choses :

- le **code à usage unique**, qui fonctionne avec n'importe quel indicatif ;
- le **paiement mobile**, qui exige bien un numéro local du bon opérateur.

C'est au retrait de le dire, au moment où la méthode est choisie — pas au profil.
Refuser ici bloquerait un titulaire de la diaspora sur **toutes** ses opérations,
y compris celles qui n'ont rien à voir avec le paiement mobile.

## Conséquences

- Un titulaire peut corriger son numéro depuis n'importe quel pays servi.
- Ajouter un pays ne demande aucune modification de cette règle.

## Ce qui n'est pas fait

**`packages/shared/src/utils/phone.ts` reste burkinabè**, et c'est acceptable :
ses fonctions le disent dans leur nom — `isValidPhoneBF`, `normalizePhoneBF` — et
`getPhoneOperator` reconnaît Orange, Moov et Telecel, qui sont des opérateurs
burkinabè. Aucune n'est appelée en dehors de ses propres tests. Un module nommé
honnêtement et inutilisé ne trompe personne ; le généraliser demanderait les
plages de numérotation de chaque pays servi, ce qui est un travail de données et
non de code.

**Le paiement mobile ne vérifie pas encore la concordance** entre le numéro et
l'opérateur choisi. C'est le contrôle qui manque réellement, et sa place est au
retrait.
