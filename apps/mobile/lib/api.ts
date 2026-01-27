import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { useAuthStore } from '../stores/auth';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://tnc-trading-api-dev.yassine-techini.workers.dev';

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
}

interface RefreshPromise {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

class MobileApiClient {
  private baseUrl: string;
  private deviceId: string | null = null;
  private refreshPromise: RefreshPromise | null = null;

  constructor(baseUrl: string) {
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

  private async request<T>(endpoint: string, options: RequestOptions = {}, isRetry = false): Promise<ApiResponse<T>> {
    const { token, ...fetchOptions } = options;

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

    // Use provided token, fallback to store token
    const authToken = token || this.getToken();
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...fetchOptions,
        headers,
      });

      // Handle 401 Unauthorized
      if (response.status === 401 && !isRetry) {
        // Attempt token refresh
        await this.handleTokenRefresh();

        // Retry the original request with new token
        return this.request<T>(endpoint, options, true);
      }

      const data: ApiResult<T> = await response.json();

      if (!data.success) {
        const errorData = data as ApiError;
        throw new Error(errorData.error?.message || 'Une erreur est survenue');
      }

      return data as ApiResponse<T>;
    } catch (error) {
      // If this was a retry that failed, don't retry again
      if (isRetry) {
        throw error;
      }

      // Check if error is due to authentication
      if (error instanceof Error && error.message.includes('401')) {
        await this.handleTokenRefresh();
        return this.request<T>(endpoint, options, true);
      }

      throw error;
    }
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
}

export const api = new MobileApiClient(API_URL);
export default api;
