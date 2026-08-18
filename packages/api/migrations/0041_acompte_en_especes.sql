-- « XOF » designait un MODE de reglement, pas une devise — ADR 019.
--
-- `settlement_advance_currency` valait 'TOKENS' ou 'XOF', ou 'XOF' signifiait
-- « en especes » par opposition a « en jetons ». Pour un raffineur ougandais,
-- « paye en XOF » n'a aucun sens : il est paye en especes, et ses especes sont
-- des shillings.
--
-- La devise du versement est desormais celle de son portefeuille (migration
-- 0040) ; ce reglage ne dit plus que la FORME du paiement.

UPDATE config SET value = 'CASH' WHERE key = 'settlement_advance_currency' AND value = 'XOF';

UPDATE config
SET description = 'Forme de l''acompte : TOKENS (en or) ou CASH (en especes, dans la devise du beneficiaire)'
WHERE key = 'settlement_advance_currency';
