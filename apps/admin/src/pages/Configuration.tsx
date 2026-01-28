import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../lib/api';
import { useAdminStore } from '../stores/auth';

interface ConfigItem {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
  updated_by: string | null;
}

interface ConfigGroup {
  label: string;
  icon: string;
  description: string;
  keys: string[];
}

const CONFIG_GROUPS: ConfigGroup[] = [
  {
    label: 'Plateforme',
    icon: '🌐',
    description: 'Nom, URLs, branding de la plateforme',
    keys: ['app_name', 'app_tagline', 'app_url', 'api_url', 'copyright_year', 'default_currency', 'default_country', 'default_city'],
  },
  {
    label: 'Email & Notifications',
    icon: '📧',
    description: 'Adresse email, nom expéditeur',
    keys: ['email_from_address', 'email_from_name', 'support_email', 'support_phone'],
  },
  {
    label: 'Frais & Spreads',
    icon: '💰',
    description: 'Marges achat/vente, frais de transaction',
    keys: ['spread_buy', 'spread_sell', 'transaction_fee_percent', 'storage_fee_annual'],
  },
  {
    label: 'Limites KYC',
    icon: '🪪',
    description: "Limites d'achat/vente par niveau KYC",
    keys: [
      'kyc_basic_daily_buy', 'kyc_basic_monthly_buy', 'kyc_basic_can_sell', 'kyc_basic_daily_withdraw',
      'kyc_standard_daily_buy', 'kyc_standard_monthly_buy', 'kyc_standard_can_sell', 'kyc_standard_daily_withdraw',
      'kyc_verified_daily_buy', 'kyc_verified_monthly_buy', 'kyc_verified_can_sell', 'kyc_verified_daily_withdraw',
    ],
  },
  {
    label: 'Retraits',
    icon: '📤',
    description: 'Frais et minimums de retrait',
    keys: ['withdrawal_fee_mobile', 'withdrawal_fee_bank', 'withdrawal_min_mobile', 'withdrawal_min_bank', 'withdrawal_time_mobile', 'withdrawal_time_bank'],
  },
  {
    label: 'Montants minimum',
    icon: '📏',
    description: "Montants minimum d'achat et de vente",
    keys: ['min_buy_amount', 'min_sell_amount', 'kyc_max_file_size_bytes'],
  },
  {
    label: 'Marche',
    icon: '📈',
    description: "Expiration des devis, prix de repli",
    keys: ['quote_expiry_minutes', 'quote_validity_seconds', 'fallback_exchange_rate', 'fallback_gold_price_usd'],
  },
  {
    label: 'Authentification',
    icon: '🔑',
    description: "Expiration tokens, codes de verification",
    keys: ['access_token_expiry', 'refresh_token_expiry', 'access_token_expiry_seconds', 'verification_code_ttl', 'verification_max_attempts', 'reset_token_ttl', 'two_factor_setup_ttl', 'two_factor_backup_code_count'],
  },
  {
    label: 'Securite',
    icon: '🔒',
    description: 'Sessions, verrouillage, mots de passe, 2FA',
    keys: [
      'login_max_attempts', 'lockout_duration_minutes', 'progressive_lockout',
      'password_min_length', 'password_max_length',
      'session_timeout_minutes', 'absolute_session_timeout_hours',
      'totp_window', 'totp_issuer',
      'transaction_signature_validity_seconds', 'high_value_threshold_xof',
      'password_pbkdf2_iterations', 'password_history_count',
      'cf_keys_cache_ttl_seconds',
    ],
  },
  {
    label: 'Rate Limiting',
    icon: '🚦',
    description: 'Limites de requetes par tier',
    keys: [
      'rate_limit_general_max', 'rate_limit_general_window',
      'rate_limit_auth_max', 'rate_limit_auth_window',
      'rate_limit_trading_max', 'rate_limit_trading_window',
      'rate_limit_register_max', 'rate_limit_register_window',
      'rate_limit_password_reset_max', 'rate_limit_password_reset_window',
      'rate_limit_resend_code_max', 'rate_limit_resend_code_window',
    ],
  },
  {
    label: 'URLs Fournisseurs Paiement',
    icon: '💳',
    description: 'URLs API des fournisseurs de paiement',
    keys: ['orange_money_api_url', 'moov_money_api_url', 'cinetpay_api_url', 'stripe_api_url', 'payment_intent_ttl', 'payment_expiry_seconds'],
  },
  {
    label: 'URLs Notifications',
    icon: '📡',
    description: 'URLs API des fournisseurs de notifications',
    keys: ['resend_api_url', 'sendgrid_api_url', 'twilio_api_url', 'fcm_api_url'],
  },
  {
    label: 'Prix de l\'or',
    icon: '🥇',
    description: 'API prix or, taux de change, cache',
    keys: ['gold_api_base_url', 'metals_api_url', 'exchange_rate_api_url', 'exchange_rate_fallback_url', 'exchange_rate_cache_ttl', 'gold_price_cache_ttl', 'gold_price_full_cache_ttl'],
  },
  {
    label: 'Cache Marche',
    icon: '⏱️',
    description: 'TTLs de cache du service marche',
    keys: ['market_price_cache_ttl', 'price_history_cache_ttl_24h', 'price_history_cache_ttl_7d', 'price_history_cache_ttl_30d', 'price_history_cache_ttl_1y', 'idempotency_cache_ttl'],
  },
  {
    label: 'Certificats',
    icon: '📜',
    description: 'Cache certificats, QR code',
    keys: ['certificate_cache_ttl', 'qr_code_api_url', 'certificate_qr_code_size'],
  },
  {
    label: 'Cache Securite & Rapports',
    icon: '📊',
    description: 'TTLs de cache securite, rapports',
    keys: ['security_alert_cache_ttl', 'security_event_cache_ttl', 'monthly_report_cache_ttl', 'reconciliation_cache_ttl'],
  },
  {
    label: 'Nettoyage Sessions',
    icon: '🧹',
    description: 'Retention codes, notifications, audit logs',
    keys: ['cleanup_verification_code_hours', 'cleanup_recovery_code_days', 'cleanup_notification_days', 'cleanup_audit_log_days'],
  },
  {
    label: 'Nettoyage Transactions',
    icon: '🗑️',
    description: 'Timeouts devis, depots, achats bloques',
    keys: ['cleanup_expired_quote_days', 'cleanup_deposit_timeout_hours', 'cleanup_buy_timeout_minutes', 'cleanup_stuck_transaction_hours', 'cleanup_price_alert_days'],
  },
  {
    label: 'Reconciliation',
    icon: '⚖️',
    description: 'Seuils reconciliation financiere',
    keys: ['reconciliation_stuck_transaction_minutes', 'reconciliation_balance_tolerance'],
  },
  {
    label: 'Alertes Prix',
    icon: '🔔',
    description: 'Limites et seuils alertes prix',
    keys: ['max_price_alerts_per_user', 'price_alert_near_trigger_threshold', 'price_alert_duplicate_threshold'],
  },
  {
    label: 'Pagination & Export',
    icon: '📄',
    description: 'Limites pagination, export CSV',
    keys: ['pagination_max_limit', 'export_max_rows', 'api_default_page_size', 'api_max_page_size'],
  },
  {
    label: 'Initialisation & Demo',
    icon: '🏗️',
    description: 'Stock initial, soldes demo, test webhook',
    keys: [
      'initial_gold_stock', 'test_webhook_default_amount',
      'demo_token_balance_verified', 'demo_token_balance_standard', 'demo_token_balance_basic',
      'demo_cash_balance_verified', 'demo_cash_balance_standard', 'demo_cash_balance_basic',
    ],
  },
  {
    label: 'KYC Fournisseur',
    icon: '🔍',
    description: 'URLs API Smile Identity (KYC)',
    keys: ['smile_identity_api_url', 'smile_identity_test_api_url'],
  },
  {
    label: 'Suivi Depots',
    icon: '⏳',
    description: 'Seuils de traitement des depots',
    keys: ['deposit_processing_fast_minutes', 'deposit_processing_slow_minutes'],
  },
  {
    label: 'Systeme',
    icon: '🛠️',
    description: 'Mode maintenance',
    keys: ['maintenance_mode'],
  },
];

