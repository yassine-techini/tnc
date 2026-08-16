-- ============================================
-- 0022 FCM HTTP v1
-- The legacy endpoint seeded in 0010 — https://fcm.googleapis.com/fcm/send,
-- authenticated with a server key — was shut down by Google in June 2024. Push
-- notifications had therefore been failing silently, not merely running on a
-- deprecated API.
--
-- HTTP v1 addresses a per-project endpoint derived from the service account, so
-- there is no URL to configure any more, and authentication is a short-lived
-- OAuth2 token rather than a static key.
-- ============================================

-- Dead configuration: nothing reads these any more.
DELETE FROM config WHERE key IN ('fcm_api_url', 'fcm_server_key');

-- Service account JSON. Empty until provisioned; push stays disabled until then.
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('fcm_service_account', '', 'JSON du compte de service Firebase (FCM HTTP v1) — laisser vide pour désactiver le push');
