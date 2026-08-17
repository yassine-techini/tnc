const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8787' : '');
// Contrats partages avec l API.
import type {
  AdminDashboardData,
  RealtimeMetricsData,
  LogSearchData,
  StructuredLogData,
  LogStatsData,
  AlertRulesData,
  AnalyticsHistoryData,
  AdminPermissionsData,
  AdminStockData,
} from '@tnc-trading/shared/contracts';

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

  // Admin Auth with 2FA support
  async adminLogin(email: string, password: string, totpCode?: string) {
    const response = await fetch(`${this.baseUrl}/api/v1/admin/login`, {
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
          role: string;
          permissions: Record<string, string[]>;
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
  async admin2FASetup(setupToken: string) {
    return this.request<{
      secret: string;
      uri: string;
      issuer: string;
      message: string;
    }>('/api/v1/admin/2fa/setup', {
      method: 'POST',
      body: JSON.stringify({ setupToken }),
    });
  }

  // 2FA Verify - complete setup and get tokens
  async admin2FAVerify(setupToken: string, code: string) {
    return this.request<{
      message: string;
      user: {
        id: string;
        email: string;
        name: string;
        role: string;
        permissions: Record<string, string[]>;
        twoFactorEnabled: boolean;
      };
      tokens: {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
      };
    }>('/api/v1/admin/2fa/verify', {
      method: 'POST',
      body: JSON.stringify({ setupToken, code }),
    });
  }

  // Dashboard
  async getDashboard(token?: string) {
    return this.request<AdminDashboardData>('/api/v1/admin/dashboard', { token });
  }

  // Users
  async getUsers(page = 1, limit = 20, search?: string, token?: string) {
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

  async getUser(userId: string, token?: string) {
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

  async updateUserKyc(userId: string, action: 'approve' | 'reject', reason?: string, token?: string) {
    return this.request<{ message: string }>(`/api/v1/admin/users/${userId}/kyc`, {
      method: 'PATCH',
      body: JSON.stringify({ action, reason }),
      token,
    });
  }

  // Transactions
  async getTransactions(page = 1, limit = 20, type?: string, token?: string) {
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
  async getStock(token?: string) {
    return this.request<AdminStockData>('/api/v1/admin/stock', { token });
  }

  async adjustStock(amount: number, reason: string, token?: string) {
    return this.request<{ message: string; newTotal: number }>('/api/v1/admin/stock/adjust', {
      method: 'POST',
      body: JSON.stringify({ amount, reason }),
      token,
    });
  }

  // Withdrawals
  async getWithdrawals(status?: string, token?: string) {
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

  async processWithdrawal(withdrawalId: string, action: 'approve' | 'reject', reason?: string, token?: string) {
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
  async getPendingKyc(page = 1, limit = 20, token?: string) {
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

  async getKycSubmission(submissionId: string, token?: string) {
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

  async reviewKyc(submissionId: string, action: 'approve' | 'reject', data: {
    newLevel?: 'STANDARD' | 'VERIFIED';
    rejectionReason?: string;
  }, token?: string) {
    return this.request<{ message: string }>(`/api/v1/admin/kyc/${submissionId}/review`, {
      method: 'POST',
      body: JSON.stringify({ action, ...data }),
      token,
    });
  }

  // User suspension
  async suspendUser(userId: string, reason: string, token?: string) {
    return this.request<{ message: string }>(`/api/v1/admin/users/${userId}/suspend`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
      token,
    });
  }

  async unsuspendUser(userId: string, token?: string) {
    return this.request<{ message: string }>(`/api/v1/admin/users/${userId}/unsuspend`, {
      method: 'POST',
      token,
    });
  }

  // My permissions
  async getMyPermissions(token?: string) {
    return this.request<AdminPermissionsData>('/api/v1/admin/me/permissions', { token });
  }

  // Admin Management
  async getAdmins(token?: string) {
    return this.request<{
      items: Array<{
        id: string;
        email: string;
        name: string;
        role: string;
        active: boolean;
        lastLoginAt: string | null;
        createdAt: string;
      }>;
    }>('/api/v1/admin/admins', { token });
  }

  async getAdmin(adminId: string, token?: string) {
    return this.request<{
      id: string;
      email: string;
      name: string;
      role: string;
      active: boolean;
      lastLoginAt: string | null;
      createdAt: string;
      permissions: Record<string, string[]>;
      overrides: Array<{ module: string; action: string; granted: boolean }>;
    }>(`/api/v1/admin/admins/${adminId}`, { token });
  }

  async createAdmin(data: { email: string; name?: string; password: string; role: string }, token?: string) {
    return this.request<{ id: string; email: string; name: string; role: string }>('/api/v1/admin/admins', {
      method: 'POST',
      body: JSON.stringify(data),
      token,
    });
  }

  async updateAdmin(adminId: string, data: { role?: string; active?: boolean; name?: string }, token?: string) {
    return this.request<{ message: string }>(`/api/v1/admin/admins/${adminId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
      token,
    });
  }

  async deleteAdmin(adminId: string, token?: string) {
    return this.request<{ message: string }>(`/api/v1/admin/admins/${adminId}`, {
      method: 'DELETE',
      token,
    });
  }

  async getAdminPermissions(adminId: string, token?: string) {
    return this.request<{
      overrides: Array<{ module: string; action: string; granted: boolean }>;
    }>(`/api/v1/admin/admins/${adminId}/permissions`, { token });
  }

  async updateAdminPermissions(adminId: string, overrides: Array<{ module: string; action: string; granted: boolean }>, token?: string) {
    return this.request<{ message: string }>(`/api/v1/admin/admins/${adminId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ overrides }),
      token,
    });
  }

  // Integrations
  async getIntegrations(token?: string) {
    return this.request<{
      items: Array<{
        id: string;
        provider: string;
        displayName: string;
        category: string;
        enabled: boolean;
        config: Record<string, string>;
        lastTestedAt: string | null;
        lastTestResult: string | null;
        updatedAt: string;
      }>;
    }>('/api/v1/admin/integrations', { token });
  }

  async getIntegration(provider: string, token?: string) {
    return this.request<{
      id: string;
      provider: string;
      displayName: string;
      category: string;
      enabled: boolean;
      config: Record<string, string>;
      lastTestedAt: string | null;
      lastTestResult: string | null;
      updatedAt: string;
      secretsStatus: Record<string, boolean>;
    }>(`/api/v1/admin/integrations/${provider}`, { token });
  }

  async updateIntegration(provider: string, data: { enabled?: boolean; config?: Record<string, string> }, token?: string) {
    return this.request<{ message: string }>(`/api/v1/admin/integrations/${provider}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
      token,
    });
  }

  async testIntegration(provider: string, token?: string) {
    return this.request<{
      provider: string;
      testResult: string;
      message: string;
      testedAt: string;
    }>(`/api/v1/admin/integrations/${provider}/test`, {
      method: 'POST',
      token,
    });
  }

  // Configuration
  async getConfig(token?: string) {
    return this.request<{
      items: Array<{
        key: string;
        value: string;
        description: string | null;
        updated_at: string;
        updated_by: string | null;
      }>;
    }>('/api/v1/admin/config', { token });
  }

  async updateConfig(key: string, value: string, token?: string) {
    return this.request<{ message: string }>(`/api/v1/admin/config/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body: JSON.stringify({ value }),
      token,
    });
  }

  // Audit Logs
  async getAuditLogs(params: {
    page?: number;
    limit?: number;
    action?: string;
    entityType?: string;
    adminId?: string;
    startDate?: string;
    endDate?: string;
  } = {}, token?: string) {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.action) qs.set('action', params.action);
    if (params.entityType) qs.set('entityType', params.entityType);
    if (params.adminId) qs.set('adminId', params.adminId);
    if (params.startDate) qs.set('startDate', params.startDate);
    if (params.endDate) qs.set('endDate', params.endDate);
    return this.request<{
      items: Array<{
        id: string;
        admin_id: string;
        admin_email: string;
        admin_name: string;
        user_id: string | null;
        user_email: string | null;
        action: string;
        entity_type: string;
        entity_id: string;
        old_value: string | null;
        new_value: string | null;
        ip_address: string | null;
        created_at: string;
      }>;
      total: number;
      page: number;
      limit: number;
    }>(`/api/v1/admin/audit-logs?${qs}`, { token });
  }
  // Analytics
  async getAnalyticsDashboard(token?: string) {
    return this.request<{
      realtime: {
        requestsLast5Min: number;
        errorsLast5Min: number;
        transactionsLast5Min: number;
        activeUsers: number;
        avgLatencyMs: number;
      } | null;
      todayTransactions: Array<{
        type: string;
        status: string;
        count: number;
        total_amount: number;
      }>;
      pendingKyc: number;
      pendingWithdrawals: number;
      activeAlerts: number;
      goldStock: {
        total_allocated: number;
        tokens_issued: number;
        available_stock: number;
      } | null;
      timestamp: string;
    }>('/api/v1/admin/analytics/dashboard', { token });
  }

  async getRealtimeMetrics(token?: string) {
    return this.request<RealtimeMetricsData>('/api/v1/admin/analytics/realtime', { token });
  }

  async getAnalyticsHistory(period: '24h' | '7d' | '30d' = '24h', token?: string) {
    return this.request<AnalyticsHistoryData>(`/api/v1/admin/analytics/history?period=${period}`, { token });
  }

  async searchLogs(filters: {
    startDate?: string;
    endDate?: string;
    level?: string;
    category?: string;
    action?: string;
    userId?: string;
    requestId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }, token?: string) {
    const params = new URLSearchParams();
    if (filters.startDate) params.set('startDate', filters.startDate);
    if (filters.endDate) params.set('endDate', filters.endDate);
    if (filters.level) params.set('level', filters.level);
    if (filters.category) params.set('category', filters.category);
    if (filters.action) params.set('action', filters.action);
    if (filters.userId) params.set('userId', filters.userId);
    if (filters.requestId) params.set('requestId', filters.requestId);
    if (filters.search) params.set('search', filters.search);
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.offset) params.set('offset', String(filters.offset));
    return this.request<LogSearchData>(`/api/v1/admin/analytics/logs?${params}`, { token });
  }

  async getLogDetail(logId: string, token?: string) {
    return this.request<StructuredLogData>(`/api/v1/admin/analytics/logs/${logId}`, { token });
  }

  async getLogStats(startDate?: string, endDate?: string, token?: string) {
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    return this.request<LogStatsData>(`/api/v1/admin/analytics/logs/stats?${params}`, { token });
  }

  async getAlertRules(token?: string) {
    return this.request<AlertRulesData>('/api/v1/admin/analytics/alerts/rules', { token });
  }

  async createAlertRule(data: {
    name: string;
    description?: string;
    metric: string;
    operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
    threshold: number;
    severity: 'info' | 'warning' | 'critical';
    cooldownMinutes?: number;
    notifyEmail?: boolean;
    notifySms?: boolean;
    notifyWebhook?: string;
  }, token?: string) {
    return this.request<{ id: string }>('/api/v1/admin/analytics/alerts/rules', {
      method: 'POST',
      body: JSON.stringify(data),
      token,
    });
  }

  async updateAlertRule(ruleId: string, data: Partial<{
    name: string;
    description: string;
    metric: string;
    operator: string;
    threshold: number;
    severity: string;
    cooldownMinutes: number;
    notifyEmail: boolean;
    notifySms: boolean;
    notifyWebhook: string;
    enabled: boolean;
  }>, token?: string) {
    return this.request<{ id: string }>(`/api/v1/admin/analytics/alerts/rules/${ruleId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
      token,
    });
  }

  async deleteAlertRule(ruleId: string, token?: string) {
    return this.request<{ deleted: boolean }>(`/api/v1/admin/analytics/alerts/rules/${ruleId}`, {
      method: 'DELETE',
      token,
    });
  }

  async getAlerts(filters: { severity?: string; resolved?: boolean; limit?: number; offset?: number } = {}, token?: string) {
    const params = new URLSearchParams();
    if (filters.severity) params.set('severity', filters.severity);
    if (filters.resolved !== undefined) params.set('resolved', String(filters.resolved));
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.offset) params.set('offset', String(filters.offset));
    return this.request<{
      alerts: Array<{
        id: string;
        rule_id: string;
        rule_name: string;
        severity: string;
        message: string;
        current_value: number;
        threshold: number;
        triggered_at: string;
        acknowledged: number;
        acknowledged_by: string | null;
        acknowledged_at: string | null;
        resolved: number;
        resolved_at: string | null;
      }>;
      total: number;
      limit: number;
      offset: number;
    }>(`/api/v1/admin/analytics/alerts?${params}`, { token });
  }

  async acknowledgeAlert(alertId: string, token?: string) {
    return this.request<{ acknowledged: boolean }>(`/api/v1/admin/analytics/alerts/${alertId}/acknowledge`, {
      method: 'POST',
      token,
    });
  }

  async resolveAlert(alertId: string, token?: string) {
    return this.request<{ resolved: boolean }>(`/api/v1/admin/analytics/alerts/${alertId}/resolve`, {
      method: 'POST',
      token,
    });
  }

  async getTransactionAnalytics(period: '24h' | '7d' | '30d' | '90d' = '7d', token?: string) {
    return this.request<{
      period: string;
      startDate: string;
      endDate: string;
      results: Array<{
        date: string;
        type: string;
        status: string;
        count: number;
        total_tokens: number;
        total_cash: number;
        total_fees: number;
        avg_price: number;
      }>;
    }>(`/api/v1/admin/analytics/transactions?period=${period}`, { token });
  }

  async getUserAnalytics(period: '7d' | '30d' | '90d' | '365d' = '30d', token?: string) {
    return this.request<{
      period: string;
      totalUsers: number;
      newUsers: Array<{ date: string; count: number }>;
      byKycLevel: Array<{ kyc_level: string; kyc_status: string; count: number }>;
      byCountry: Array<{ country: string; count: number }>;
    }>(`/api/v1/admin/analytics/users?period=${period}`, { token });
  }

  // Proof of Reserve Report
  async getProofOfReserve(token?: string) {
    return this.request<{
      reportDate: string;
      reportType: string;
      version: string;
      goldStock: {
        totalAllocated: number;
        tokensIssued: number;
        availableStock: number;
        coverage: number;
        coveragePercent: string;
        isCovered: boolean;
      };
      tokenHolders: {
        totalHolders: number;
        totalTokensHeld: number;
        averageHolding: number;
        distribution: Array<{
          range: string;
          count: number;
          totalTokens: number;
        }>;
      };
      transactions: {
        last24h: { buys: number; sells: number; volume: number };
        last7d: { buys: number; sells: number; volume: number };
        last30d: { buys: number; sells: number; volume: number };
      };
      pricing: {
        currentPrice: number;
        priceSource: string;
        lastUpdate: string;
        buyPrice: number;
        sellPrice: number;
        spread: number;
      };
      audit: {
        lastAuditDate: string | null;
        lastAuditResult: string | null;
        nextScheduledAudit: string | null;
      };
      verification: {
        generatedBy: string;
        generatedAt: string;
        checksum: string;
      };
    }>('/api/v1/admin/reports/por', { token });
  }

  async setUserRole(userId: string, role: 'producer' | 'investor') {
    return this.request<{ id: string; role: string }>(`/api/v1/admin/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  }

  // ── Producer KYB ──
  async getProducerProfiles(status?: string, page = 1, limit = 20) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (status) params.set('status', status);
    return this.request<{ items: ProducerProfile[]; meta: { page: number; limit: number; total: number } }>(
      `/api/v1/admin/producers?${params}`
    );
  }

  async getProducerProfile(id: string) {
    return this.request<ProducerProfile>(`/api/v1/admin/producers/${id}`);
  }

  approveProducerProfile(id: string) {
    return this.request<ProducerProfile>(`/api/v1/admin/producers/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  rejectProducerProfile(id: string, reason: string) {
    return this.request<ProducerProfile>(`/api/v1/admin/producers/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  // ── Support : ce qui a échoué et ce qui est dû ──
  async getDispositions(status?: string, page = 1, limit = 50) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (status) params.set('status', status);
    return this.request<{
      items: AdminDisposition[];
      meta: { page: number; limit: number; total: number };
      /** Filtre réellement appliqué — une liste vide ne veut pas dire « rien à faire ». */
      filter: string;
    }>(`/api/v1/admin/dispositions?${params}`);
  }

  async getOutstandingStorageFees() {
    return this.request<{
      items: StorageFeeDebtor[];
      totalXof: number;
      notice: string;
    }>('/api/v1/admin/storage-fees/outstanding');
  }

  // ── Gold consignments (export workflow) ──
  async getConsignments(status?: string, page = 1, limit = 20) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (status) params.set('status', status);
    return this.request<{ items: Consignment[]; meta: { page: number; limit: number; total: number } }>(
      `/api/v1/admin/consignments?${params}`
    );
  }

  async getConsignment(id: string) {
    return this.request<{
      consignment: Consignment;
      events: ConsignmentEvent[];
      disposition: LotDisposition | null;
    }>(`/api/v1/admin/consignments/${id}`);
  }

  /** Fetch a consignment photo (authenticated) and return an object URL. */
  async fetchConsignmentPhoto(id: string, idx: number): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/v1/admin/consignments/${id}/photos/${idx}`, { credentials: 'include' });
    if (!res.ok) throw new Error('Photo introuvable');
    return URL.createObjectURL(await res.blob());
  }

  private consignmentAction(id: string, action: string, body?: Record<string, unknown>) {
    return this.request<Consignment>(`/api/v1/admin/consignments/${id}/${action}`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    });
  }

  forwarderValidateConsignment(id: string, note?: string) { return this.consignmentAction(id, 'forwarder-validate', { note }); }
  startConsignmentTransit(id: string, note?: string) { return this.consignmentAction(id, 'transit', { note }); }
  arriveConsignmentDubai(id: string, note?: string) { return this.consignmentAction(id, 'arrive-dubai', { note }); }
  rejectConsignment(id: string, reason: string) { return this.consignmentAction(id, 'reject', { reason }); }
  auditValidateConsignment(id: string, data: { refinedWeightG: number; refineryLot?: string; lbmaCertificate?: string }) {
    return this.consignmentAction(id, 'audit-validate', data);
  }
}

export interface ProducerProfile {
  id: string;
  user_id: string;
  entity_type: 'INDIVIDUAL' | 'COOPERATIVE' | 'COMPANY';
  legal_name: string;
  registration_number: string | null;
  mining_authorization: string | null;
  tax_id: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string;
  representative_name: string;
  representative_role: string | null;
  representative_phone: string | null;
  documents: string | null;
  status: 'SUBMITTED' | 'PROCESSING' | 'VERIFIED' | 'REJECTED';
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Consignment {
  id: string;
  reference: string;
  producer_id: string;
  weight_declared_g: number;
  purity_declared: number;
  gold_type: 'nuggets' | 'powder' | 'bar';
  origin_country: string | null;
  photos: string | null;
  estimated_value_xof: number | null;
  status: 'SUBMITTED' | 'FORWARDER_VALIDATED' | 'IN_TRANSIT' | 'ARRIVED_DUBAI' | 'AUDIT_VALIDATED' | 'REJECTED';
  forwarder_id: string | null;
  forwarder_validated_at: string | null;
  transit_started_at: string | null;
  arrived_dubai_at: string | null;
  refined_weight_g: number | null;
  producer_tokens_credited: number | null;
  refinery_lot: string | null;
  lbma_certificate: string | null;
  audited_by: string | null;
  audited_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConsignmentEvent {
  id: string;
  consignment_id: string;
  from_status: string | null;
  to_status: string;
  actor_id: string | null;
  actor_role: string | null;
  note: string | null;
  created_at: string;
}

export type DispositionStatus = 'PENDING' | 'EXECUTED' | 'PARTIAL' | 'FAILED';
export type DispositionLegStatus = 'NONE' | 'PENDING' | 'DONE' | 'FAILED';

export interface LotDisposition {
  id: string;
  consignment_id: string;
  user_id: string;
  total_g: number;
  sell_g: number;
  lease_g: number;
  store_g: number;
  status: DispositionStatus;
  sell_status: DispositionLegStatus;
  lease_status: DispositionLegStatus;
  sell_transaction_id: string | null;
  sell_proceeds_xof: number | null;
  lease_position_id: string | null;
  failure_reason: string | null;
  created_at: string;
  executed_at: string | null;
}

/** Une répartition, jointe à la référence du lot que le producteur citera. */
export interface AdminDisposition extends LotDisposition {
  reference: string | null;
  producer_id: string | null;
}

export interface StorageFeeDebtor {
  user_id: string;
  days_outstanding: number;
  total_xof: number;
  oldest: string;
  newest: string;
  /** Joint volontairement : un arriéré sur un compte approvisionné est un job en panne. */
  cash_balance: number | null;
  token_balance: number | null;
}

export const adminApi = new AdminApiClient(API_URL);