const KEY_LABELS: Record<string, string> = {
  // Plateforme
  app_name: 'Nom de la plateforme',
  app_tagline: 'Slogan',
  app_url: 'URL du site web',
  api_url: "URL de l'API",
  copyright_year: 'Annee copyright',
  default_currency: 'Devise par defaut',
  default_country: 'Code pays par defaut',
  default_city: 'Ville par defaut',
  // Email
  email_from_address: 'Email expediteur',
  email_from_name: 'Nom expediteur',
  support_email: 'Email support',
  support_phone: 'Telephone support',
  // Frais
  spread_buy: 'Spread achat (ex: 0.02 = 2%)',
  spread_sell: 'Spread vente (ex: 0.02 = 2%)',
  transaction_fee_percent: 'Frais de transaction (ex: 0.005 = 0.5%)',
  storage_fee_annual: 'Frais stockage annuel (ex: 0.005 = 0.5%)',
  // KYC
  kyc_basic_daily_buy: 'Achat quotidien Basic (g)',
  kyc_basic_monthly_buy: 'Achat mensuel Basic (g)',
  kyc_basic_can_sell: 'Vente autorisee Basic (0/1)',
  kyc_basic_daily_withdraw: 'Retrait quotidien Basic (XOF)',
  kyc_standard_daily_buy: 'Achat quotidien Standard (g)',
  kyc_standard_monthly_buy: 'Achat mensuel Standard (g)',
  kyc_standard_can_sell: 'Vente autorisee Standard (0/1)',
  kyc_standard_daily_withdraw: 'Retrait quotidien Standard (XOF)',
  kyc_verified_daily_buy: 'Achat quotidien Verifie (g)',
  kyc_verified_monthly_buy: 'Achat mensuel Verifie (g)',
  kyc_verified_can_sell: 'Vente autorisee Verifie (0/1)',
  kyc_verified_daily_withdraw: 'Retrait quotidien Verifie (XOF)',
  // Retraits
  withdrawal_fee_mobile: 'Frais retrait mobile (ex: 0.01 = 1%)',
  withdrawal_fee_bank: 'Frais retrait bancaire (ex: 0.005 = 0.5%)',
  withdrawal_min_mobile: 'Retrait minimum mobile (XOF)',
  withdrawal_min_bank: 'Retrait minimum bancaire (XOF)',
  // Montants
  min_buy_amount: 'Achat minimum (g)',
  min_sell_amount: 'Vente minimum (g)',
  // Marche
  quote_expiry_minutes: 'Expiration devis (minutes)',
  quote_validity_seconds: 'Validite devis (secondes)',
  fallback_exchange_rate: 'Taux de change de repli USD/XOF',
  fallback_gold_price_usd: 'Prix or de repli USD/g',
  // Auth
  access_token_expiry: "Duree token d'acces (ex: 15m)",
  refresh_token_expiry: 'Duree refresh token (ex: 7d)',
  access_token_expiry_seconds: "Duree token d'acces (secondes)",
  verification_code_ttl: 'TTL code de verification (secondes)',
  verification_max_attempts: 'Tentatives max de verification',
  reset_token_ttl: 'TTL token reset mdp (secondes)',
  two_factor_setup_ttl: 'TTL setup 2FA (secondes)',
  // Securite
  login_max_attempts: 'Tentatives de connexion max',
  lockout_duration_minutes: 'Duree verrouillage (minutes)',
  progressive_lockout: 'Verrouillage progressif (0/1)',
  password_min_length: 'Longueur min mot de passe',
  password_max_length: 'Longueur max mot de passe',
  session_timeout_minutes: 'Timeout session (minutes)',
  absolute_session_timeout_hours: 'Timeout absolu session (heures)',
  totp_window: 'Fenetre TOTP (nombre de periodes)',
  totp_issuer: 'Emetteur TOTP',
  transaction_signature_validity_seconds: 'Validite signature transaction (s)',
  high_value_threshold_xof: 'Seuil haute valeur (XOF)',
  // Rate limiting
  rate_limit_general_max: 'Rate limit general - max requetes',
  rate_limit_general_window: 'Rate limit general - fenetre (s)',
  rate_limit_auth_max: 'Rate limit auth - max requetes',
  rate_limit_auth_window: 'Rate limit auth - fenetre (s)',
  rate_limit_trading_max: 'Rate limit trading - max requetes',
  rate_limit_trading_window: 'Rate limit trading - fenetre (s)',
  rate_limit_register_max: 'Rate limit inscription - max requetes',
  rate_limit_register_window: 'Rate limit inscription - fenetre (s)',
  rate_limit_password_reset_max: 'Rate limit reset mdp - max requetes',
  rate_limit_password_reset_window: 'Rate limit reset mdp - fenetre (s)',
  rate_limit_resend_code_max: 'Rate limit renvoi code - max requetes',
  rate_limit_resend_code_window: 'Rate limit renvoi code - fenetre (s)',
  // Paiement
  orange_money_api_url: 'URL API Orange Money',
  moov_money_api_url: 'URL API Moov Money',
  cinetpay_api_url: 'URL API CinetPay',
  stripe_api_url: 'URL API Stripe',
  payment_intent_ttl: 'TTL intent paiement (secondes)',
  payment_expiry_seconds: 'Expiration paiement (secondes)',
  // Notifications
  resend_api_url: 'URL API Resend',
  sendgrid_api_url: 'URL API SendGrid',
  twilio_api_url: 'URL API Twilio',
  fcm_api_url: 'URL API Firebase Cloud Messaging',
  // Prix or
  gold_api_base_url: 'URL de base GoldAPI',
  metals_api_url: 'URL API Metals (fallback)',
  exchange_rate_api_url: 'URL API taux de change',
  exchange_rate_fallback_url: 'URL fallback taux de change',
  exchange_rate_cache_ttl: 'Cache taux de change (secondes)',
  gold_price_cache_ttl: 'Cache prix or USD/g (secondes)',
  gold_price_full_cache_ttl: 'Cache prix or complet (secondes)',
  // Cache Marche
  market_price_cache_ttl: 'Cache prix marche courant (secondes)',
  price_history_cache_ttl_24h: 'Cache historique 24h (secondes)',
  price_history_cache_ttl_7d: 'Cache historique 7j (secondes)',
  price_history_cache_ttl_30d: 'Cache historique 30j (secondes)',
  price_history_cache_ttl_1y: 'Cache historique 1an (secondes)',
  idempotency_cache_ttl: 'Cache idempotence (secondes)',
  // Certificats
  certificate_cache_ttl: 'Cache certificat (secondes)',
  qr_code_api_url: 'URL API QR code',
  // Cache securite & rapports
  security_alert_cache_ttl: 'Cache alertes securite (secondes)',
  security_event_cache_ttl: 'Cache evenements securite (secondes)',
  monthly_report_cache_ttl: 'Cache rapport mensuel (secondes)',
  reconciliation_cache_ttl: 'Cache reconciliation (secondes)',
  // Password securite
  password_pbkdf2_iterations: 'Iterations PBKDF2 (securite mdp)',
  password_history_count: 'Historique mots de passe conserves',
  // Reconciliation
  reconciliation_stuck_transaction_minutes: 'Seuil transactions bloquees (minutes)',
  reconciliation_balance_tolerance: 'Tolerance ecarts soldes',
  // Alertes prix
  max_price_alerts_per_user: 'Max alertes prix par utilisateur',
  price_alert_near_trigger_threshold: 'Seuil proche declenchement (ex: 0.05)',
  // Certificat QR
  certificate_qr_code_size: 'Taille QR code certificat (pixels)',
  // Demo
  demo_token_balance_verified: 'Solde tokens demo Verifie (g)',
  demo_token_balance_standard: 'Solde tokens demo Standard (g)',
  demo_token_balance_basic: 'Solde tokens demo Basic (g)',
  demo_cash_balance_verified: 'Solde XOF demo Verifie',
  demo_cash_balance_standard: 'Solde XOF demo Standard',
  demo_cash_balance_basic: 'Solde XOF demo Basic',
  // Pagination API
  api_default_page_size: 'Taille de page par defaut',
  api_max_page_size: 'Taille de page maximum',
  // Nettoyage sessions
  cleanup_verification_code_hours: 'Retention codes verification (heures)',
  cleanup_recovery_code_days: 'Retention codes recuperation (jours)',
  cleanup_notification_days: 'Retention notifications lues (jours)',
  cleanup_audit_log_days: 'Retention audit logs (jours)',
  // Nettoyage transactions
  cleanup_expired_quote_days: 'Suppression devis expires (jours)',
  cleanup_deposit_timeout_hours: 'Timeout depots en attente (heures)',
  cleanup_buy_timeout_minutes: 'Timeout achats sans paiement (minutes)',
  cleanup_stuck_transaction_hours: 'Detection transactions bloquees (heures)',
  cleanup_price_alert_days: 'Suppression alertes prix (jours)',
  // Pagination & Export
  pagination_max_limit: 'Limite max par page',
  export_max_rows: 'Limite max lignes export CSV',
  // Initialisation
  initial_gold_stock: 'Stock or initial (grammes)',
  test_webhook_default_amount: 'Montant test webhook (XOF)',
  // Retraits - delais
  withdrawal_time_mobile: 'Delai estime retrait mobile',
  withdrawal_time_bank: 'Delai estime retrait bancaire',
  // KYC fichier
  kyc_max_file_size_bytes: 'Taille max fichier KYC (octets)',
  // CF Access
  cf_keys_cache_ttl_seconds: 'TTL cache cles CF Access (secondes)',
  // 2FA
  two_factor_backup_code_count: 'Nombre codes secours 2FA',
  // Alertes prix - doublon
  price_alert_duplicate_threshold: 'Seuil doublon alertes (ex: 0.01 = 1%)',
  // Smile Identity
  smile_identity_api_url: 'URL API Smile Identity (prod)',
  smile_identity_test_api_url: 'URL API Smile Identity (test)',
  // Suivi depots
  deposit_processing_fast_minutes: 'Seuil traitement rapide (minutes)',
  deposit_processing_slow_minutes: 'Seuil traitement lent (minutes)',
  // Systeme
  maintenance_mode: 'Mode maintenance (0 = off, 1 = on)',
};

