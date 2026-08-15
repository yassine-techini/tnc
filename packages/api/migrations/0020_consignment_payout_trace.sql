-- ============================================
-- 0020 Record on the lot what the producer was actually paid
-- 0018 credits the producer at audit validation, but the amount only survived in
-- audit_logs and in the CONSIGNMENT transaction. The producer could see "900 g
-- refined" on his lot and nowhere what those 900 g earned him — and the share is
-- configurable, so it cannot be recomputed after the fact from the lot alone.
-- Plain ADD COLUMN: no table rebuild, no foreign key hazard.
-- ============================================

ALTER TABLE gold_consignments ADD COLUMN producer_tokens_credited REAL;
