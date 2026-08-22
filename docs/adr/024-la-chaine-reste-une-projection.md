# ADR 024 — La chaîne reste une projection

- **Statut** : accepté
- **Date** : 2026-08-22
- **Décidé par** : l'exploitant, sur le document [`ETAT-DES-LIEUX-ET-TOKENISATION.md`](../ETAT-DES-LIEUX-ET-TOKENISATION.md)
- **Portée** : tranche la voie A/B ouverte par ce document ; prolonge l'[ADR 002](002-smart-contracts.md)

## Contexte

Le document d'état des lieux posait deux voies pour l'émission d'un token TNC
permissionné selon ERC-3643, et demandait un choix explicite :

- **voie A** — la conformité n'autorise que des adresses détenues par la
  plateforme ; la chaîne reste une projection, D1 reste la vérité ;
- **voie B** — le token est réellement transférable, la chaîne devient la source
  de vérité des soldes, et toute la logique métier qui lit `token_balance` est à
  reprendre.

**La voie A est retenue.**

## Décision

La transférabilité du token TNC est **restreinte au périmètre de la
plateforme**. Aucun porteur ne peut déplacer ses grammes vers une adresse que la
plateforme ne détient pas.

`wallets.token_balance` reste la source de vérité des soldes. La location, les
frais de garde, la répartition des lots, les plafonds KYC et les certificats
continuent de le lire, sans changement.

---

## 1. Ce que cela confirme

La règle d'architecture de l'ADR 002 tient, et n'est plus une hypothèse :

> La chaîne est une **projection** du registre comptable, jamais un second
> registre.

C'était le point de tension : ERC-3643 est incompatible avec cette règle **dès
lors que les transferts sont réels**, parce qu'un porteur qui déplace ses
grammes hors plateforme fait cesser `token_balance` d'être la vérité. En
restreignant les adresses autorisées, la voie A supprime la cause, pas seulement
le symptôme. Un seul écrivain, une table d'*outbox*, des opérations idempotentes
clefées sur un identifiant D1, un réconciliateur qui détecte la dérive — le
dispositif décrit par l'ADR 002 reste valable tel quel.

## 2. Ce que cela répond aux quatre questions préalables

L'ADR 002 posait quatre décisions bloquantes. La voie A en résout deux par
construction et en allège une troisième.

| Question de l'ADR 002 | État après la voie A |
|---|---|
| **1. Pourquoi la chaîne ?** | **Répondu, et ce n'est pas la transférabilité.** Il reste l'auditabilité — déjà livrée par l'ancrage — et une **identité vérifiable réutilisable**. C'est la seule justification restante, et elle doit être assumée comme telle |
| **2. Qui détient les clés ?** | **Répondu : la plateforme.** Si seules ses adresses sont autorisées, la conservation est custodiale par construction. À ne jamais présenter comme de l'auto-conservation |
| **3. Quelle chaîne ?** | **Allégé.** Le coût par transfert cesse d'être le critère décisif : il n'y a pas de transfert d'utilisateur à utilisateur. Seule la plateforme paie du gaz, sur des émissions et destructions peu nombreuses et prévisibles. **Le problème du gaz disparaît** — aucun relayeur ni abstraction de compte n'est nécessaire, puisque aucun porteur ne signe de transaction |
| **4. Cadre réglementaire** | **Toujours ouvert, et toujours bloquant.** Un instrument non transférable pose une question différente d'un instrument négociable, pas une question absente. Elle reste à poser à un conseil juridique dans chaque juridiction servie |

L'avertissement de l'ADR 002 sur les chaînes permissionnées tient également : une
chaîne opérée par le même acteur reproduit l'hypothèse de confiance de la base et
ne prouve rien à un tiers. La voie A ne change rien à ce raisonnement — si la
justification restante est l'auditabilité, l'ancrage doit rester public.

## 3. Ce que cela ne supprime pas

La voie A retire le **chantier de refonte du métier**. Elle ne retire **aucun**
des risques propres à l'écriture on-chain :

- **Une transaction minée ne se rembobine pas.** Un *mint* erroné ne se répare
  pas, il se compense, et la compensation est visible à jamais. Le travail des
  douze audits a consisté à rendre les écritures atomiques et réparables ; cette
  propriété ne franchit pas la frontière de la chaîne.
- **L'invariant devient inter-systèmes.** `totalSupply()` doit égaler
  `tokens_issued`, et plus aucune contrainte `CHECK` ne le garantit : c'est un
  réconciliateur *a posteriori*. Tout écart est un **incident**, et il faut avoir
  décidé à l'avance qui fait foi.
- **La clé d'administration du proxy devient le secret le plus critique de la
  plateforme**, devant `JWT_SECRET`. Multisig et HSM ne deviennent pas
  optionnels parce que les transferts sont restreints.

## 4. La conséquence de séquencement

Elle mérite d'être écrite, parce qu'elle n'est pas évidente et qu'elle décide de
ce qui vaut la peine d'être construit d'abord.

Sous la voie A, les deux étapes on-chain restantes n'ont plus le même intérêt :

- **Les registres d'identité sans token** apportent la totalité du bénéfice
  restant : une identité vérifiable, rattachée à un code pays, réutilisable, et
  sans aucun risque sur les avoirs. Rien ne bouge côté soldes.
- **Le token en miroir** porte l'essentiel du risque irréversible — et sous la
  voie A, il n'apporte plus la transférabilité qui le justifiait. Ce qu'il
  ajoute, c'est une offre publiquement lisible en continu là où l'attestation
  ancrée la publie périodiquement, et un galop d'essai vers la voie B.

**Ce n'est pas rien, mais ce n'est plus évident.** Le token en miroir doit être
justifié pour lui-même avant d'être engagé, et non hérité comme une étape
obligatoire du chemin initial.

Corollaire : sous la voie A, ERC-3643 n'est plus choisi pour ses transferts
sous conformité — il n'y en a pas. Il est choisi pour **sa couche d'identité et
pour garder la porte ouverte**. C'est un motif défendable ; il doit être énoncé,
sans quoi la norme sera adoptée pour une raison qui n'existe plus.

## 5. Revenir à la voie B plus tard

C'est possible, et il ne faut pas le vendre comme bon marché.

Élargir la liste des adresses autorisées est une modification de module de
conformité — quelques lignes. **La reprise de la logique métier qui lit
`token_balance` est le chantier entier**, et il est identique qu'on l'engage
aujourd'hui ou dans deux ans. La voie A **diffère** ce coût, elle ne le supprime
pas.

Ce qui est réellement acquis en cas de bascule : l'identité on-chain, les
registres, la gouvernance des clés, le réconciliateur.

## 6. Conséquences sur le code aujourd'hui

**Aucune.** C'est la propriété la plus utile de cette décision : elle valide
l'architecture en place plutôt qu'elle ne la remet en cause. Aucune migration,
aucun service, aucun test à reprendre.

Deux questions perdent leur urgence sans disparaître :

- **`forcedTransfer`** — l'exploitant peut-il déplacer les avoirs d'un tiers ?
  Sous la voie A, toutes les adresses sont déjà les siennes ; l'opération n'a
  plus de sens externe. La gouvernance de la récupération de compte reste, elle,
  entière.
- **La qualification juridique** reste le préalable à toute émission on-chain,
  quelle que soit la voie.

## Ce que cet ADR ne tranche pas

- Le **choix de la chaîne** et son coût réel d'exploitation.
- Si le **token en miroir** doit être construit — voir § 4.
- La **qualification réglementaire** dans chaque juridiction servie.
- La **durée de conservation** des registres.