export default function Configuration() {
  const queryClient = useQueryClient();
  const { tokens, hasPermission } = useAdminStore();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['config'],
    queryFn: () => adminApi.getConfig(tokens!.accessToken),
    enabled: !!tokens,
  });

  const updateMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      adminApi.updateConfig(tokens!.accessToken, key, value),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      setEditingKey(null);
      setSaveSuccess(vars.key);
      setTimeout(() => setSaveSuccess(null), 2000);
    },
  });

  const canEdit = hasPermission('integrations', 'update');
  const configItems: ConfigItem[] = data?.data?.items || [];

  // Build a lookup by key
  const configMap = new Map<string, ConfigItem>();
  for (const item of configItems) {
    configMap.set(item.key, item);
  }

  const startEdit = (key: string, currentValue: string) => {
    setEditingKey(key);
    setEditValue(currentValue);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditValue('');
  };

  const saveEdit = (key: string) => {
    updateMutation.mutate({ key, value: editValue });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Configuration</h1>
        <p className="text-sm text-slate-500 mt-0.5">Paramètres de la plateforme</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          {CONFIG_GROUPS.map((group) => {
            const groupItems = group.keys
              .map((key) => ({ key, item: configMap.get(key) }))
              .filter(({ item }) => item !== undefined);

            if (groupItems.length === 0) return null;

            return (
              <div key={group.label} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800/60 shadow-sm overflow-hidden">
                {/* Group header */}
                <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800/60">
                  <div className="flex items-center gap-2.5">
                    <span className="text-lg">{group.icon}</span>
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{group.label}</h2>
                      <p className="text-xs text-slate-500">{group.description}</p>
                    </div>
                  </div>
                </div>

                {/* Config items */}
                <div className="divide-y divide-slate-100 dark:divide-slate-800/40">
                  {groupItems.map(({ key, item }) => {
                    const isEditing = editingKey === key;
                    const justSaved = saveSuccess === key;

                    return (
                      <div key={key} className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                        {/* Label */}
                        <div className="sm:w-1/3 min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-200 truncate">
                            {KEY_LABELS[key] || key}
                          </p>
                          {item!.description && (
                            <p className="text-[11px] text-slate-400 truncate">{item!.description}</p>
                          )}
                        </div>

                        {/* Value / Edit */}
                        <div className="flex-1 flex items-center gap-2">
                          {isEditing ? (
                            <>
                              <input
                                type="text"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveEdit(key);
                                  if (e.key === 'Escape') cancelEdit();
                                }}
                                autoFocus
                                className="flex-1 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-gold-500/50 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-gold-500 outline-none"
                              />
                              <button
                                onClick={() => saveEdit(key)}
                                disabled={updateMutation.isPending}
                                className="px-3 py-1.5 rounded-lg bg-gold-500 hover:bg-gold-600 text-white text-xs font-medium transition-all disabled:opacity-50"
                              >
                                {updateMutation.isPending ? '...' : 'OK'}
                              </button>
                              <button
                                onClick={cancelEdit}
                                className="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 text-xs font-medium transition-all"
                              >
                                Annuler
                              </button>
                            </>
                          ) : (
                            <>
                              <code className="flex-1 text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 px-3 py-1.5 rounded-lg truncate">
                                {item!.value}
                              </code>
                              {justSaved && (
                                <span className="text-xs text-emerald-500 font-medium animate-fade-in">Sauvegardé</span>
                              )}
                              {canEdit && (
                                <button
                                  onClick={() => startEdit(key, item!.value)}
                                  className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 text-xs font-medium transition-all"
                                >
                                  Modifier
                                </button>
                              )}
                            </>
                          )}
                        </div>

                        {/* Last updated */}
                        <div className="hidden lg:block text-right sm:w-32">
                          {item!.updated_by && (
                            <p className="text-[10px] text-slate-400 truncate">{item!.updated_by}</p>
                          )}
                          <p className="text-[10px] text-slate-500">
                            {new Date(item!.updated_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Error toast */}
      {updateMutation.isError && (
        <div className="fixed bottom-6 right-6 z-50 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400 shadow-lg">
          Erreur: {(updateMutation.error as Error).message}
        </div>
      )}
    </div>
  );
}
