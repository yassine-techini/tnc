/**
 * Country configuration.
 *
 * One place describing what changes between countries: currency, dialling code,
 * accepted identity documents, payment providers, certificate prefix.
 *
 * The honest part of this service is `implemented` on a payment method. A row
 * in a table cannot make MTN MoMo work; declaring the provider and marking it
 * unimplemented is what keeps the gap visible, so `enabledPaymentMethods()`
 * returns what can actually take a payment rather than what is aspired to.
 */

export interface PaymentMethodConfig {
  id: string;
  label: string;
  /** False when the provider is expected but no adapter exists yet. */
  implemented: boolean;
}

export interface CountryConfigRow {
  code: string;
  name: string;
  currency: string;
  currency_symbol: string;
  currency_decimals: number;
  phone_prefix: string;
  certificate_prefix: string;
  id_document_types: string;
  payment_methods: string;
  locale: string;
  timezone: string;
  business_holidays: string;
  high_value_threshold: number | null;
  withdraw_daily_standard: number | null;
  withdraw_daily_verified: number | null;
  enabled: number;
}

export interface CountryConfig {
  code: string;
  name: string;
  currency: string;
  currencySymbol: string;
  currencyDecimals: number;
  phonePrefix: string;
  certificatePrefix: string;
  idDocumentTypes: string[];
  paymentMethods: PaymentMethodConfig[];
  locale: string;
  /** Fuseau OPERATIONNEL du pays. L'affichage, lui, suit l'appareil du lecteur (ADR 017). */
  timezone: string;
  /**
   * Jours feries, en dates ISO. Vide par defaut, et c'est delibere : une liste
   * fausse produirait silencieusement de mauvaises dates de reglement. La
   * remplir est un acte d'exploitation (ADR 017 SS 4).
   */
  businessHolidays: string[];
  /**
   * Seuils MONETAIRES, dans la devise du pays (ADR 018). `null` = non fixe : on
   * retombe sur la cle globale, qui garde son role de valeur par defaut au lieu
   * de valeur universelle.
   *
   * Les plafonds d'ACHAT ne figurent pas ici : ils sont en grammes, et un gramme
   * est un gramme partout.
   */
  highValueThreshold: number | null;
  withdrawDailyStandard: number | null;
  withdrawDailyVerified: number | null;
  enabled: boolean;
}

/**
 * Used when the table has no row for a country — never as a silent substitute
 * for a country the caller asked about, only as the shape of an answer.
 */
export const FALLBACK_COUNTRY: CountryConfig = {
  code: 'BF',
  name: 'Burkina Faso',
  currency: 'XOF',
  currencySymbol: 'FCFA',
  currencyDecimals: 0,
  phonePrefix: '+226',
  certificatePrefix: 'BF',
  idDocumentTypes: ['CNIB', 'PASSPORT', 'PERMIT', 'CEDEAO'],
  paymentMethods: [
    { id: 'orange_money', label: 'Orange Money', implemented: true },
    { id: 'moov_money', label: 'Moov Money', implemented: true },
    { id: 'bank', label: 'Virement bancaire', implemented: true },
  ],
  locale: 'fr-FR',
  timezone: 'Africa/Ouagadougou',
  businessHolidays: [],
  highValueThreshold: 1_000_000,
  withdrawDailyStandard: 500_000,
  withdrawDailyVerified: 5_000_000,
  enabled: true,
};

/** Parse a JSON column without letting one malformed row break a request. */
function parseJson<T>(value: string, fallback: T, context: string): T {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T) : fallback;
  } catch {
    console.error(`[CountryConfig] Malformed JSON in ${context}`);
    return fallback;
  }
}

export function toCountryConfig(row: CountryConfigRow): CountryConfig {
  return {
    code: row.code,
    name: row.name,
    currency: row.currency,
    currencySymbol: row.currency_symbol,
    currencyDecimals: row.currency_decimals,
    phonePrefix: row.phone_prefix,
    certificatePrefix: row.certificate_prefix,
    idDocumentTypes: parseJson<string[]>(row.id_document_types, [], `${row.code}.id_document_types`),
    paymentMethods: parseJson<PaymentMethodConfig[]>(
      row.payment_methods,
      [],
      `${row.code}.payment_methods`
    ),
    locale: row.locale,
    timezone: row.timezone,
    businessHolidays: parseJson<string[]>(row.business_holidays, [], 'business_holidays'),
    highValueThreshold: row.high_value_threshold ?? null,
    withdrawDailyStandard: row.withdraw_daily_standard ?? null,
    withdrawDailyVerified: row.withdraw_daily_verified ?? null,
    enabled: row.enabled === 1,
  };
}

/** Providers that can actually take a payment today. */
export function enabledPaymentMethods(country: CountryConfig): PaymentMethodConfig[] {
  return country.paymentMethods.filter((m) => m.implemented);
}

/**
 * Whether a country can genuinely be served.
 *
 * A row alone is not enough: without a single working payment provider, a
 * holder could open an account and then be unable to put money in. The check
 * is deliberately stricter than the `enabled` flag, so flipping the flag by
 * hand cannot open a country that has no way to be paid.
 */
export function isServiceable(country: CountryConfig): boolean {
  return country.enabled && enabledPaymentMethods(country).length > 0;
}

export class CountryConfigService {
  // Reads `default_country` straight from the config table rather than through
  // ConfigService: that would drag a KV binding in to fetch a single row, and a
  // country lookup should not fail because a cache is missing.
  constructor(private db: D1Database) {}

  /** One country by ISO code, or null when it is not configured. */
  async get(code: string): Promise<CountryConfig | null> {
    const row = await this.db
      .prepare('SELECT * FROM country_config WHERE code = ?')
      .bind(code.trim().toUpperCase())
      .first<CountryConfigRow>();
    return row ? toCountryConfig(row) : null;
  }

  /**
   * The country to use for a user.
   *
   * Falls back to the configured default, then to Burkina Faso — never to a
   * blank configuration, which would leave a certificate without a prefix and a
   * form without a dialling code.
   */
  async forUser(code: string | null | undefined): Promise<CountryConfig> {
    if (code) {
      const found = await this.get(code);
      if (found) return found;
    }
    const setting = await this.db
      .prepare("SELECT value FROM config WHERE key = 'default_country'")
      .first<{ value: string }>();
    const fallback = await this.get(setting?.value || 'BF');
    return fallback || FALLBACK_COUNTRY;
  }

  async list(onlyEnabled = false): Promise<CountryConfig[]> {
    const rows = await this.db
      .prepare(
        onlyEnabled
          ? 'SELECT * FROM country_config WHERE enabled = 1 ORDER BY name'
          : 'SELECT * FROM country_config ORDER BY enabled DESC, name'
      )
      .all<CountryConfigRow>();
    return (rows.results || []).map(toCountryConfig);
  }
}
