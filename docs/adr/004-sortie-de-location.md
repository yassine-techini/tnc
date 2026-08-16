# ADR 004 — La sortie de location rend l'or, elle ne le vend pas

- **Statut** : accepté
- **Date** : 2026-08-16
- **Contexte** : phase 3.4 (règlement des sorties de location)

## Contexte

Le deck promet une location d'or à 6 %/an « avec vente possible à tout moment,
règlement T+2 à T+5 ». Deux lectures étaient possibles au moment de coder
l'exécution du règlement :

1. **La sortie rend les grammes** au portefeuille, et le détenteur vend ensuite
   s'il le souhaite, par le parcours de vente normal.
2. **La sortie vend directement** : le job de règlement liquide la position au
   cours du jour et crédite des XOF.

La différence n'est pas cosmétique : elle décide de ce qu'un job automatique a
le droit de faire au nom d'un utilisateur.

## Décision

**La sortie rend les grammes.** Le job de règlement recrédite `token_balance`
du principal, décrémente `gold_on_loan`, verse le rendement accumulé en XOF et
clôt la position. La vente reste une action explicite de l'utilisateur.

## Raisons

**La vente a déjà des garde-fous, et ils sont dans le parcours de vente.**
Vendre passe par les limites KYC journalières et mensuelles, la vérification du
niveau KYC, l'expiration du devis, le contrôle de stock et la piste d'audit.
Un job qui vendrait de lui-même contournerait tout cela, ou devrait le
réimplémenter — deux chemins pour la même opération financière, dont un jamais
exercé par un utilisateur. C'est exactement le genre de duplication où les deux
copies divergent silencieusement.

**Un job ne doit pas choisir un cours à la place du détenteur.** Le règlement
tombe à date fixe. Si ce jour-là le job vendait, le détenteur subirait le cours
du jour sans l'avoir accepté — alors que le prix bouge, et qu'un devis expire
précisément parce qu'un prix accepté hier n'engage personne aujourd'hui.

**Rendre l'or est réversible, vendre ne l'est pas.** Si le règlement se trompe,
des grammes remis au portefeuille se re-louent ; une vente au mauvais cours ne
se reprend pas.

**L'invariant reste trivialement vrai.** Rendre les grammes est l'exacte
symétrie de l'ouverture : `token_balance += principal`, `gold_on_loan -=
principal`, `tokens_issued` et `total_allocated` inchangés. La créance a
toujours existé pendant la location — le détenteur n'a jamais cessé de posséder
son or, il l'a rendu illiquide. Aucun token n'est créé ni détruit à la sortie.

## Conséquences

- Le délai T+n reste ce qu'il est : le **rappel du prêt**, le temps qu'il faut
  pour que l'or revienne. Il n'a rien d'un délai de règlement boursier.
- « Vente possible à tout moment » se lit : *sortie demandable à tout moment*,
  puis vente immédiate une fois les grammes revenus. L'interface doit le dire
  ainsi, sans laisser croire à une liquidation instantanée.
- Le rendement est payé en XOF sur le solde espèces, avec une transaction
  `LEASE_YIELD` dédiée (migration 0029) — pas un `DEPOSIT`, qui désignerait de
  l'argent apporté par le détenteur et fausserait tous les rapports.
- `lease_exit_orders.price_per_gram` et `proceeds_xof` sont conservés à titre
  **informatif** : ils figent la valeur du principal au règlement pour le relevé
  de la position. Ils ne représentent aucune vente.

## Alternative écartée

Proposer les deux (« rendre » ou « vendre à la sortie ») dès la V1. Le choix se
défend commercialement, mais il faudrait alors traiter dans un job les
limites KYC, le stock et l'échec de paiement — pour une option qu'aucun
utilisateur n'a encore demandée. À rouvrir quand la demande existe, avec la
vente déléguée au service de marché plutôt que réécrite.
