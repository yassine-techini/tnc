-- ============================================
-- transactions.external_reference
-- ============================================
--
-- Six ecritures du code renseignent cette colonne — creation de depot, rappel du
-- fournisseur de paiement, approbation de retrait, reconciliation — et aucune
-- migration ne la creait. Chacune echouait donc a l'execution.
--
-- Le cas le plus couteux : `POST /wallet/deposit` l'ecrit APRES avoir initie le
-- paiement chez l'operateur. La requete echouait une fois le client engage, et
-- la reference du fournisseur etait perdue avec elle.
--
-- La colonne est ajoutee plutot que les six ecritures reecrites : le modele la
-- veut. `payment_reference` porte NOTRE reference, `external_reference` porte
-- celle du fournisseur ; les confondre reviendrait a ne plus pouvoir rapprocher
-- un mouvement de son homologue chez l'operateur. Le service de reconciliation
-- et le contrat partage `ReconciliationTransaction` la declarent tous deux.

ALTER TABLE transactions ADD COLUMN external_reference TEXT;

CREATE INDEX IF NOT EXISTS idx_transactions_external_reference
  ON transactions(external_reference);
