-- Reparer la derive flottante deja accumulee — constat T du huitieme audit.
--
-- `token_balance` est un REAL et chaque achat faisait `token_balance + ?`.
-- L'addition flottante de valeurs pourtant quantifiees au milligramme derive :
-- trois achats suffisent.
--
--   0.018 + 2.106 + 4.337  ->  6.4609999999999994
--   l'ecran affiche          6.461 g   (toFixed(3))
--   token_balance >= 6.461   ->  FAUX
--
-- L'utilisateur etait refuse pour solde insuffisant sur le solde exact que
-- l'interface venait de lui montrer.
--
-- Les ecritures arrondissent desormais au milligramme (ROUND(..., 3)), ce qui
-- rend le solde stocke identique au double que produit le litteral decimal. Il
-- reste a reparer ce qui a deja derive : sans cette migration, un portefeuille
-- existant garderait son ecart jusqu'a sa prochaine ecriture.
--
-- Aucun solde ne change de valeur : 6.4609999999999994 devient 6.461, soit le
-- meme poids au millionieme de milligramme pres. Ce que la migration change,
-- c'est la COMPARABILITE.

UPDATE wallets SET token_balance = ROUND(token_balance, 3) WHERE token_balance <> ROUND(token_balance, 3);
UPDATE wallets SET cash_balance  = ROUND(cash_balance, 0)  WHERE cash_balance  <> ROUND(cash_balance, 0);

UPDATE gold_stock SET
    total_allocated = ROUND(total_allocated, 3),
    tokens_issued   = ROUND(tokens_issued, 3),
    gold_on_loan    = ROUND(gold_on_loan, 3)
WHERE total_allocated <> ROUND(total_allocated, 3)
   OR tokens_issued   <> ROUND(tokens_issued, 3)
   OR gold_on_loan    <> ROUND(gold_on_loan, 3);
