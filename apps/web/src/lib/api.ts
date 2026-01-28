/**
 * API Client for TNC Trading
 */

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8787' : '');

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
    details?: Record<string, unknown>;
  };
  requestId: string;
}

type ApiResult<T> = ApiResponse<T> | ApiError;

interface RequestOptions extends Omit<RequestInit, 'headers'> {
  token?: string;
  headers?: Record<string, string>;
  _isRetry?: boolean;
}

class ApiClient {
  private baseUrl: string;
  private refreshPromise: Promise<string | null> | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getStoredAuth(): { accessToken: string; refreshToken: string } | null {
    try {
      const raw = localStorage.getItem('tnc-auth-storage');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const tokens = parsed?.state?.tokens;
      if (tokens?.accessToken && tokens?.refreshToken) return tokens;
      return null;
    } catch {
      return null;
    }
  }

  private updateStoredTokens(accessToken: string, refreshToken: string, expiresIn: number) {
    try {
      const raw = localStorage.getItem('tnc-auth-storage');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      parsed.state.tokens = { accessToken, refreshToken, expiresIn };
      localStorage.setItem('tnc-auth-storage', JSON.stringify(parsed));
    } catch { /* ignore */ }
  }

  private clearStoredAuth() {
    try {
      const raw = localStorage.getItem('tnc-auth-storage');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      parsed.state = { user: null, tokens: null, isAuthenticated: false };
      localStorage.setItem('tnc-auth-storage', JSON.stringify(parsed));
    } catch { /* ignore */ }
  }

