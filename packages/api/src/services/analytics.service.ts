/**
 * Analytics Service
 * Tracks business metrics using Cloudflare Analytics Engine
 */

// Type for Analytics Engine Dataset (Cloudflare Workers)
interface AnalyticsEngineDataset {
  writeDataPoint(data: {
    blobs?: string[];
    doubles?: number[];
    indexes?: string[];
  }): void;
}

// Event types
export type EventType = 'api_request' | 'transaction' | 'user_event' | 'system';

export interface ApiRequestEvent {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  userId?: string;
  errorCode?: string;
  country?: string;
  userAgent?: string;
  kycLevel?: string;
  /**
   * Taille du corps en octets, d'après `Content-Length`.
   *
   * `undefined` quand l'en-tête est absent — cas d'une réponse en flux. Écrit
   * alors `0`, et le commentaire du point de données le dit : 0 signifie
   * INCONNU, pas « zéro octet ». Sans cette précision une moyenne de tailles
   * serait fausse vers le bas sans que personne s'en aperçoive.
   */
  requestSize?: number;
  responseSize?: number;
}

export interface TransactionEvent {
  type: 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL';
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  tokenAmount?: number;
  cashAmountXof: number;
  pricePerGram?: number;
  fees?: number;
  paymentMethod?: string;
  userId: string;
  country?: string;
  kycLevel?: string;
  failureReason?: string;
  processingTimeMs?: number;
  isFirstTransaction?: boolean;
}

export interface UserEvent {
  action: 'REGISTER' | 'LOGIN' | 'LOGOUT' | 'KYC_SUBMIT' | 'KYC_APPROVED' | 'KYC_REJECTED' | '2FA_ENABLE' | '2FA_DISABLE' | 'PASSWORD_CHANGE' | 'PASSWORD_RESET';
  status: 'SUCCESS' | 'FAILED';
  userId?: string;
  country?: string;
  failureReason?: string;
  deviceType?: string;
  kycDocumentType?: string;
  referralSource?: string;
  sessionDurationSeconds?: number;
  loginAttempts?: number;
}

export interface SystemEvent {
  name: 'RATE_LIMIT_HIT' | 'ERROR' | 'QUEUE_PROCESS' | 'SCHEDULED_JOB' | 'PRICE_UPDATE' | 'STOCK_ALERT' | 'SECURITY_EVENT';
  severity: 'info' | 'warning' | 'error' | 'critical';
  component?: string;
  errorCode?: string;
  jobName?: string;
  count?: number;
  durationMs?: number;
  memoryUsedMb?: number;
  queueDepth?: number;
  message?: string;
}

export interface PriceUpdateEvent {
  source: string;
  trigger: 'cron' | 'manual' | 'webhook';
  priceUsd: number;
  priceXof: number;
  buyPrice: number;
  sellPrice: number;
  exchangeRate: number;
  spreadBuy: number;
  spreadSell: number;
  priceChangePercent: number;
  fetchLatencyMs?: number;
}

/**
 * Hash user ID for privacy (truncated SHA-256)
 */
async function hashUserId(userId: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(userId);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  // Take first 16 bytes (32 hex chars)
  return hashArray.slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get hour of day (0-23) for time-based analysis
 */
function getHourOfDay(): number {
  return new Date().getUTCHours();
}

/**
 * Get day of week (1-7, Monday=1)
 */
function getDayOfWeek(): number {
  const day = new Date().getUTCDay();
  return day === 0 ? 7 : day; // Convert Sunday (0) to 7
}

/**
 * Normalize path to route pattern (remove IDs)
 */
function normalizePathToPattern(path: string): string {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+/g, '/:id');
}

/**
 * Categorize user agent
 */
function categorizeUserAgent(userAgent?: string): string {
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();
  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) return 'mobile';
  if (ua.includes('tablet') || ua.includes('ipad')) return 'tablet';
  return 'desktop';
}

/**
 * Analytics Service for tracking business metrics
 */
