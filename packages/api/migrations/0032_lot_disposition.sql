-- ============================================
-- 0032 Répartition d'un lot : vendre / louer / stocker
--
-- Un raffineur qui met sa marchandise à disposition de TNC a trois usages
-- possibles, et peut les COMBINER sur un même lot : vendre une part, en louer
-- une autre, laisser le reste en stockage à Dubaï.
--
-- Les trois actions existaient déjà séparément (vente marché, position de
-- location, détention simple). Ce qui manquait, c'est l'INSTRUCTION : rien
-- n'enregistrait qu'un lot devait être réparti ainsi, rien ne vérifiait que la
-- somme couvrait le lot, rien ne rendait visible une exécution partielle.
--
-- POURQUOI DES JAMBES SÉPARÉES. Vendre et louer sont deux écritures financières
-- distinctes, déjà implémentées et déjà gardées ailleurs. Les réécrire dans un
-- seul batch atomique dupliquerait la logique financière — précisément ce que
-- l'ADR 004 a refusé pour la sortie de location. Chaque jambe porte donc son
-- propre statut : une exécution partielle est VISIBLE et reprenable, jamais
-- silencieuse.
-- ============================================

CREATE TABLE IF NOT EXISTS lot_dispositions (
  id TEXT PRIMARY KEY,
  consignment_id TEXT NOT NULL REFERENCES gold_consignments(id),
  user_id TEXT NOT NULL REFERENCES users(id),

  /** Grammes crédités au lot, tels qu'au moment de l'instruction. */
  total_g REAL NOT NULL CHECK (total_g > 0),

  sell_g REAL NOT NULL DEFAULT 0 CHECK (sell_g >= 0),
  lease_g REAL NOT NULL DEFAULT 0 CHECK (lease_g >= 0),
  store_g REAL NOT NULL DEFAULT 0 CHECK (store_g >= 0),

  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'EXECUTED', 'PARTIAL', 'FAILED')),

  /** Statut par jambe : NONE quand la part est nulle. */
  sell_status TEXT NOT NULL DEFAULT 'NONE'
    CHECK (sell_status IN ('NONE', 'PENDING', 'DONE', 'FAILED')),
  lease_status TEXT NOT NULL DEFAULT 'NONE'
    CHECK (lease_status IN ('NONE', 'PENDING', 'DONE', 'FAILED')),

  /** Traces d'exécution, pour que le relevé cite des identifiants réels. */
  sell_transaction_id TEXT,
  sell_price_per_gram REAL,
  sell_proceeds_xof REAL,
  lease_position_id TEXT,
  failure_reason TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  executed_at TEXT,

  -- Une seule répartition par lot. Répartir deux fois le même lot reviendrait à
  -- disposer deux fois du même or.
  UNIQUE (consignment_id)
);

CREATE INDEX IF NOT EXISTS idx_lot_dispositions_user ON lot_dispositions(user_id, status);

-- ============================================
-- Frais de garde à Dubaï, prélevés en XOF.
--
-- `STORAGE_FEE_ANNUAL_PERCENT = 0.5` existait dans les constantes partagées et
-- n'était utilisé nulle part : la garde était gratuite sans que ce soit un
-- choix. Elle est désormais facturée, en espèces, sur l'or RÉELLEMENT GARDÉ.
--
-- L'or en location n'est pas facturé : il n'est pas dans le coffre, et il
-- rémunère déjà son détenteur. Facturer une garde qui n'a pas lieu serait
-- prélever deux fois.
--
-- `cash_balance >= 0` est une contrainte CHECK : un prélèvement ne peut pas
-- passer en force. Un frais que le solde ne couvre pas est donc enregistré
-- IMPAYÉ plutôt que perdu ou imposé — voir ADR 005.
-- ============================================

CREATE TABLE IF NOT EXISTS storage_fee_accruals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  accrual_date TEXT NOT NULL,

  /** Grammes gardés ce jour-là — hors location. */
  stored_g REAL NOT NULL,
  price_per_gram REAL NOT NULL,
  annual_rate REAL NOT NULL,
  amount_xof REAL NOT NULL CHECK (amount_xof >= 0),

  status TEXT NOT NULL DEFAULT 'OUTSTANDING'
    CHECK (status IN ('PAID', 'OUTSTANDING')),
  paid_at TEXT,
  transaction_id TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- Un frais par titulaire et par jour : rejouer le job ne facture pas deux fois.
  UNIQUE (user_id, accrual_date)
);

CREATE INDEX IF NOT EXISTS idx_storage_fee_outstanding
  ON storage_fee_accruals(user_id, status);

INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('storage_fee_annual_rate', '0.005', 'Frais de garde annuels prélevés en XOF sur l''or gardé (fraction, ex. 0.005 = 0,5 %/an)'),
    ('storage_fee_applies_to', 'REFINER', 'Profils soumis aux frais de garde : REFINER, ou ALL pour tous les détenteurs');
