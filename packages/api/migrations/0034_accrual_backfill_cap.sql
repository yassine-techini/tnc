-- Plafond de rattrapage des jours manques — ADR 011 § 3.
--
-- Le code porte deja la valeur par defaut (30). Ce reglage existe pour que
-- l'exploitant PUISSE la voir et l'ajuster : un plafond qui ne vit que dans le
-- code est un plafond que personne ne saura relever le jour ou une panne longue
-- aura laisse plus de trente jours en arriere.

INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('accrual_backfill_max_days', '30', 'Nombre maximal de jours rattrapes en une passe par le rendement de location (ADR 011). Au-dela, les positions restant en retard sont signalees dans le journal.');
