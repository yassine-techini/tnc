import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { useAuthStore } from '../stores/auth';

// API URL must be set via environment variable in production builds
const API_URL = process.env.EXPO_PUBLIC_API_URL || (__DEV__
  ? 'https://tnc-trading-api-dev.yassine-techini.workers.dev'
  : (() => { throw new Error('EXPO_PUBLIC_API_URL must be set in production'); })()
);

// Expected API host for certificate pinning validation
const ALLOWED_API_HOSTS = [
  'tnc-trading-api-dev.yassine-techini.workers.dev',
  'api.tnc-trading.com',
];

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
    // Validate API host against allowlist
    try {
      const url = new URL(baseUrl);
      if (!ALLOWED_API_HOSTS.includes(url.host)) {
        console.warn(`API host ${url.host} not in allowlist — possible misconfiguration`);
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
          throw new Error(errorData.error?.message || 'Une erreur est survenue');
        }

        return data as ApiResponse<T>;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Convert AbortError to a user-friendly timeout message
        if (lastError.name === 'AbortError') {
          lastError = new Error('Connexion lente. Veuillez réessayer.');
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

  // Auth
  async register(email: string, phone: string, password: string, country = 'BF') {
    return this.request<{ message: string; userId: string }>('/api/v1/auth/register', {
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
    return this.request<{
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    }>('/api/v1/auth/refresh', {
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
    return this.request<{
      totalAllocated: number;
      tokensIssued: number;
      availableStock: number;
      coverage: number | null;
    }>('/api/v1/market/stock');
  }

  async getPriceHistory(period: '24h' | '7d' | '30d' = '24h') {
    return this.request<{
      prices: { timestamp: string; priceXof: number }[];
      period: string;
    }>(`/api/v1/market/price/history?period=${period}`);
  }

  async getQuote(type: 'BUY' | 'SELL', amount: number, amountType: 'grams' | 'xof', token: string) {
    return this.request<{
      quoteId: string;
      type: 'BUY' | 'SELL';
      tokenAmount: number;
      cashAmount: number;
      pricePerGram: number;
      fees: number;
      total: number;
      expiresAt: string;
    }>('/api/v1/market/quote', {
      method: 'POST',
      body: JSON.stringify({ type, amount, amountType }),
      token,
    });
  }

  async executeBuy(quoteId: string, paymentMethod: string, token: string) {
    return this.request<{
      transactionId: string;
      type: 'BUY';
      tokenAmount: number;
      cashAmount: number;
      status: string;
    }>('/api/v1/market/buy', {
      method: 'POST',
      body: JSON.stringify({ quoteId, paymentMethod }),
      token,
      idempotencyKey: this.generateIdempotencyKey(),
    });
  }

  async executeSell(quoteId: string, paymentMethod: string, token: string) {
    return this.request<{
      transactionId: string;
      type: 'SELL';
      tokenAmount: number;
      cashAmount: number;
      status: string;
    }>('/api/v1/market/sell', {
      method: 'POST',
      body: JSON.stringify({ quoteId, paymentMethod }),
      token,
      idempotencyKey: this.generateIdempotencyKey(),
    });
  }

  // Wallet
  async getWallet(token: string) {
    return this.request<{
      id: string;
      userId: string;
      tokenBalance: number;
      cashBalance: number;
      estimatedValue: number;
      averageBuyPrice: number;
      profitLoss: number;
      profitLossPercent: number;
    }>('/api/v1/wallet', { token });
  }

  async getTransactions(token: string, page = 1, limit = 20) {
    return this.request<{
      items: {
        id: string;
        type: 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL' | 'FEE';
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

  async withdraw(amount: number, paymentMethod: string, phoneNumber: string, token: string) {
    return this.request<{
      withdrawalId: string;
      amount: number;
      paymentMethod: string;
      status: string;
    }>('/api/v1/wallet/withdraw', {
      method: 'POST',
      body: JSON.stringify({ amount, paymentMethod, phoneNumber }),
      token,
      idempotencyKey: this.generateIdempotencyKey(),
    });
  }

  // User
  async getProfile(token: string) {
    return this.request<{
      id: string;
      email: string;
      phone: string;
      kycLevel: 'BASIC' | 'STANDARD' | 'VERIFIED';
      kycStatus: string;
    }>('/api/v1/users/me', { token });
  }

  // KYC
  async getKycStatus(token: string) {
    return this.request<{
      level: 'BASIC' | 'STANDARD' | 'VERIFIED';
      status: 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
      rejectionReason?: string;
      submittedAt?: string;
    }>('/api/v1/users/me/kyc/status', { token });
  }

  async uploadKycDocument(base64Image: string, token: string) {
    return this.request<{
      url: string;
      documentId: string;
    }>('/api/v1/users/me/kyc/documents', {
      method: 'POST',
      body: JSON.stringify({ image: base64Image }),
      token,
    });
  }

  async submitKyc(data: {
    documentType: 'CNIB' | 'PASSPORT' | 'PERMIT' | 'CEDEAO';
    documentNumber: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    frontImage: string;
    backImage?: string;
    selfieImage: string;
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
    return this.request<{
      secret: string;
      qrCodeUrl: string;
    }>('/api/v1/auth/2fa/setup', {
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

  // Certificate
  async getCertificate(token: string) {
    return this.request<{
      certificateId: string;
      verificationCode: string;
      downloadUrl: string;
      userName: string;
      tokenBalance: number;
      issuedAt: string;
    }>('/api/v1/wallet/certificate', { token });
  }
}

export const api = new MobileApiClient(API_URL);
export default api;