export class AnalyticsService {
  private analytics: AnalyticsEngineDataset | undefined;
  private environment: string;

  constructor(analytics: AnalyticsEngineDataset | undefined, environment: string) {
    this.analytics = analytics;
    this.environment = environment;
  }

  /**
   * Track API request metrics
   * Schema: blob1=event_type, blob2=env, blob3=method, blob4=path, blob5=route_pattern,
   *         blob6=status_category, blob7=error_code, blob8=user_id_hash, blob9=country,
   *         blob10=user_agent_category, blob11=kyc_level, blob12=auth_status
   *         double1=status_code, double2=latency_ms, double3=request_size, double4=response_size,
   *         double5=is_error, double6=is_rate_limited, double7=hour_of_day
   */
  async trackApiRequest(data: ApiRequestEvent): Promise<void> {
    if (!this.analytics) return;

    const userIdHash = data.userId ? await hashUserId(data.userId) : '';
    const statusCategory = `${Math.floor(data.statusCode / 100)}xx`;
    const routePattern = normalizePathToPattern(data.path);
    const isError = data.statusCode >= 400 ? 1 : 0;

    try {
      this.analytics.writeDataPoint({
        blobs: [
          'api_request',                    // blob1: event_type
          this.environment,                 // blob2: environment
          data.method,                      // blob3: method
          data.path.slice(0, 100),          // blob4: path (truncated)
          routePattern,                     // blob5: route_pattern
          statusCategory,                   // blob6: status_category
          data.errorCode || '',             // blob7: error_code
          userIdHash,                       // blob8: user_id_hash
          data.country || 'BF',             // blob9: country
          categorizeUserAgent(data.userAgent), // blob10: user_agent_category
          data.kycLevel || '',              // blob11: kyc_level
          data.userId ? 'authenticated' : 'anonymous', // blob12: auth_status
        ],
        doubles: [
          data.statusCode,                  // double1: status_code
          data.durationMs,                  // double2: latency_ms
          // 0 = taille inconnue (en-tête absent), jamais « zéro octet ».
          data.requestSize ?? 0,            // double3: request_size
          data.responseSize ?? 0,           // double4: response_size
          isError,                          // double5: is_error
          // Dérivé du statut : c'est le rate limiter lui-même qui répond 429.
          // Écrit en dur à 0 jusqu'ici, ce qui faisait conclure à un tableau de
          // bord qu'aucune requête n'était jamais limitée.
          data.statusCode === 429 ? 1 : 0,  // double6: is_rate_limited
          getHourOfDay(),                   // double7: hour_of_day
        ],
        indexes: [routePattern],
      });
    } catch (error) {
      console.error('[Analytics] Failed to track API request:', error);
    }
  }

  /**
   * Track transaction events (BUY, SELL, DEPOSIT, WITHDRAWAL)
   */
  async trackTransaction(data: TransactionEvent): Promise<void> {
    if (!this.analytics) return;

    const userIdHash = await hashUserId(data.userId);

    try {
      this.analytics.writeDataPoint({
        blobs: [
          'transaction',                    // blob1: event_type
          this.environment,                 // blob2: environment
          data.type,                        // blob3: transaction_type
          data.status,                      // blob4: status
          data.paymentMethod || '',         // blob5: payment_method
          data.country || 'BF',             // blob6: country
          data.kycLevel || '',              // blob7: kyc_level
          data.failureReason || '',         // blob8: failure_reason
          userIdHash,                       // blob9: user_id_hash
        ],
        doubles: [
          data.tokenAmount || 0,            // double1: token_amount (grams)
          data.cashAmountXof,               // double2: cash_amount_xof
          data.pricePerGram || 0,           // double3: price_per_gram
          data.fees || 0,                   // double4: fees
          data.processingTimeMs || 0,       // double5: processing_time_ms
          data.isFirstTransaction ? 1 : 0,  // double6: is_first_transaction
          getHourOfDay(),                   // double7: hour_of_day
          getDayOfWeek(),                   // double8: day_of_week
          data.status === 'COMPLETED' ? 1 : 0, // double9: is_completed
          data.status === 'FAILED' ? 1 : 0, // double10: is_failed
        ],
        indexes: [data.type],
      });
    } catch (error) {
      console.error('[Analytics] Failed to track transaction:', error);
    }
  }

