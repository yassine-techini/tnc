-- ============================================
-- 0030 Leased grams on the ownership certificate
--
-- Since the lease exists, `wallets.token_balance` is no longer the whole of
-- what a holder owns: grams placed in a lease LEAVE the wallet. A certificate
-- built on the wallet balance alone would understate the holding of anyone
-- using the product — and understate it silently, which is worse.
--
-- The certificate therefore states both figures, and the leased amount is
-- stored so an old certificate can still be reproduced and verified exactly as
-- it was issued. Recomputing it from today's positions would make a past
-- certificate change over time, which is the one thing a certificate must not
-- do.
-- ============================================

ALTER TABLE certificates ADD COLUMN leased_balance REAL NOT NULL DEFAULT 0;
