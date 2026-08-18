-- Fermer un compte sans effacer l'histoire — ADR 015, constat AB.
--
-- `DELETE /users/me` supprimait la ligne `users`. Douze tables la referencent
-- sans `ON DELETE CASCADE` — a commencer par `quotes` — donc la suppression
-- echouait pour tout utilisateur ayant demande un seul devis, et renvoyait
-- INTERNAL_ERROR 500.
--
-- La ligne subsiste desormais, anonymisee. C'est ce qui permet de tenir les deux
-- obligations a la fois : retirer la donnee personnelle, et conserver le
-- registre des operations qui alimente les volumes publies a l'Etat.

ALTER TABLE users ADD COLUMN closed_at TEXT;

-- Un compte ferme ne doit pas peser sur les recherches d'utilisateurs actifs.
CREATE INDEX IF NOT EXISTS idx_users_closed ON users(closed_at);
