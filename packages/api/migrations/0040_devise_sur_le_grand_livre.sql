-- Une devise sur le grand livre — constat AK, ADR 019.
--
-- `wallets.cash_balance`, `transactions.cash_amount`, `fees`, `total_spent` : rien
-- ne portait de devise. L'unite vivait dans un commentaire du schema — « Total
-- XOF depenses ».
--
-- Et `gold_prices` ne stockait qu'une conversion, si bien qu'un utilisateur
-- ougandais aurait recu un prix en francs CFA presente comme le sien.

-- ── La devise sur l'argent ───────────────────────────────────────────────────
--
-- Figee a l'ecriture. La deriver du pays au moment de la lecture serait faux :
-- un titulaire peut changer de pays, et une ecriture passee doit garder l'unite
-- dans laquelle elle a ete faite.
--
-- Deux colonnes suffisent. Les autres montants — devis, rendements, frais,
-- acomptes — se reglent DANS un portefeuille et partagent sa devise par
-- construction ; dix-neuf colonnes repeteraient la meme information.
--
-- 'XOF' par defaut : c'est ce que valent les lignes existantes, toutes creees
-- quand la plateforme n'avait qu'un pays.
ALTER TABLE wallets ADD COLUMN currency TEXT NOT NULL DEFAULT 'XOF';
ALTER TABLE transactions ADD COLUMN currency TEXT NOT NULL DEFAULT 'XOF';

CREATE INDEX IF NOT EXISTS idx_transactions_currency ON transactions(currency);

-- ── Le taux, par devise ──────────────────────────────────────────────────────
--
-- Le metal est cote en USD : `gold_prices.price_usd` est la REFERENCE, et le
-- prix local se calcule `price_usd * taux`.
--
-- `gold_prices.price_xof` n'est pas renommee : elle contient bien le prix en
-- XOF, elle reste donc exacte. Ce qui change est qu'elle cesse d'etre LA
-- conversion pour devenir UNE conversion, celle de la zone franc.
CREATE TABLE IF NOT EXISTS exchange_rates (
  id TEXT PRIMARY KEY,
  currency TEXT NOT NULL,
  /** Combien d'unites de cette devise pour un dollar. */
  rate_per_usd REAL NOT NULL CHECK (rate_per_usd > 0),
  source TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_lookup ON exchange_rates(currency, timestamp DESC);

-- Le taux de la zone franc est FIXE par arrimage a l'euro : 655,957 XOF pour un
-- euro. Sa valeur en dollars suit l'euro et doit etre relevee comme les autres ;
-- cette ligne n'est qu'un point de depart, portant la meme valeur que le
-- `exchange_rate` deja utilise par le code.
INSERT OR IGNORE INTO exchange_rates (id, currency, rate_per_usd, source)
VALUES ('seed-xof', 'XOF', 615, 'seed');
