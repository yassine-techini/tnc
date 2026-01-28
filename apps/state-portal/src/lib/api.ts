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
  };
  requestId: string;
}

type ApiResult<T> = ApiResponse<T> | ApiError;

interface RequestOptions extends Omit<RequestInit, 'headers'> {
  token?: string;
  headers?: Record<string, string>;
  _isRetry?: boolean;
}

class StateApiClient {
  private baseUrl: string;
  private refreshPromise: Promise<string | null> | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getStoredAuth(): { accessToken: string; refreshToken: string } | null {
    try {
      const raw = localStorage.getItem('tnc-state-auth');
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
      const raw = localStorage.getItem('tnc-state-auth');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      parsed.state.tokens = { accessToken, refreshToken, expiresIn };
      localStorage.setItem('tnc-state-auth', JSON.stringify(parsed));
    } catch { /* ignore */ }
  }

  private clearStoredAuth() {
    try {
      const raw = localStorage.getItem('tnc-state-auth');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      parsed.state = { user: null, tokens: null, isAuthenticated: false };
      localStorage.setItem('tnc-state-auth', JSON.stringify(parsed));
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

  // State Auth (via Cloudflare Access)
  async stateLogin(email: string, password: string) {
    return this.request<{
      user: {
        id: string;
        email: string;
        name: string;
        ministry: string;
      };
      tokens: {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
      };
    }>('/api/v1/state/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  // Dashboard
  async getDashboard(token: string) {
    return this.request<{
      totalAllocated: number;
      tokensIssued: number;
      coverage: number;
      totalUsers: number;
      totalVolume: number;
      lastPriceUpdate: string;
      currentPrice: number;
    }>('/api/v1/state/dashboard', { token });
  }

  // Stock
  async getStock(token: string) {
    return this.request<{
      totalAllocated: number;
      tokensIssued: number;
      availableStock: number;
      coverage: number;
      lastAuditDate: string | null;
      stockHistory: Array<{
        date: string;
        allocated: number;
        issued: number;
      }>;
    }>('/api/v1/state/stock', { token });
  }

  // Reports
  async getProofOfReserve(token: string) {
    return this.request<{
      reportDate: string;
      totalAllocatedGold: number;
      totalTokensIssued: number;
      coverageRatio: number;
      auditStatus: 'VERIFIED' | 'PENDING' | 'EXPIRED';
      lastAuditDate: string | null;
      auditor: string | null;
    }>('/api/v1/state/reports/por', { token });
  }

  async getMonthlyReport(token: string, month?: string) {
    const params = month ? `?month=${month}` : '';
    return this.request<{
      month: string;
      totalTransactions: number;
      totalVolume: number;
      buyVolume: number;
      sellVolume: number;
      newUsers: number;
      activeUsers: number;
      averagePrice: number;
      fees: number;
    }>(`/api/v1/state/reports/monthly${params}`, { token });
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

  // Price History
  async getPriceHistory(token: string, days = 30) {
    return this.request<{
      items: Array<{
        date: string;
        priceXof: number;
        volume: number;
      }>;
    }>(`/api/v1/state/price/history?days=${days}`, { token });
  }

  // Transaction Stats
  async getTransactionStats(token: string, period: 'day' | 'week' | 'month' = 'month') {
    return this.request<{
      items: Array<{
        date: string;
        buyCount: number;
        sellCount: number;
        buyVolume: number;
        sellVolume: number;
      }>;
    }>(`/api/v1/state/transactions/stats?period=${period}`, { token });
  }

  // Export reports
  async exportPorReport(token: string): Promise<Blob> {
    const response = await fetch(`${this.baseUrl}/api/v1/state/reports/por/export`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    if (!response.ok) throw new Error('Export failed');
    return response.blob();
  }

  async exportMonthlyReport(token: string, month?: string): Promise<Blob> {
    const params = month ? `?month=${month}` : '';
    const response = await fetch(`${this.baseUrl}/api/v1/state/reports/monthly/export${params}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    if (!response.ok) throw new Error('Export failed');
    return response.blob();
  }

  async exportRawData(token: string, startDate?: string, endDate?: string): Promise<Blob> {
    const params = new URLSearchParams();
    if (startDate) params.set('start', startDate);
    if (endDate) params.set('end', endDate);
    const query = params.toString() ? `?${params}` : '';
    const response = await fetch(`${this.baseUrl}/api/v1/state/reports/data/export${query}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    if (!response.ok) throw new Error('Export failed');
    return response.blob();
  }
}

export const stateApi = new StateApiClient(API_URL);