  /**
   * Track user events (registration, login, KYC, 2FA, etc.)
   */
  async trackUserEvent(data: UserEvent): Promise<void> {
    if (!this.analytics) return;

    const userIdHash = data.userId ? await hashUserId(data.userId) : '';

    try {
      this.analytics.writeDataPoint({
        blobs: [
          'user_event',                     // blob1: event_type
          this.environment,                 // blob2: environment
          data.action,                      // blob3: action
          data.status,                      // blob4: status
          data.country || 'BF',             // blob5: country
          data.failureReason || '',         // blob6: failure_reason
          data.deviceType || 'unknown',     // blob7: device_type
          data.kycDocumentType || '',       // blob8: kyc_document_type
          data.referralSource || '',        // blob9: referral_source
          userIdHash,                       // blob10: user_id_hash
        ],
        doubles: [
          data.status === 'SUCCESS' ? 1 : 0, // double1: is_success
          0,                                 // double2: is_new_user (set by context)
          data.sessionDurationSeconds || 0,  // double3: session_duration_seconds
          data.loginAttempts || 1,           // double4: login_attempts
          getHourOfDay(),                    // double5: hour_of_day
          getDayOfWeek(),                    // double6: day_of_week
        ],
        indexes: [data.action],
      });
    } catch (error) {
      console.error('[Analytics] Failed to track user event:', error);
    }
  }

  /**
   * Track system events (errors, jobs, rate limits, etc.)
   */
  trackSystemEvent(data: SystemEvent): void {
    if (!this.analytics) return;

    try {
      this.analytics.writeDataPoint({
        blobs: [
          'system',                         // blob1: event_type
          this.environment,                 // blob2: environment
          data.name,                        // blob3: event_name
          data.severity,                    // blob4: severity
          data.component || '',             // blob5: component
          data.errorCode || '',             // blob6: error_code
          data.jobName || '',               // blob7: job_name
          data.message?.slice(0, 200) || '', // blob8: message (truncated)
        ],
        doubles: [
          data.severity === 'error' || data.severity === 'critical' ? 1 : 0, // double1: is_error
          data.count || 1,                  // double2: count
          data.durationMs || 0,             // double3: duration_ms
          data.memoryUsedMb || 0,           // double4: memory_used_mb
          data.queueDepth || 0,             // double5: queue_depth
          getHourOfDay(),                   // double6: hour_of_day
        ],
        indexes: [data.name],
      });
    } catch (error) {
      console.error('[Analytics] Failed to track system event:', error);
    }
  }

  /**
   * Track price update events
   */
  trackPriceUpdate(data: PriceUpdateEvent): void {
    if (!this.analytics) return;

    try {
      this.analytics.writeDataPoint({
        blobs: [
          'price_update',                   // blob1: event_type
          this.environment,                 // blob2: environment
          data.source,                      // blob3: source
          data.trigger,                     // blob4: trigger
        ],
        doubles: [
          data.priceUsd,                    // double1: price_usd
          data.priceXof,                    // double2: price_xof
          data.buyPrice,                    // double3: buy_price
          data.sellPrice,                   // double4: sell_price
          data.exchangeRate,                // double5: exchange_rate
          data.spreadBuy,                   // double6: spread_buy
          data.spreadSell,                  // double7: spread_sell
          data.priceChangePercent,          // double8: price_change_percent
          data.fetchLatencyMs || 0,         // double9: fetch_latency_ms
          getHourOfDay(),                   // double10: hour_of_day
        ],
        indexes: ['price_update'],
      });
    } catch (error) {
      console.error('[Analytics] Failed to track price update:', error);
    }
  }
}
