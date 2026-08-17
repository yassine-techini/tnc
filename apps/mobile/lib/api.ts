import * as Application from 'expo-application';
import type {
  RefreshData,
  RegisterData,
} from '@tnc-trading/shared/contracts';
import type {
  KycStatusData,
  PriceAlertsData,
  UserProfileData,
} from '@tnc-trading/shared/contracts';
// Contrats partages avec l API (packages/shared/src/contracts).
import type {
  LeaseAccrualsData,
  LeaseExitData,
  LeasePositionsData,
  LeaseTermsData,
  StorageFeesData,
} from '@tnc-trading/shared/contracts';
// Contrats partages avec l API (packages/shared/src/contracts).
import type {
  QuoteData,
  WalletData,
} from '@tnc-trading/shared/contracts';
// Contrats partagés avec l'API (packages/shared/src/contracts).
// Côté route, `satisfies` vérifie la même forme : les deux ne peuvent
// plus diverger en silence.
import type {
  MarketStockData,
} from '@tnc-trading/shared/contracts';
import type { PriceHistoryData } from '@tnc-trading/shared/contracts';
import type { TwoFactorSetupData } from '@tnc-trading/shared/contracts';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { useAuthStore } from '../stores/auth';
import {
  PINNED_DOMAINS,
  SSL_PINNING_CONFIG,
  requiresPinning,
  reportPinningFailure,
} from './ssl-pinning';

// API URL must be set via environment variable in production builds
const API_URL = process.env.EXPO_PUBLIC_API_URL || (__DEV__
  ? 'https://tnc-trading-api-staging.yassine-techini.workers.dev'
  : (() => { throw new Error('EXPO_PUBLIC_API_URL must be set in production'); })()
);

// Expected API host for certificate pinning validation (now using ssl-pinning module)
const ALLOWED_API_HOSTS = PINNED_DOMAINS;

/**
 * Erreur d'API qui CONSERVE le code metier.
 *
 * `new Error(message)` seul suffisait tant que l'interface se contentait
 * d'afficher le texte. Le second facteur sur les grosses operations (ADR 009)
 * change la donne : l'ecran doit distinguer « code requis » de « solde
 * insuffisant » pour ouvrir une saisie plutot qu'une banniere rouge. Comparer
 * des messages traduisibles pour deviner le cas serait un piege a regression.
 */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
    readonly status: number,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

interface ApiResponse<T> {
  success: true;
  data: T;
  requestId: string;
}

interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
  };
  requestId: string;
}

type ApiResult<T> = ApiResponse<T> | ApiError;

interface RequestOptions extends Omit<RequestInit, 'headers'> {
  token?: string;
  headers?: Record<string, string>;
  /** Add an idempotency key header for mutation safety */
  idempotencyKey?: string;
}

interface RefreshPromise {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

// Retry configuration
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 15000;
const RETRYABLE_STATUS_CODES = [408, 429, 502, 503, 504];

// Request timeout (15s — generous for slow African networks, but not infinite)
const REQUEST_TIMEOUT_MS = 15000;

class MobileApiClient {
  private baseUrl: string;
  private deviceId: string | null = null;
  private refreshPromise: RefreshPromise | null = null;

  constructor(baseUrl: string) {
    // Validate API host against allowlist (SSL pinning domains)
    try {
      const url = new URL(baseUrl);
      if (!ALLOWED_API_HOSTS.includes(url.host)) {
        console.warn(`API host ${url.host} not in allowlist — possible misconfiguration`);
      }
      // In production, require pinning for API host
      if (!__DEV__ && SSL_PINNING_CONFIG.enabled && requiresPinning(url.host)) {
        console.log(`[SSL Pinning] Pinning enabled for ${url.host}`);
      }
    } catch {
      throw new Error('Invalid API base URL');
    }
    this.baseUrl = baseUrl;
    this.initializeDeviceId();
  }

