-- ============================================
-- 0010: Config cleanup - Add missing configuration keys
-- ============================================
-- The config table was created in 0001. This migration adds
-- keys that were previously hardcoded in services.

-- Platform URLs & Branding
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('app_url', 'https://app.tnc-trading.com', 'URL de l''application web'),
    ('api_url', 'https://api.tnc-trading.com', 'URL de l''API'),
    ('app_name', 'TNC Trading', 'Nom de la plateforme'),
    ('app_tagline', 'Plateforme de Tokenisation d''Or', 'Sous-titre de la plateforme'),
    ('email_from_address', 'noreply@tnc-trading.com', 'Adresse email expéditeur'),
    ('email_from_name', 'TNC Trading', 'Nom expéditeur email'),
    ('copyright_year', '2024', 'Année copyright dans les emails'),
    ('support_email', 'support@tnc-trading.com', 'Email du support'),
    ('support_phone', '+226XXXXXXXX', 'Téléphone du support');

-- Transaction fees & spreads
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('spread_buy', '0.02', 'Spread achat (ex: 0.02 = 2%)'),
    ('spread_sell', '0.02', 'Spread vente (ex: 0.02 = 2%)'),
    ('transaction_fee_percent', '0.005', 'Frais de transaction (0.5%)'),
    ('storage_fee_annual', '0.005', 'Frais stockage annuel (0.5%)'),
    ('quote_expiry_minutes', '5', 'Durée de validité d''un devis (minutes)'),
    ('quote_validity_seconds', '300', 'Validité devis (secondes)');

-- KYC trading limits
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('kyc_basic_daily_buy', '0', 'Limite achat/jour BASIC (grammes)'),
    ('kyc_basic_monthly_buy', '0', 'Limite achat/mois BASIC (grammes)'),
    ('kyc_basic_can_sell', '0', 'Vente autorisée BASIC (0=non, 1=oui)'),
    ('kyc_basic_daily_withdraw', '0', 'Limite retrait/jour BASIC (XOF)'),
    ('kyc_standard_daily_buy', '100', 'Limite achat/jour STANDARD (grammes)'),
    ('kyc_standard_monthly_buy', '500', 'Limite achat/mois STANDARD (grammes)'),
    ('kyc_standard_can_sell', '1', 'Vente autorisée STANDARD (0=non, 1=oui)'),
    ('kyc_standard_daily_withdraw', '500000', 'Limite retrait/jour STANDARD (XOF)'),
    ('kyc_verified_daily_buy', '1000', 'Limite achat/jour VERIFIED (grammes)'),
    ('kyc_verified_monthly_buy', '5000', 'Limite achat/mois VERIFIED (grammes)'),
    ('kyc_verified_can_sell', '1', 'Vente autorisée VERIFIED (0=non, 1=oui)'),
    ('kyc_verified_daily_withdraw', '5000000', 'Limite retrait/jour VERIFIED (XOF)');

-- Withdrawal fees
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('withdrawal_fee_mobile', '0.01', 'Frais retrait mobile (ex: 0.01 = 1%)'),
    ('withdrawal_fee_bank', '0.005', 'Frais retrait bancaire (ex: 0.005 = 0.5%)'),
    ('withdrawal_min_mobile', '1000', 'Retrait minimum mobile (XOF)'),
    ('withdrawal_min_bank', '5000', 'Retrait minimum bancaire (XOF)');

-- Min transaction amounts
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('min_buy_amount', '1', 'Achat minimum (grammes)'),
    ('min_sell_amount', '1', 'Vente minimum (grammes)'),
    ('min_buy_grams', '1', 'Achat minimum (grammes) - alias'),
    ('min_sell_grams', '1', 'Vente minimum (grammes) - alias'),
    ('min_deposit_xof', '1000', 'Dépôt minimum (XOF)'),
    ('min_withdrawal_xof', '1000', 'Retrait minimum (XOF)');

-- Market fallbacks
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('fallback_exchange_rate', '615', 'Taux de change USD/XOF fallback'),
    ('fallback_gold_price_usd', '75', 'Prix or USD/gramme fallback');

-- Authentication & tokens
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('access_token_expiry', '15m', 'Durée de vie du token d''accès (ex: 15m, 1h)'),
    ('refresh_token_expiry', '7d', 'Durée de vie du token de rafraîchissement (ex: 7d, 30d)'),
    ('access_token_expiry_seconds', '900', 'Durée de vie du token d''accès en secondes'),
    ('verification_code_ttl', '900', 'Durée de vie code de vérification (secondes)'),
    ('verification_max_attempts', '5', 'Tentatives max pour un code de vérification'),
    ('reset_token_ttl', '3600', 'Durée de vie du token de réinitialisation (secondes)'),
    ('two_factor_setup_ttl', '600', 'Durée de vie configuration 2FA (secondes)');

