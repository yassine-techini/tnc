-- ============================================
-- 0015 Normalize gold_stock to a single canonical row ('main')
-- ============================================
-- Historically the stock row was created/seeded with divergent ids:
--   'main' (schema default + prod/staging seed), 'gold-stock-main' (dev seed)
-- while MarketService queried 'primary'. This silently broke all purchases.
-- This migration consolidates any stray rows into the canonical id 'main'
-- and removes duplicates, keeping the row with the most issued tokens.

-- 1. If no 'main' row exists but a legacy row does, promote the legacy row.
UPDATE gold_stock
SET id = 'main'
WHERE id IN ('primary', 'gold-stock-main')
  AND NOT EXISTS (SELECT 1 FROM gold_stock WHERE id = 'main');

-- 2. Fold any remaining legacy rows into 'main' (keep the larger figures so the
--    invariant tokens_issued <= total_allocated is never weakened), then drop them.
UPDATE gold_stock
SET total_allocated = MAX(total_allocated, (
      SELECT MAX(total_allocated) FROM gold_stock WHERE id IN ('primary', 'gold-stock-main')
    )),
    tokens_issued = MAX(tokens_issued, (
      SELECT MAX(tokens_issued) FROM gold_stock WHERE id IN ('primary', 'gold-stock-main')
    )),
    updated_at = datetime('now')
WHERE id = 'main'
  AND EXISTS (SELECT 1 FROM gold_stock WHERE id IN ('primary', 'gold-stock-main'));

DELETE FROM gold_stock WHERE id IN ('primary', 'gold-stock-main');
