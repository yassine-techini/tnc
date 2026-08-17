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
  private refreshPromise: Promise<boolean> | null = null;
  private onAuthError: (() => void) | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Set callback for auth errors (session expiry, etc.)
   */
  setAuthErrorCallback(callback: () => void) {
    this.onAuthError = callback;
  }

  /**
   * Attempt to refresh the session using httpOnly refresh cookie
   */
  private async refreshSession(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Send cookies
      });
      const data = await response.json();
      return data.success === true;
    } catch {
      return false;
    }
  }

  private async request<T>(endpoint: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    const { token, _isRetry, ...fetchOptions } = options;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // For backward compatibility, still support explicit token
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...fetchOptions,
      headers,
      credentials: 'include', // Send httpOnly cookies
    });

    // On 401, try to refresh the session once (using httpOnly cookie)
    if (response.status === 401 && !_isRetry) {
      if (!this.refreshPromise) {
        this.refreshPromise = this.refreshSession().finally(() => {
          this.refreshPromise = null;
        });
      }

      const refreshed = await this.refreshPromise;
      if (refreshed) {
        return this.request<T>(endpoint, { ...options, _isRetry: true });
      }

      // Refresh failed - notify auth error handler
      if (this.onAuthError) {
        this.onAuthError();
      }
      throw new Error('Session expirée, veuillez vous reconnecter');
    }

    const data: ApiResult<T> = await response.json();

    if (!data.success) {
      throw new Error(data.error?.message || 'Une erreur est survenue');
    }

    return data;
  }

  // State Auth with 2FA support
  async stateLogin(email: string, password: string, totpCode?: string) {
    const response = await fetch(`${this.baseUrl}/api/v1/state/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, totpCode }),
      credentials: 'include', // Receive httpOnly cookies
    });

    const data = await response.json();

    // Handle 2FA setup required
    if (data.error?.code === '2FA_SETUP_REQUIRED') {
      return {
        success: false as const,
        requires2FASetup: true,
        setupToken: data.data?.setupToken,
        error: data.error,
      };
    }

    // Handle 2FA code required
    if (data.error?.code === '2FA_REQUIRED') {
      return {
        success: false as const,
        requires2FA: true,
        error: data.error,
      };
    }

    // Handle other errors
    if (!data.success) {
      throw new Error(data.error?.message || 'Erreur de connexion');
    }

    return {
      success: true as const,
      data: data.data as {
        user: {
          id: string;
          email: string;
          name: string;
          ministry: string;
          twoFactorEnabled: boolean;
        };
        tokens: {
          accessToken: string;
          refreshToken: string;
          expiresIn: number;
        };
      },
    };
  }

  // 2FA Setup - get secret and QR code
  async state2FASetup(setupToken: string) {
    return this.request<{
      secret: string;
      uri: string;
      issuer: string;
      message: string;
    }>('/api/v1/state/2fa/setup', {
      method: 'POST',
      body: JSON.stringify({ setupToken }),
    });
  }

  // 2FA Verify - complete setup and get tokens
  async state2FAVerify(setupToken: string, code: string) {
    return this.request<{
      message: string;
      user: {
        id: string;
        email: string;
        name: string;
        ministry: string;
        twoFactorEnabled: boolean;
      };
      tokens: {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
      };
    }>('/api/v1/state/2fa/verify', {
      method: 'POST',
      body: JSON.stringify({ setupToken, code }),
    });
  }

  // Dashboard
  async getDashboard(token?: string) {
    // Ces champs sont EXACTEMENT ceux que la route renvoie. La déclaration
    // précédente annonçait totalAllocated / tokensIssued / coverage, qu'aucune
    // réponse ne contenait : le tableau de bord affichait donc en permanence
    // 0 g de réserve et 0 % de couverture, avec l'alerte rouge qui va avec.
    // TypeScript ne pouvait rien voir — le mensonge était dans le paramètre de
    // type lui-même.
    return this.request<{
      totalUsers: number;
      totalTokens: number;
      totalVolume: number;
      goldAllocated: number;
      /** Or prêté, donc absent du coffre. */
      goldOnLoan: number;
      goldVaulted: number;
      fullyVaulted: boolean;
      coverageRatio: number;
      monthlyVolume: number;
      lastUpdate: string;
    }>('/api/v1/state/dashboard', { token });
  }

  // Stock
  async getStock(token?: string) {
    return this.request<{
      totalAllocated: number;
      tokensIssued: number;
      availableStock: number;
      /** Alloué n'est pas détenu : cette part est due par une contrepartie. */
      goldOnLoan: number;
      goldVaulted: number;
      fullyVaulted: boolean;
      /** Avertissement de l'API sur le prêt — affiché tel quel. */
      lendingNotice: string;
      coverageRatio: number;
      lastAuditDate: string | null;
      lastAuditResult: string | null;
    }>('/api/v1/state/stock', { token });
  }

  // Reports
  async getProofOfReserve(token?: string) {
    // Noms réels de la route. La déclaration précédente annonçait
    // totalAllocatedGold, totalTokensIssued, auditStatus et auditor — aucun
    // n'existait, si bien que le rapport de preuve de réserve montrait à un
    // ministère 0 g alloué, 0 g émis et un audit « En attente » permanent.
    return this.request<{
      reportDate: string;
      goldAllocated: number;
      tokensInCirculation: number;
      coverageRatio: number;
      lastAuditDate: string | null;
      lastAuditResult: string | null;
      certificationStatus: string;
      walletDistribution: Array<{ range: string; count: number }>;
      transactionSummary: Array<{ type: string; count: number; total: number }>;
    }>('/api/v1/state/reports/por', { token });
  }

  async getMonthlyReport(month?: string, token?: string) {
    const params = month ? `?month=${month}` : '';
    // Les totaux se DÉRIVENT de `transactionStats`, groupé par type : la route
    // ne les pré-calcule pas, et le client prétendait les recevoir.
    return this.request<{
      month: string;
      reportGeneratedAt: string;
      transactionStats: Array<{
        type: string;
        count: number;
        total_cash: number;
        total_tokens: number;
        total_fees: number;
      }>;
      newUsers: number;
      activeUsers: number;
      /** null quand aucun prix n'a été relevé ce mois-là. */
      averagePrice: number | null;
      kycStats: Array<{ kyc_level: string; count: number }>;
      stockStatus: {
        goldAllocated: number;
        tokensInCirculation: number;
        coverageRatio: number;
      };
    }>(`/api/v1/state/reports/monthly${params}`, { token });
  }

  // Market
  // ── Traçabilité des lots ──
  async getConsignments(status?: string, page = 1, limit = 25) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (status) params.set('status', status);
    return this.request<{
      items: StateConsignment[];
      meta: { page: number; limit: number; total: number };
    }>(`/api/v1/state/consignments?${params}`);
  }

  async getConsignment(id: string) {
    return this.request<{
      consignment: StateConsignment;
      events: Array<{ to_status: string; actor_role: string | null; note: string | null; created_at: string }>;
      documents: Array<{ doc_type: string; issuer: string | null; reference: string | null; issued_at: string | null }>;
    }>(`/api/v1/state/consignments/${id}`);
  }

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
  async getPriceHistory(days = 30, token?: string) {
    return this.request<{
      items: Array<{
        date: string;
        priceXof: number;
        volume: number;
      }>;
    }>(`/api/v1/state/price/history?days=${days}`, { token });
  }

  // Transaction Stats
  async getTransactionStats(period: 'day' | 'week' | 'month' = 'month', token?: string) {
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
  async exportPorReport(): Promise<Blob> {
    const response = await fetch(`${this.baseUrl}/api/v1/state/reports/por/export`, {
      credentials: 'include', // Use httpOnly cookies
    });
    if (!response.ok) throw new Error('Export failed');
    return response.blob();
  }

  async exportMonthlyReport(month?: string): Promise<Blob> {
    const params = month ? `?month=${month}` : '';
    const response = await fetch(`${this.baseUrl}/api/v1/state/reports/monthly/export${params}`, {
      credentials: 'include', // Use httpOnly cookies
    });
    if (!response.ok) throw new Error('Export failed');
    return response.blob();
  }

  async exportRawData(startDate?: string, endDate?: string): Promise<Blob> {
    const params = new URLSearchParams();
    if (startDate) params.set('start', startDate);
    if (endDate) params.set('end', endDate);
    const query = params.toString() ? `?${params}` : '';
    const response = await fetch(`${this.baseUrl}/api/v1/state/reports/data/export${query}`, {
      credentials: 'include', // Use httpOnly cookies
    });
    if (!response.ok) throw new Error('Export failed');
    return response.blob();
  }
}

export interface StateConsignment {
  id: string;
  reference: string;
  status: string;
  weight_declared_g: number;
  purity_declared: number;
  gold_type: string;
  origin_country: string | null;
  origin_zone: string | null;
  /** 1 when the position came from a device fix, 0 when it was declared. */
  origin_verified: number;
  origin_gps_lat: number | null;
  origin_gps_lng: number | null;
  refined_weight_g: number | null;
  refinery_lot?: string | null;
  audited_at: string | null;
  created_at: string;
  document_count?: number;
}

export const stateApi = new StateApiClient(API_URL);