-- Security thresholds
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('login_max_attempts', '5', 'Tentatives de connexion max avant blocage'),
    ('lockout_duration_minutes', '15', 'Durée du verrouillage de compte (minutes)'),
    ('progressive_lockout', '1', 'Verrouillage progressif (0=non, 1=oui)'),
    ('password_min_length', '12', 'Longueur minimale du mot de passe'),
    ('password_max_length', '128', 'Longueur maximale du mot de passe'),
    ('session_timeout_minutes', '15', 'Timeout session inactivité (minutes)'),
    ('absolute_session_timeout_hours', '8', 'Timeout session absolu (heures)'),
    ('totp_window', '1', 'Fenêtre TOTP (pas avant/après)'),
    ('totp_issuer', 'TNC Trading', 'Nom émetteur TOTP pour les apps authenticator'),
    ('transaction_signature_validity_seconds', '300', 'Validité signature transaction (secondes)'),
    ('high_value_threshold_xof', '1000000', 'Seuil transaction haute valeur (XOF)');

-- Rate limiting
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('rate_limit_general_max', '100', 'Rate limit général: requêtes max'),
    ('rate_limit_general_window', '60', 'Rate limit général: fenêtre (secondes)'),
    ('rate_limit_auth_max', '20', 'Rate limit auth: requêtes max'),
    ('rate_limit_auth_window', '60', 'Rate limit auth: fenêtre (secondes)'),
    ('rate_limit_trading_max', '10', 'Rate limit trading: requêtes max'),
    ('rate_limit_trading_window', '60', 'Rate limit trading: fenêtre (secondes)'),
    ('rate_limit_login_per_minute', '5', 'Tentatives login/minute par IP'),
    ('rate_limit_sensitive_ops_per_hour', '10', 'Opérations sensibles/heure'),
    ('rate_limit_register_max', '5', 'Inscriptions max par IP'),
    ('rate_limit_register_window', '3600', 'Fenêtre inscription (secondes)'),
    ('rate_limit_password_reset_max', '3', 'Réinitialisations max par IP'),
    ('rate_limit_password_reset_window', '3600', 'Fenêtre réinitialisation (secondes)'),
    ('rate_limit_resend_code_max', '3', 'Renvois code max par IP'),
    ('rate_limit_resend_code_window', '300', 'Fenêtre renvoi code (secondes)');

-- Payment provider API URLs
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('orange_money_api_url', 'https://api.orange.com/orange-money-webpay/bf/v1/webpayment', 'URL API Orange Money'),
    ('moov_money_api_url', 'https://api.moov-africa.com/bfa/payment/initiate', 'URL API Moov Money'),
    ('cinetpay_api_url', 'https://api-checkout.cinetpay.com/v2/payment', 'URL API CinetPay'),
    ('stripe_api_url', 'https://api.stripe.com/v1/checkout/sessions', 'URL API Stripe Checkout'),
    ('default_currency', 'XOF', 'Devise par défaut des paiements'),
    ('default_country', 'BF', 'Pays par défaut'),
    ('default_city', 'Ouagadougou', 'Ville par défaut'),
    ('payment_intent_ttl', '3600', 'TTL des intentions de paiement en KV (secondes)');

-- Gold price API
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('gold_api_base_url', 'https://www.goldapi.io/api', 'URL de base GoldAPI'),
    ('metals_api_url', 'https://api.metals.live/v1/spot/gold', 'URL API Metals-API (fallback)'),
    ('exchange_rate_api_url', 'https://v6.exchangerate-api.com/v6', 'URL API taux de change'),
    ('exchange_rate_fallback_url', 'https://api.exchangerate.host/latest?base=USD&symbols=XOF', 'URL fallback taux de change'),
    ('exchange_rate_cache_ttl', '3600', 'TTL cache taux de change (secondes)'),
    ('gold_price_cache_ttl', '300', 'TTL cache prix or USD/gram (secondes)'),
    ('gold_price_full_cache_ttl', '600', 'TTL cache prix or complet (secondes)');

-- Market price cache
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('market_price_cache_ttl', '60', 'TTL cache prix marché courant (secondes)'),
    ('price_history_cache_ttl_24h', '60', 'TTL cache historique prix 24h (secondes)'),
    ('price_history_cache_ttl_7d', '300', 'TTL cache historique prix 7j (secondes)'),
    ('price_history_cache_ttl_30d', '900', 'TTL cache historique prix 30j (secondes)'),
    ('price_history_cache_ttl_1y', '3600', 'TTL cache historique prix 1an (secondes)'),
    ('idempotency_cache_ttl', '86400', 'TTL cache idempotence (secondes)');

-- Notification provider URLs
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('resend_api_url', 'https://api.resend.com/emails', 'URL API Resend'),
    ('sendgrid_api_url', 'https://api.sendgrid.com/v3/mail/send', 'URL API SendGrid'),
    ('twilio_api_url', 'https://api.twilio.com/2010-04-01', 'URL API Twilio'),
    ('fcm_api_url', 'https://fcm.googleapis.com/fcm/send', 'URL API Firebase Cloud Messaging');

-- Certificate & verification
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('certificate_cache_ttl', '2592000', 'TTL cache certificat (secondes, 30 jours)'),
    ('qr_code_api_url', 'https://api.qrserver.com/v1/create-qr-code', 'URL API génération QR code');