  private async refreshAccessToken(): Promise<string | null> {
    const auth = this.getStoredAuth();
    if (!auth?.refreshToken) return null;

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: auth.refreshToken }),
      });

      const data = await response.json();
      if (data.success && data.data?.accessToken) {
        this.updateStoredTokens(data.data.accessToken, data.data.refreshToken, data.data.expiresIn);
        return data.data.accessToken;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async request<T>(endpoint: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    const { token, _isRetry, ...fetchOptions } = options;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...fetchOptions,
        headers,
      });
    } catch (error) {
      // Retry on network errors (max 2 retries with exponential backoff)
      if (!_isRetry && error instanceof TypeError) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          response = await fetch(`${this.baseUrl}${endpoint}`, { ...fetchOptions, headers });
        } catch {
          await new Promise((r) => setTimeout(r, 2000));
          response = await fetch(`${this.baseUrl}${endpoint}`, { ...fetchOptions, headers });
        }
      } else {
        throw error;
      }
    }

    // On 401, try to refresh the token once
    if (response.status === 401 && token && !_isRetry) {
      if (!this.refreshPromise) {
        this.refreshPromise = this.refreshAccessToken().finally(() => {
          this.refreshPromise = null;
        });
      }

      const newToken = await this.refreshPromise;
      if (newToken) {
        return this.request<T>(endpoint, { ...options, token: newToken, _isRetry: true });
      }

      // Refresh failed - clear auth and redirect to login
      this.clearStoredAuth();
      window.location.href = '/login';
      throw new Error('Session expirée, veuillez vous reconnecter');
    }

    const data: ApiResult<T> = await response.json();

    if (!data.success) {
      throw new Error(data.error?.message || 'Une erreur est survenue');
    }

    return data;
  }

  // Auth
  async register(email: string, phone: string, password: string, country = 'BF', firstName?: string, lastName?: string) {
    return this.request<{ message: string; userId: string }>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, phone, password, country, firstName, lastName }),
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

  async logout(token: string) {
    return this.request<{ message: string }>('/api/v1/auth/logout', {
      method: 'POST',
      token,
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

  async getPriceHistory(period: '24h' | '7d' | '30d' | '1y' = '7d') {
    return this.request<{
      items: { timestamp: string; priceXof: number }[];
      period: string;
    }>(`/api/v1/market/price/history?period=${period}`);
  }

  async getStock() {
    return this.request<{
      totalAllocated: number;
      tokensIssued: number;
      availableStock: number;
      coverage: number | null;
      lastAuditDate: string | null;
    }>('/api/v1/market/stock');
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
      createdAt: string;
      updatedAt: string;
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
        paymentMethod: string | null;
        createdAt: string;
        completedAt: string | null;
      }[];
      total: number;
      page: number;
      limit: number;
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
      estimatedTime: string;
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

  async updateProfile(data: { phone?: string; country?: string }, token: string) {
    return this.request<{ message: string }>('/api/v1/users/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
      token,
    });
  }

  // Email verification
  async verifyEmail(token: string) {
    return this.request<{ message: string }>('/api/v1/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  async resendVerificationEmail(email: string) {
    return this.request<{ message: string }>('/api/v1/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  // Phone verification
  async sendPhoneVerification(phone: string, authToken: string) {
    return this.request<{ message: string }>('/api/v1/auth/verify-phone/send', {
      method: 'POST',
      body: JSON.stringify({ phone }),
      token: authToken,
    });
  }

  async verifyPhone(code: string, authToken: string) {
    return this.request<{ message: string }>('/api/v1/auth/verify-phone', {
      method: 'POST',
      body: JSON.stringify({ code }),
      token: authToken,
    });
  }

  // Password reset
  async forgotPassword(email: string) {
    return this.request<{ message: string }>('/api/v1/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async resetPassword(token: string, password: string) {
    return this.request<{ message: string }>('/api/v1/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
  }

  async changePassword(currentPassword: string, newPassword: string, authToken: string) {
    return this.request<{ message: string }>('/api/v1/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
      token: authToken,
    });
  }

  // 2FA
  async setup2FA(authToken: string) {
    return this.request<{
      secret: string;
      qrCodeUrl: string;
    }>('/api/v1/auth/2fa/setup', {
      method: 'POST',
      token: authToken,
    });
  }

  async verify2FA(code: string, authToken: string) {
    return this.request<{
      message: string;
      backupCodes: string[];
    }>('/api/v1/auth/2fa/verify', {
      method: 'POST',
      body: JSON.stringify({ code }),
      token: authToken,
    });
  }

  async disable2FA(code: string, authToken: string) {
    return this.request<{ message: string }>('/api/v1/auth/2fa/disable', {
      method: 'POST',
      body: JSON.stringify({ code }),
      token: authToken,
    });
  }

  // Sessions
  async getSessions(authToken: string) {
    return this.request<{
      sessions: {
        id: string;
        userAgent: string;
        ipAddress: string;
        lastUsed: string;
        createdAt: string;
        isCurrent: boolean;
      }[];
    }>('/api/v1/auth/sessions', { token: authToken });
  }

  async revokeSession(sessionId: string, authToken: string) {
    return this.request<{ message: string }>(`/api/v1/auth/sessions/${sessionId}`, {
      method: 'DELETE',
      token: authToken,
    });
  }

  async revokeAllSessions(authToken: string) {
    return this.request<{ message: string }>('/api/v1/auth/sessions', {
      method: 'DELETE',
      token: authToken,
    });
  }

  // KYC
  async getKycStatus(authToken: string) {
    return this.request<{
      level: 'BASIC' | 'STANDARD' | 'VERIFIED';
      status: 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
      rejectionReason?: string;
      submittedAt?: string;
      reviewedAt?: string;
      documents?: {
        id: string;
        type: string;
        status: string;
      }[];
    }>('/api/v1/users/me/kyc/status', { token: authToken });
  }

  async submitKyc(
    data: {
      documentType: 'CNIB' | 'PASSPORT' | 'PERMIT' | 'CEDEAO';
      documentNumber: string;
      firstName: string;
      lastName: string;
      dateOfBirth: string;
      frontImage: string;
      backImage?: string;
      selfieImage: string;
    },
    authToken: string
  ) {
    return this.request<{
      message: string;
      submissionId: string;
    }>('/api/v1/users/me/kyc', {
      method: 'POST',
      body: JSON.stringify(data),
      token: authToken,
    });
  }

  async uploadKycDocument(file: File, authToken: string) {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${this.baseUrl}/api/v1/users/me/kyc/documents`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
      body: formData,
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error?.message || 'Erreur lors du téléchargement');
    }

    return data as ApiResponse<{ url: string; documentId: string }>;
  }

  // Notification Preferences
  async getNotificationPreferences(authToken: string) {
    return this.request<{
      email: boolean;
      sms: boolean;
      priceAlerts: boolean;
      transactionAlerts: boolean;
      marketingEmails: boolean;
    }>('/api/v1/users/me/preferences/notifications', { token: authToken });
  }

  async updateNotificationPreferences(
    preferences: {
      email?: boolean;
      sms?: boolean;
      priceAlerts?: boolean;
      transactionAlerts?: boolean;
      marketingEmails?: boolean;
    },
    authToken: string
  ) {
    return this.request<{
      email: boolean;
      sms: boolean;
      priceAlerts: boolean;
      transactionAlerts: boolean;
      marketingEmails: boolean;
    }>('/api/v1/users/me/preferences/notifications', {
      method: 'PATCH',
      body: JSON.stringify(preferences),
      token: authToken,
    });
  }

  // Price Alerts
  async getPriceAlerts(authToken: string, includeTriggered = false) {
    return this.request<{
      items: {
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
      }[];
      total: number;
      currentPrice: { buyPrice: number; sellPrice: number } | null;
    }>(`/api/v1/users/me/price-alerts?includeTriggered=${includeTriggered}`, { token: authToken });
  }

  async createPriceAlert(
    data: {
      alertType: 'ABOVE' | 'BELOW';
      targetPrice: number;
      currency?: 'XOF' | 'USD';
      notificationMethod?: 'PUSH' | 'EMAIL' | 'SMS' | 'ALL';
      note?: string;
    },
    authToken: string
  ) {
    return this.request<{
      id: string;
      alertType: 'ABOVE' | 'BELOW';
      targetPrice: number;
      currency: string;
      notificationMethod: string;
      message: string;
    }>('/api/v1/users/me/price-alerts', {
      method: 'POST',
      body: JSON.stringify(data),
      token: authToken,
    });
  }

  async updatePriceAlert(
    alertId: string,
    data: {
      targetPrice?: number;
      notificationMethod?: 'PUSH' | 'EMAIL' | 'SMS' | 'ALL';
      isActive?: boolean;
      note?: string;
    },
    authToken: string
  ) {
    return this.request<{ id: string; message: string }>(`/api/v1/users/me/price-alerts/${alertId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
      token: authToken,
    });
  }

  async deletePriceAlert(alertId: string, authToken: string) {
    return this.request<{ message: string }>(`/api/v1/users/me/price-alerts/${alertId}`, {
      method: 'DELETE',
      token: authToken,
    });
  }

  // Certificate
  async generateCertificate(authToken: string) {
    return this.request<{
      certificateId: string;
      downloadUrl: string;
      expiresAt: string;
      userName: string;
      userEmail: string;
      tokenBalance: number;
      equivalentGrams: number;
      currentPriceXof: number;
      estimatedValueXof: number;
      generatedAt: string;
    }>('/api/v1/wallet/certificate', { token: authToken });
  }

  // Account deletion
  async deleteAccount(password: string, authToken: string) {
    return this.request<{ message: string }>('/api/v1/users/me', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
      token: authToken,
    });
  }
}

export const api = new ApiClient(API_URL);
export default api;
