-- ============================================
-- 0031 Multi-country configuration
--
-- The platform was built for Burkina Faso and says so in a dozen places: the
-- XOF currency, the +226 dialling code, the CNIB identity document, the "BF-"
-- certificate prefix, Orange Money and Moov. None of that is wrong — it is
-- simply not the same everywhere the product is meant to go.
--
-- This table is the single place a second country is described, so opening one
-- is a row rather than a search through the source for country assumptions.
--
-- WHAT THIS TABLE IS NOT: it does not make a payment provider work. MTN MoMo
-- and Airtel Money are named here as the interfaces Uganda would need; the
-- adapters do not exist and no row can conjure them. Listing them is how the
-- gap stays visible instead of being discovered during a demo.
-- ============================================

CREATE TABLE IF NOT EXISTS country_config (
  code TEXT PRIMARY KEY,                     -- ISO 3166-1 alpha-2
  name TEXT NOT NULL,

  currency TEXT NOT NULL,                    -- ISO 4217, e.g. XOF, UGX
  currency_symbol TEXT NOT NULL,             -- what users actually read: FCFA, USh
  /** Minor units. XOF has none; a price in centimes would be a fiction. */
  currency_decimals INTEGER NOT NULL DEFAULT 0,

  phone_prefix TEXT NOT NULL,                -- +226, +256
  /** Prefix of the certificate verification code, e.g. BF-7K3M-P9QR. */
  certificate_prefix TEXT NOT NULL,

  /** JSON array of accepted identity documents, in local naming. */
  id_document_types TEXT NOT NULL,
  /**
   * JSON array of payment providers. Each entry carries `implemented`:
   * false means the interface is expected but no adapter exists yet, and the
   * readiness report must not present it as available.
   */
  payment_methods TEXT NOT NULL,

  locale TEXT NOT NULL DEFAULT 'fr-FR',
  timezone TEXT NOT NULL DEFAULT 'Africa/Ouagadougou',

  /**
   * 0 until a country can genuinely be served: currency conversion, a working
   * payment adapter, and identity verification for its documents. A row exists
   * long before it is switched on, which is the point.
   */
  enabled INTEGER NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_country_config_enabled ON country_config(enabled);

-- Burkina Faso — the country actually served today.
INSERT OR IGNORE INTO country_config (
  code, name, currency, currency_symbol, currency_decimals, phone_prefix,
  certificate_prefix, id_document_types, payment_methods, locale, timezone, enabled
) VALUES (
  'BF', 'Burkina Faso', 'XOF', 'FCFA', 0, '+226', 'BF',
  '["CNIB","PASSPORT","PERMIT","CEDEAO"]',
  '[{"id":"orange_money","label":"Orange Money","implemented":true},{"id":"moov_money","label":"Moov Money","implemented":true},{"id":"bank","label":"Virement bancaire","implemented":true}]',
  'fr-FR', 'Africa/Ouagadougou', 1
);

-- The rest of the UEMOA. Same currency, same documents, same providers — so
-- they cost a row each rather than a project. Left disabled: sharing a currency
-- is not the same as having the licences to operate.
INSERT OR IGNORE INTO country_config (
  code, name, currency, currency_symbol, currency_decimals, phone_prefix,
  certificate_prefix, id_document_types, payment_methods, locale, timezone, enabled
) VALUES
  ('CI', 'Côte d''Ivoire', 'XOF', 'FCFA', 0, '+225', 'CI',
   '["CNI","PASSPORT","PERMIT","CEDEAO"]',
   '[{"id":"orange_money","label":"Orange Money","implemented":true},{"id":"moov_money","label":"Moov Money","implemented":true},{"id":"bank","label":"Virement bancaire","implemented":true}]',
   'fr-FR', 'Africa/Abidjan', 0),
  ('ML', 'Mali', 'XOF', 'FCFA', 0, '+223', 'ML',
   '["CNI","PASSPORT","PERMIT","CEDEAO"]',
   '[{"id":"orange_money","label":"Orange Money","implemented":true},{"id":"moov_money","label":"Moov Money","implemented":true},{"id":"bank","label":"Virement bancaire","implemented":true}]',
   'fr-FR', 'Africa/Bamako', 0),
  ('SN', 'Sénégal', 'XOF', 'FCFA', 0, '+221', 'SN',
   '["CNI","PASSPORT","PERMIT","CEDEAO"]',
   '[{"id":"orange_money","label":"Orange Money","implemented":true},{"id":"bank","label":"Virement bancaire","implemented":true}]',
   'fr-FR', 'Africa/Dakar', 0);

-- Uganda — the first country outside the CFA zone, and the one that shows what
-- a second currency actually costs. UGX is not XOF: the gold price feed is
-- quoted in USD and converted, so a UGX country needs its own exchange rate,
-- not a relabelled FCFA. Both payment providers are declared UNIMPLEMENTED
-- because they are: no adapter exists for either.
INSERT OR IGNORE INTO country_config (
  code, name, currency, currency_symbol, currency_decimals, phone_prefix,
  certificate_prefix, id_document_types, payment_methods, locale, timezone, enabled
) VALUES (
  'UG', 'Uganda', 'UGX', 'USh', 0, '+256', 'UG',
  '["NATIONAL_ID","PASSPORT","DRIVING_PERMIT","REFUGEE_ID"]',
  '[{"id":"mtn_momo","label":"MTN Mobile Money","implemented":false},{"id":"airtel_money","label":"Airtel Money","implemented":false},{"id":"bank","label":"Bank transfer","implemented":false}]',
  'en-UG', 'Africa/Kampala', 0
);

INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('default_country', 'BF', 'Pays par défaut pour un compte sans pays explicite');