-- Security event cache TTLs
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('security_alert_cache_ttl', '604800', 'TTL cache alertes sécurité (secondes, 7 jours)'),
    ('security_event_cache_ttl', '2592000', 'TTL cache événements sécurité (secondes, 30 jours)');

-- Report cache TTLs
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('monthly_report_cache_ttl', '31536000', 'TTL cache rapport mensuel (secondes, 1 an)'),
    ('reconciliation_cache_ttl', '604800', 'TTL cache réconciliation (secondes, 7 jours)');

-- Payment expiry
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('payment_expiry_seconds', '1800', 'Expiration intention de paiement (secondes)');

-- Pagination
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('pagination_max_limit', '100', 'Limite max par page pour les requêtes paginées');

-- Cleanup job: session-cleanup retention periods
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('cleanup_verification_code_hours', '24', 'Rétention codes vérification utilisés (heures)'),
    ('cleanup_recovery_code_days', '30', 'Rétention codes récupération utilisés (jours)'),
    ('cleanup_notification_days', '90', 'Rétention notifications lues (jours)'),
    ('cleanup_audit_log_days', '365', 'Rétention journaux audit non critiques (jours)');

-- Cleanup job: quote-cleanup timeouts
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('cleanup_expired_quote_days', '7', 'Suppression devis expirés après (jours)'),
    ('cleanup_deposit_timeout_hours', '2', 'Timeout dépôts en attente (heures)'),
    ('cleanup_buy_timeout_minutes', '30', 'Timeout achats sans paiement (minutes)'),
    ('cleanup_stuck_transaction_hours', '24', 'Détection transactions bloquées (heures)'),
    ('cleanup_price_alert_days', '30', 'Suppression alertes prix déclenchées (jours)');

-- Setup initial values
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('initial_gold_stock', '10000', 'Stock or initial alloué (grammes)');

-- Export limits
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('export_max_rows', '10000', 'Limite max lignes export CSV');

-- Test/Dev values
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('test_webhook_default_amount', '10000', 'Montant par défaut webhook test (XOF)');

-- Password security
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('password_pbkdf2_iterations', '100000', 'Itérations PBKDF2 pour hachage mot de passe (CF Workers max: 100000)'),
    ('password_history_count', '10', 'Nombre d''anciens mots de passe conservés');

-- Reconciliation
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('reconciliation_stuck_transaction_minutes', '60', 'Seuil transactions bloquées (minutes)'),
    ('reconciliation_balance_tolerance', '0.01', 'Tolérance écarts soldes (XOF/tokens)');

-- Price alerts
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('max_price_alerts_per_user', '10', 'Nombre max alertes prix par utilisateur'),
    ('price_alert_near_trigger_threshold', '0.05', 'Seuil alerte proche du déclenchement (ex: 0.05 = 5%)');

-- Certificate
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('certificate_qr_code_size', '180', 'Taille QR code certificat (pixels)');

-- Demo balances
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('demo_token_balance_verified', '100', 'Solde tokens demo Vérifié (grammes)'),
    ('demo_token_balance_standard', '50', 'Solde tokens demo Standard (grammes)'),
    ('demo_token_balance_basic', '10', 'Solde tokens demo Basic (grammes)'),
    ('demo_cash_balance_verified', '500000', 'Solde XOF demo Vérifié'),
    ('demo_cash_balance_standard', '250000', 'Solde XOF demo Standard'),
    ('demo_cash_balance_basic', '50000', 'Solde XOF demo Basic');

-- API pagination defaults
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('api_default_page_size', '20', 'Taille de page par défaut'),
    ('api_max_page_size', '100', 'Taille de page maximum');

-- Maintenance
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('maintenance_mode', '0', 'Mode maintenance (0=off, 1=on)');

-- Withdrawal time estimates
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('withdrawal_time_mobile', '24-48h', 'Délai estimé retrait mobile money'),
    ('withdrawal_time_bank', '2-3 jours ouvrables', 'Délai estimé retrait bancaire');

-- KYC file upload
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('kyc_max_file_size_bytes', '5242880', 'Taille max fichier KYC en octets (5 Mo par défaut)');

-- Cloudflare Access keys cache
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('cf_keys_cache_ttl_seconds', '3600', 'TTL cache clés publiques CF Access (secondes)');

-- 2FA backup codes
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('two_factor_backup_code_count', '10', 'Nombre de codes de secours 2FA générés');

-- Price alert duplicate detection
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('price_alert_duplicate_threshold', '0.01', 'Seuil similarité pour détection doublon alertes prix (ex: 0.01 = 1%)');

-- Smile Identity KYC provider URLs
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('smile_identity_api_url', 'https://api.smileidentity.com/v1', 'URL API Smile Identity (production)'),
    ('smile_identity_test_api_url', 'https://testapi.smileidentity.com/v1', 'URL API Smile Identity (test)');

-- Deposit processing status thresholds
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('deposit_processing_fast_minutes', '5', 'Seuil traitement rapide dépôt (minutes)'),
    ('deposit_processing_slow_minutes', '30', 'Seuil traitement lent dépôt (minutes)');
