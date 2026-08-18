-- Les seuils d'argent appartiennent au pays — constat AJ, ADR 018.
--
-- `high_value_threshold_xof` et les plafonds de retrait etaient des cles
-- globales, nommees en XOF et appliquees telles quelles partout. Ce que
-- « 1 000 000 » signifie reellement, a taux indicatifs :
--
--     XOF  1 626 USD      UGX  270 USD      GHS  83 333 USD
--
-- En Ouganda le second facteur serait reclame pour presque chaque operation — la
-- friction qui fait relever un seuil jusqu'a l'eteindre. Au Ghana il ne se
-- declencherait jamais.
--
-- Les plafonds d'ACHAT ne sont pas concernes : ils sont en grammes, et un gramme
-- est un gramme partout.
--
-- NULL = non fixe, on retombe sur la cle globale. Celle-ci garde ainsi son role
-- de valeur par defaut au lieu de valeur universelle.

ALTER TABLE country_config ADD COLUMN high_value_threshold REAL;
ALTER TABLE country_config ADD COLUMN withdraw_daily_standard REAL;
ALTER TABLE country_config ADD COLUMN withdraw_daily_verified REAL;

-- Valeurs INDICATIVES, derivees d'une reference en USD (1 500 / 800 / 8 000) et
-- arrondies a un chiffre lisible dans la devise locale.
--
-- Un plafond de retrait est une contrainte REGLEMENTAIRE, fixee par un
-- regulateur et non par un taux de change. Ces valeurs evitent qu'un pays active
-- parte avec les seuils d'un autre ; elles ne remplacent pas la decision, et
-- l'exploitant doit les revoir pour chaque juridiction avant ouverture.

-- Zone UEMOA — XOF, ~615 XOF/USD.
UPDATE country_config
SET high_value_threshold = 1000000, withdraw_daily_standard = 500000, withdraw_daily_verified = 5000000
WHERE currency = 'XOF';

-- Ouganda — UGX, ~3 700 UGX/USD.
UPDATE country_config
SET high_value_threshold = 5500000, withdraw_daily_standard = 3000000, withdraw_daily_verified = 30000000
WHERE code = 'UG';