  private async initializeDeviceId(): Promise<void> {
    try {
      if (Platform.OS === 'android') {
        this.deviceId = Application.getAndroidId() || 'unknown';
      } else {
        // For iOS, use a stored UUID
        let storedId = await SecureStore.getItemAsync('device_id');
        if (!storedId) {
          storedId = this.generateUUID();
          await SecureStore.setItemAsync('device_id', storedId);
        }
        this.deviceId = storedId;
      }
    } catch (error) {
      console.warn('Failed to initialize device ID:', error);
      this.deviceId = 'unknown';
    }
  }

  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  private getToken(): string | null {
    const authState = useAuthStore.getState();
    return authState.tokens?.accessToken || null;
  }

  private async handleTokenRefresh(): Promise<void> {
    // If a refresh is already in progress, wait for it
    if (this.refreshPromise) {
      return this.refreshPromise.promise;
    }

    // Create a new refresh promise
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    this.refreshPromise = { promise, resolve, reject };

    try {
      const authState = useAuthStore.getState();
      const currentRefreshToken = authState.tokens?.refreshToken;

      if (!currentRefreshToken) {
        throw new Error('No refresh token available');
      }

      // Call refresh endpoint
      const response = await this.refreshToken(currentRefreshToken);

      // Update tokens in the auth store
      authState.setTokens({
        accessToken: response.data.accessToken,
        refreshToken: response.data.refreshToken,
        expiresIn: response.data.expiresIn,
      });

      resolve();
    } catch (error) {
      // Force logout on refresh failure
      const authState = useAuthStore.getState();
      authState.logout();
      reject(error as Error);
    } finally {
      this.refreshPromise = null;
    }
  }

  /** Generate a unique idempotency key */
  private generateIdempotencyKey(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
  }

  /** Calculate exponential backoff delay with jitter */
  private getRetryDelay(attempt: number): number {
    const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
    // Add +-25% jitter to prevent thundering herd
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    return Math.round(delay + jitter);
  }

