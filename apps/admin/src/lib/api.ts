const API_URL = import.meta.env.VITE_API_URL || 'https://tnc-trading-api-dev.yassine-techini.workers.dev';

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
  _isRetry?: boolean;
}

class AdminApiClient {
  private baseUrl: string;
  private refreshPromise: Promise<string | null> | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getStoredAuth(): { accessToken: string; refreshToken: string } | null {
    try {
      const raw = localStorage.getItem('tnc-admin-auth');
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
      const raw = localStorage.getItem('tnc-admin-auth');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      parsed.state.tokens = { accessToken, refreshToken, expiresIn };
      localStorage.setItem('tnc-admin-auth', JSON.stringify(parsed));
    } catch { /* ignore */ }
  }

  private clearStoredAuth() {
    try {
      const raw = localStorage.getItem('tnc-admin-auth');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      parsed.state = { user: null, tokens: null, isAuthenticated: false };
      localStorage.setItem('tnc-admin-auth', JSON.stringify(parsed));
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

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...fetchOptions,
      headers,
    });

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

  // Admin Auth
  async adminLogin(email: string, password: string) {
    return this.request<{
      user: {
        id: string;
        email: string;
        name: string;
        role: 'ADMIN' | 'SUPER_ADMIN';
      };
      tokens: {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
      };
    }>('/api/v1/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  // Dashboard
  async getDashboard(token: string) {
    return this.request<{
      totalUsers: number;
      activeUsers: number;
      totalTransactions: number;
      totalVolume: number;
      pendingKyc: number;
      pendingWithdrawals: number;
      stockCoverage: number;
      recentTransactions: Array<{
        id: string;
        type: string;
        amount: number;
        createdAt: string;
      }>;
    }>('/api/v1/admin/dashboard', { token });
  }

  // Users
  async getUsers(token: string, page = 1, limit = 20, search?: string) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.set('search', search);
    return this.request<{
      items: Array<{
        id: string;
        email: string;
        phone: string;
        country: string;
        kycLevel: string;
        kycStatus: string;
        createdAt: string;
      }>;
      total: number;
      page: number;
      limit: number;
      hasMore: boolean;
    }>(`/api/v1/admin/users?${params}`, { token });
  }

  async getUser(token: string, userId: string) {
    return this.request<{
      id: string;
      email: string;
      phone: string;
      country: string;
      kycLevel: string;
      kycStatus: string;
      emailVerified: boolean;
      phoneVerified: boolean;
      twoFactorEnabled: boolean;
      createdAt: string;
      wallet: {
        tokenBalance: number;
        cashBalance: number;
      };
      kycDocuments: Array<{
        id: string;
        documentType: string;
        verificationStatus: string;
        createdAt: string;
      }>;
    }>(`/api/v1/admin/users/${userId}`, { token });
  }

  async updateUserKyc(token: string, userId: string, action: 'approve' | 'reject', reason?: string) {
    return this.request<{ message: string }>(`/api/v1/admin/users/${userId}/kyc`, {
      method: 'PATCH',
      body: JSON.stringify({ action, reason }),
      token,
    });
  }

  // Transactions
  async getTransactions(token: string, page = 1, limit = 20, type?: string) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (type) params.set('type', type);
    return this.request<{
      items: Array<{
        id: string;
        userId: string;
        userEmail: string;
        type: string;
        status: string;
        tokenAmount: number | null;
        cashAmount: number;
        fees: number;
        createdAt: string;
      }>;
      total: number;
      page: number;
      limit: number;
      hasMore: boolean;
    }>(`/api/v1/admin/transactions?${params}`, { token });
  }

  // Stock
  async getStock(token: string) {
    return this.request<{
      totalAllocated: number;
      tokensIssued: number;
      availableStock: number;
      coverage: number;
      lastAuditDate: string | null;
    }>('/api/v1/admin/stock', { token });
  }

  async adjustStock(token: string, amount: number, reason: string) {
    return this.request<{ message: string; newTotal: number }>('/api/v1/admin/stock/adjust', {
      method: 'POST',
      body: JSON.stringify({ amount, reason }),
      token,
    });
  }

  // Withdrawals
  async getWithdrawals(token: string, status?: string) {
    const params = status ? `?status=${status}` : '';
    return this.request<{
      items: Array<{
        id: string;
        userId: string;
        userEmail: string;
        amount: number;
        paymentMethod: string;
        phoneNumber: string;
        status: string;
        createdAt: string;
      }>;
    }>(`/api/v1/admin/withdrawals${params}`, { token });
  }

  async processWithdrawal(token: string, withdrawalId: string, action: 'approve' | 'reject', reason?: string) {
    return this.request<{ message: string }>(`/api/v1/admin/withdrawals/${withdrawalId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action, reason }),
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

  // KYC Queue
  async getPendingKyc(token: string, page = 1, limit = 20) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    return this.request<{
      items: Array<{
        id: string;
        userId: string;
        email: string;
        phone: string;
        firstName: string;
        lastName: string;
        dateOfBirth: string;
        documentType: string;
        documentNumber: string;
        frontImageUrl: string;
        backImageUrl: string | null;
        selfieUrl: string;
        submittedAt: string;
        kycLevel: string;
      }>;
      total: number;
      page: number;
      limit: number;
      hasMore: boolean;
    }>(`/api/v1/admin/kyc/pending?${params}`, { token });
  }

  async getKycSubmission(token: string, submissionId: string) {
    return this.request<{
      id: string;
      userId: string;
      email: string;
      phone: string;
      firstName: string;
      lastName: string;
      dateOfBirth: string;
      documentType: string;
      documentNumber: string;
      frontImageUrl: string;
      backImageUrl: string | null;
      selfieUrl: string;
      submittedAt: string;
      currentKycLevel: string;
      previousSubmissions: Array<{
        id: string;
        status: string;
        rejectionReason?: string;
        submittedAt: string;
        reviewedAt: string;
      }>;
    }>(`/api/v1/admin/kyc/${submissionId}`, { token });
  }

  async reviewKyc(token: string, submissionId: string, action: 'approve' | 'reject', data: {
    newLevel?: 'STANDARD' | 'VERIFIED';
    rejectionReason?: string;
  }) {
    return this.request<{ message: string }>(`/api/v1/admin/kyc/${submissionId}/review`, {
      method: 'POST',
      body: JSON.stringify({ action, ...data }),
      token,
    });
  }

  // User suspension
  async suspendUser(token: string, userId: string, reason: string) {
    return this.request<{ message: string }>(`/api/v1/admin/users/${userId}/suspend`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
      token,
    });
  }

  async unsuspendUser(token: string, userId: string) {
    return this.request<{ message: string }>(`/api/v1/admin/users/${userId}/unsuspend`, {
      method: 'POST',
      token,
    });
  }
}

export const adminApi = new AdminApiClient(API_URL);