  private async request<T>(endpoint: string, options: RequestOptions = {}, isRetry = false): Promise<ApiResponse<T>> {
    const { token, idempotencyKey, ...fetchOptions } = options;

    // Wait for device ID to be ready
    if (!this.deviceId) {
      await this.initializeDeviceId();
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Version': '1.0',
      'X-Platform': 'mobile',
      'X-Device-Id': this.deviceId || 'unknown',
      ...options.headers,
    };

    // Attach idempotency key for mutation requests
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    // Use provided token, fallback to store token
    const authToken = token || this.getToken();
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const url = `${this.baseUrl}${endpoint}`;

    // Retry loop with exponential backoff (only for network/server errors)
    let lastError: Error | null = null;
    const maxAttempts = isRetry ? 1 : MAX_RETRIES;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Abort slow requests to avoid hanging on bad connections
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        let response: Response;
        try {
          response = await fetch(url, {
            ...fetchOptions,
            headers,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }

        // Handle 401 Unauthorized — token refresh (no retry count)
        if (response.status === 401 && !isRetry) {
          await this.handleTokenRefresh();
          return this.request<T>(endpoint, options, true);
        }

        // Retryable server errors (502, 503, 504, 408, 429)
        if (RETRYABLE_STATUS_CODES.includes(response.status) && attempt < maxAttempts - 1) {
          // Respect Retry-After header if present
          const retryAfter = response.headers.get('Retry-After');
          const delay = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : this.getRetryDelay(attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        const data: ApiResult<T> = await response.json();

        if (!data.success) {
          const errorData = data as ApiError;
          throw new ApiRequestError(
            errorData.error?.message || 'Une erreur est survenue',
            errorData.error?.code,
            response.status,
            (errorData.error as { details?: Record<string, unknown> })?.details
          );
        }

        return data as ApiResponse<T>;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Convert AbortError to a user-friendly timeout message
        if (lastError.name === 'AbortError') {
          lastError = new Error('Connexion lente. Veuillez réessayer.');
        }

        // Detect potential SSL pinning failures (certificate validation errors)
        const sslErrorPatterns = [
          'SSL',
          'certificate',
          'trust',
          'handshake',
          'CERT_',
          'sec_error',
          'kSecTrustResult',
        ];
        const isSslError = sslErrorPatterns.some((pattern) =>
          lastError.message.toLowerCase().includes(pattern.toLowerCase())
        );

        if (isSslError && SSL_PINNING_CONFIG.reportFailures) {
          // Report potential MITM attack
          const urlObj = new URL(url);
          reportPinningFailure({
            success: false,
            host: urlObj.host,
            error: lastError.message,
          });
          // Don't retry SSL errors - they indicate a security issue
          throw new Error('Erreur de sécurité de connexion. Vérifiez votre réseau.');
        }

        // Don't retry on auth or business logic errors
        if (isRetry || lastError.message.includes('401')) {
          if (!isRetry && lastError.message.includes('401')) {
            await this.handleTokenRefresh();
            return this.request<T>(endpoint, options, true);
          }
          throw lastError;
        }

        // Network errors are retryable
        if (attempt < maxAttempts - 1) {
          const delay = this.getRetryDelay(attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
    }

    throw lastError || new Error('Une erreur réseau est survenue');
  }

  // Push devices — the token must be the NATIVE FCM/APNs one, not an Expo
  // token: the API sends through FCM HTTP v1 directly.
  async registerDevice(token: string, platform: 'ios' | 'android' | 'web', deviceId?: string) {
    return this.request<{ registered: boolean }>('/api/v1/users/me/devices', {
      method: 'POST',
      body: JSON.stringify({ token, platform, deviceId }),
    });
  }

  async unregisterDevice(token: string) {
    return this.request<{ removed: boolean }>('/api/v1/users/me/devices', {
      method: 'DELETE',
      body: JSON.stringify({ token }),
    });
  }

  // Auth
  async register(email: string, phone: string, password: string, country = 'BF') {
    return this.request<RegisterData>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, phone, password, country }),
    });
  }

  async login(identifier: string, password: string, totpCode?: string) {
    return this.request<{
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      user: {
        id: string;
        email: string;
        phone: string;
        country: string;
        kycLevel: 'BASIC' | 'STANDARD' | 'VERIFIED';
        kycStatus: string;
        emailVerified: boolean;
        phoneVerified: boolean;
        twoFactorEnabled: boolean;
      };
    }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password, totpCode }),
    });
  }

  async refreshToken(refreshToken: string) {
    return this.request<RefreshData>('/api/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
  }

  // Market
  async getPrice() {
    return this.request<{
      lbmaUsd: number;
      priceXof: number;
      buyPrice: number;
      sellPrice: number;
      spreadBuy: number;
      spreadSell: number;
      exchangeRate: number;
      change24h: number;
      updatedAt: string;
    }>('/api/v1/market/price');
  }

  async getStock() {
    return this.request<MarketStockData>('/api/v1/market/stock');
  }

  async getPriceHistory(period: '24h' | '7d' | '30d' = '24h') {
    // `items`, pas `prices` : le champ déclaré n'existait pas, donc le
    // graphique de prix de l'écran Marché était vide en permanence — sans
    // erreur, sans état vide explicite, juste une courbe absente.
    return this.request<PriceHistoryData>(`/api/v1/market/price/history?period=${period}`);
  }

  async getQuote(type: 'BUY' | 'SELL', amount: number, amountType: 'grams' | 'xof', token: string) {
    return this.request<QuoteData>('/api/v1/market/quote', {
      method: 'POST',
      body: JSON.stringify({ type, amount, amountType }),
      token,
    });
  }

  async executeBuy(quoteId: string, paymentMethod: string, token: string, totpCode?: string) {
    return this.request<{
      transactionId: string;
      type: 'BUY';
      tokenAmount: number;
      cashAmount: number;
      status: string;
    }>('/api/v1/market/buy', {
      method: 'POST',
      body: JSON.stringify({ quoteId, paymentMethod, totpCode }),
      token,
      idempotencyKey: this.generateIdempotencyKey(),
    });
  }

  async executeSell(quoteId: string, paymentMethod: string, token: string, totpCode?: string) {
    return this.request<{
      transactionId: string;
      type: 'SELL';
      tokenAmount: number;
      cashAmount: number;
      status: string;
    }>('/api/v1/market/sell', {
      method: 'POST',
      body: JSON.stringify({ quoteId, paymentMethod, totpCode }),
      token,
      idempotencyKey: this.generateIdempotencyKey(),
    });
  }

  // Wallet
  async getWallet(token: string) {
    return this.request<WalletData>('/api/v1/wallet', { token });
  }

  async getTransactions(token: string, page = 1, limit = 20) {
    return this.request<{
      items: {
        id: string;
        type: 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL' | 'FEE' | 'CONSIGNMENT';
        status: string;
        tokenAmount: number | null;
        cashAmount: number;
        pricePerGram: number | null;
        fees: number;
        createdAt: string;
      }[];
      total: number;
      page: number;
      hasMore: boolean;
    }>(`/api/v1/wallet/transactions?page=${page}&limit=${limit}`, { token });
  }

  async deposit(amount: number, paymentMethod: string, phoneNumber: string, token: string) {
    return this.request<{
      transactionId: string;
      amount: number;
      paymentMethod: string;
      paymentUrl: string;
      status: string;
    }>('/api/v1/wallet/deposit', {
      method: 'POST',
      body: JSON.stringify({ amount, paymentMethod, phoneNumber }),
      token,
      idempotencyKey: this.generateIdempotencyKey(),
    });
  }

  async withdraw(amount: number, paymentMethod: string, phoneNumber: string, token: string, totpCode?: string) {
    return this.request<{
      withdrawalId: string;
      amount: number;
      paymentMethod: string;
      status: string;
    }>('/api/v1/wallet/withdraw', {
      method: 'POST',
      body: JSON.stringify({ amount, paymentMethod, phoneNumber, totpCode }),
      token,
      idempotencyKey: this.generateIdempotencyKey(),
    });
  }

  // User
  async getProfile(token: string) {
    return this.request<UserProfileData>('/api/v1/users/me', { token });
  }

  // ── Producer: KYB and consignments ──
  //
  // Uploads go through multipart, which is what the API reads (c.req.formData).
  // Content-Type is deliberately NOT set: React Native fills in the multipart
  // boundary itself, and forcing application/json here would break the parse.
  private async uploadFile<T>(endpoint: string, file: { uri: string; name: string; type: string }) {
    const form = new FormData();
    form.append('file', file as unknown as Blob);

    const token = this.getToken();
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'X-API-Version': '1.0',
        'X-Platform': 'mobile',
        'X-Device-Id': this.deviceId || 'unknown',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: form,
    });
    const data = await response.json();
    if (!data?.success) throw new Error(data?.error?.message || "Échec de l'envoi du fichier");
    return data.data as T;
  }

  async getProducerProfile() {
    return this.request<ProducerProfile>('/api/v1/producer/profile');
  }

  async submitProducerProfile(data: {
    entityType: 'INDIVIDUAL' | 'COOPERATIVE' | 'COMPANY';
    legalName: string;
    registrationNumber?: string;
    miningAuthorization?: string;
    representativeName: string;
    representativePhone?: string;
    city?: string;
    region?: string;
    documents?: string[];
  }) {
    return this.request<ProducerProfile>('/api/v1/producer/profile', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  uploadProducerDocument(file: { uri: string; name: string; type: string }) {
    return this.uploadFile<{ key: string }>('/api/v1/producer/profile/documents', file);
  }

  uploadConsignmentPhoto(file: { uri: string; name: string; type: string }) {
    return this.uploadFile<{ key: string }>('/api/v1/producer/consignments/photos', file);
  }

  async getMyConsignments(page = 1, limit = 20) {
    return this.request<{
      items: Consignment[];
      meta: { page: number; limit: number; total: number };
    }>(`/api/v1/producer/consignments?page=${page}&limit=${limit}`);
  }

  async getMyConsignment(id: string) {
    return this.request<{ consignment: Consignment; events: ConsignmentEvent[] }>(
      `/api/v1/producer/consignments/${id}`
    );
  }

  async submitConsignment(data: {
    weightGrams: number;
    purity: number;
    goldType: 'nuggets' | 'powder' | 'bar';
    photos?: string[];
    gps?: { lat: number; lng: number };
    /** True only for a device fix — a typed zone goes in originZone. */
    gpsVerified?: boolean;
    originZone?: string;
  }) {
    return this.request<Consignment>('/api/v1/producer/consignments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Répartition d'un lot (raffineur)
  async getLotDisposition(consignmentId: string) {
    return this.request<LotDispositionView>(
      `/api/v1/producer/consignments/${consignmentId}/disposition`
    );
  }

  async disposeLot(consignmentId: string, split: { sellG: number; leaseG: number; storeG: number }) {
    return this.request<{
      id: string;
      status: DispositionStatus;
      sellG: number;
      leaseG: number;
      storeG: number;
      sellProceedsXof: number | null;
      leasePositionId: string | null;
      failureReason: string | null;
    }>(`/api/v1/producer/consignments/${consignmentId}/disposition`, {
      method: 'POST',
      body: JSON.stringify(split),
    });
  }

  async getStorageFees() {
    return this.request<StorageFeesData>('/api/v1/producer/storage-fees');
  }

  // Gold lease (location d'or)
  async getLeaseTerms() {
    return this.request<LeaseTermsData>('/api/v1/lease/terms');
  }

  async getLeasePositions() {
    return this.request<LeasePositionsData>('/api/v1/lease/positions');
  }

  async getLeaseAccruals(positionId: string) {
    return this.request<LeaseAccrualsData>(
      `/api/v1/lease/positions/${positionId}/accruals`
    );
  }

  async openLeasePosition(grams: number) {
    return this.request<{
      id: string;
      principalG: number;
      annualRate: number;
      status: string;
      openedAt: string;
    }>('/api/v1/lease/positions', {
      method: 'POST',
      body: JSON.stringify({ grams }),
    });
  }

  async requestLeaseExit(positionId: string) {
    return this.request<LeaseExitData>(
      `/api/v1/lease/positions/${positionId}/exit`,
      { method: 'POST' }
    );
  }

  // KYC
  async getKycStatus(token: string) {
    return this.request<KycStatusData>('/api/v1/users/me/kyc/status', { token });
  }

  /**
   * Upload one KYC document page.
   *
   * The API reads multipart (`type` + `file`) and decides the content type from
   * the bytes. This used to POST `{ image: base64 }` as JSON, which the endpoint
   * cannot parse — mobile KYC uploads could never have worked.
   */
  async uploadKycDocument(uri: string, type: 'front' | 'back' | 'selfie') {
    const form = new FormData();
    form.append('type', type);
    form.append('file', {
      uri,
      name: `${type}_${Date.now()}.jpg`,
      type: 'image/jpeg',
    } as unknown as Blob);

    const token = this.getToken();
    const response = await fetch(`${this.baseUrl}/api/v1/users/me/kyc/documents`, {
      method: 'POST',
      headers: {
        'X-API-Version': '1.0',
        'X-Platform': 'mobile',
        'X-Device-Id': this.deviceId || 'unknown',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: form,
    });
    const data = await response.json();
    if (!data?.success) throw new Error(data?.error?.message || "Échec de l'envoi du document");
    return data.data as { documentId: string; type: string; filename: string };
  }

  /**
   * Submit the KYC form. Images are NOT part of this payload — they go through
   * uploadKycDocument first. `nationality` is mandatory server-side; omitting it
   * failed validation, which is why this call could never succeed.
   */
  async submitKyc(data: {
    documentType: 'CNIB' | 'PASSPORT' | 'PERMIT' | 'CEDEAO';
    documentNumber?: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    nationality: string;
    address?: string;
    city?: string;
  }, token: string) {
    return this.request<{
      message: string;
      submissionId: string;
    }>('/api/v1/users/me/kyc', {
      method: 'POST',
      body: JSON.stringify(data),
      token,
    });
  }

  // 2FA
  async setup2FA(token: string) {
    // La route renvoie `secret`, `uri`, `issuer` et `message`. Elle n'a JAMAIS
    // renvoyé `qrCodeUrl` : l'écran web conditionnait tout son bloc à ce champ
    // absent, si bien que ni le QR ni le secret manuel ne s'affichaient et que
    // l'activation 2FA était inutilisable.
    //
    // Aucun QR n'est généré côté serveur, délibérément : le faire via le service
    // externe utilisé pour les certificats enverrait la GRAINE TOTP de chaque
    // utilisateur à un tiers. Un code de vérification de certificat est public,
    // un secret 2FA ne l'est pas.
    return this.request<TwoFactorSetupData>('/api/v1/auth/2fa/setup', {
      method: 'POST',
      token,
    });
  }

  async verify2FA(code: string, token: string) {
    return this.request<{
      message: string;
      backupCodes: string[];
    }>('/api/v1/auth/2fa/verify', {
      method: 'POST',
      body: JSON.stringify({ code }),
      token,
    });
  }

  async disable2FA(code: string, token: string) {
    return this.request<{ message: string }>('/api/v1/auth/2fa/disable', {
      method: 'POST',
      body: JSON.stringify({ code }),
      token,
    });
  }

  // Passwordless Authentication
  async requestPasswordlessCode(identifier: string, method: 'email' | 'sms' = 'email') {
    return this.request<{
      message: string;
      method: string;
      expiresIn: number;
    }>('/api/v1/auth/passwordless/request', {
      method: 'POST',
      body: JSON.stringify({ identifier, method }),
    });
  }

  async verifyPasswordlessCode(identifier: string, code: string, totpCode?: string): Promise<{
    success: true;
    data: {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      user: {
        id: string;
        email: string;
        phone: string;
        country: string;
        kycLevel: 'BASIC' | 'STANDARD' | 'VERIFIED';
        kycStatus: string;
        emailVerified: boolean;
        phoneVerified: boolean;
        twoFactorEnabled: boolean;
      };
    };
  } | {
    success: false;
    requires2FA: true;
    error: { code: string; message: string };
  }> {
    const response = await fetch(`${this.baseUrl}/api/v1/auth/passwordless/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Version': '1.0',
        'X-Platform': 'mobile',
        'X-Device-Id': this.deviceId || 'unknown',
      },
      body: JSON.stringify({ identifier, code, totpCode }),
    });

    const data = await response.json();

    // Handle 2FA required
    if (data.error?.code === 'AUTH_2FA_REQUIRED') {
      return {
        success: false,
        requires2FA: true,
        error: data.error,
      };
    }

    if (!data.success) {
      throw new Error(data.error?.message || 'Code invalide');
    }

    return {
      success: true,
      data: data.data,
    };
  }

  // Certificate
  async getCertificate(token: string) {
    return this.request<{
      certificateId: string;
      verificationCode: string;
      /** PDF — what the holder keeps or hands to a third party. */
      downloadUrl: string;
      /** The same certificate as an in-app HTML view. */
      viewUrl: string;
      userName: string;
      tokenBalance: number;
      /** Grams in an open lease: owned, lent out, not in the wallet. */
      leasedBalance: number;
      totalOwnedGrams: number;
      issuedAt: string;
    }>('/api/v1/wallet/certificate', { token });
  }

  // Price Alerts
  async getPriceAlerts(token: string, includeTriggered = false) {
    return this.request<{
      items: Array<{
        id: string;
        alertType: 'ABOVE' | 'BELOW';
        targetPrice: number;
        currency: 'XOF' | 'USD';
        notificationMethod: 'PUSH' | 'EMAIL' | 'SMS' | 'ALL';
        isActive: boolean;
        triggered: boolean;
        triggeredAt: string | null;
        triggeredPrice: number | null;
        note: string | null;
        createdAt: string;
      }>;
      total: number;
      currentPrice: {
        priceXof: number;
        priceUsd: number;
        buyPrice: number;
        sellPrice: number;
      };
    }>(`/api/v1/users/me/price-alerts?includeTriggered=${includeTriggered}`, { token });
  }

  async createPriceAlert(
    data: {
      alertType: 'ABOVE' | 'BELOW';
      targetPrice: number;
      currency?: 'XOF' | 'USD';
      notificationMethod?: 'PUSH' | 'EMAIL' | 'SMS' | 'ALL';
      note?: string;
    },
    token: string
  ) {
    return this.request<PriceAlertsData>('/api/v1/users/me/price-alerts', {
      method: 'POST',
      body: JSON.stringify({
        alertType: data.alertType,
        targetPrice: data.targetPrice,
        currency: data.currency || 'XOF',
        notificationMethod: data.notificationMethod || 'ALL',
        note: data.note,
      }),
      token,
    });
  }

  async updatePriceAlert(
    alertId: string,
    data: { isActive?: boolean; note?: string },
    token: string
  ) {
    return this.request<{
      id: string;
      message: string;
    }>(`/api/v1/users/me/price-alerts/${alertId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
      token,
    });
  }

  async deletePriceAlert(alertId: string, token: string) {
    return this.request<{ message: string }>(`/api/v1/users/me/price-alerts/${alertId}`, {
      method: 'DELETE',
      token,
    });
  }
}

export type ConsignmentStatus =
  | 'SUBMITTED'
  | 'FORWARDER_VALIDATED'
  | 'IN_TRANSIT'
  | 'ARRIVED_DUBAI'
  | 'AUDIT_VALIDATED'
  | 'REJECTED';

export interface Consignment {
  id: string;
  reference: string;
  weight_declared_g: number;
  purity_declared: number;
  gold_type: 'nuggets' | 'powder' | 'bar';
  photos: string | null;
  status: ConsignmentStatus;
  refined_weight_g: number | null;
  producer_tokens_credited: number | null;
  refinery_lot: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConsignmentEvent {
  id: string;
  from_status: string | null;
  to_status: string;
  actor_role: string | null;
  note: string | null;
  created_at: string;
}

export interface ProducerProfile {
  id: string;
  entity_type: 'INDIVIDUAL' | 'COOPERATIVE' | 'COMPANY';
  legal_name: string;
  registration_number: string | null;
  mining_authorization: string | null;
  representative_name: string;
  representative_phone: string | null;
  city: string | null;
  region: string | null;
  status: 'SUBMITTED' | 'PROCESSING' | 'VERIFIED' | 'REJECTED';
  rejection_reason: string | null;
  created_at: string;
}

export interface LeaseTerms {
  annualRate: number;
  annualRatePercent: number;
  exitSettlementBusinessDays: number;
  minimumGrams: number;
  /** Plain-language warning from the API. Displayed verbatim, never paraphrased. */
  disclosure: string;
}

export type LeasePositionStatus = 'ACTIVE' | 'EXITING' | 'CLOSED';

export interface LeasePosition {
  id: string;
  principalG: number;
  annualRate: number;
  /** Accrued yield in XOF. The principal stays in grams — two units, never mixed. */
  accruedXof: number;
  principalValueXof: number;
  lastAccruedOn: string | null;
  status: LeasePositionStatus;
  openedAt: string;
  closedAt: string | null;
}

export interface LeaseAccrual {
  date: string;
  principalG: number;
  pricePerGram: number;
  annualRate: number;
  amountXof: number;
}

export type DispositionStatus = 'PENDING' | 'EXECUTED' | 'PARTIAL' | 'FAILED';
export type DispositionLegStatus = 'NONE' | 'PENDING' | 'DONE' | 'FAILED';

export interface LotDisposition {
  id: string;
  consignment_id: string;
  total_g: number;
  sell_g: number;
  lease_g: number;
  store_g: number;
  status: DispositionStatus;
  sell_status: DispositionLegStatus;
  lease_status: DispositionLegStatus;
  sell_price_per_gram: number | null;
  sell_proceeds_xof: number | null;
  lease_position_id: string | null;
  failure_reason: string | null;
  created_at: string;
  executed_at: string | null;
}

export interface LotDispositionView {
  consignmentId: string;
  reference: string;
  settled: boolean;
  creditedG: number;
  sellPricePerGram: number | null;
  /** Avertissement de l'API sur la garde — affiché tel quel, jamais reformulé. */
  storageNotice: string;
  disposition: LotDisposition | null;
}

export interface StorageFeeAccrual {
  accrual_date: string;
  stored_g: number;
  price_per_gram: number;
  amount_xof: number;
  status: 'PAID' | 'OUTSTANDING';
}

export const api = new MobileApiClient(API_URL);
export default api;
