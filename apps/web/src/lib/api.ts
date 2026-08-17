/**
 * API Client for TNC Trading
 */

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8787' : '');
import type {
  KycStatusData,
  NotificationPreferencesData,
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
  TradeExecutionData,
} from '@tnc-trading/shared/contracts';
// Contrats partagés avec l'API (packages/shared/src/contracts).
// Côté route, `satisfies` vérifie la même forme : les deux ne peuvent
// plus diverger en silence.
import type {
  MarketStockData,
  WalletData,
} from '@tnc-trading/shared/contracts';
import type { TwoFactorSetupData } from '@tnc-trading/shared/contracts';

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

    // For backward compatibility, still support explicit token (e.g., for mobile)
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...fetchOptions,
        headers,
        credentials: 'include', // Send httpOnly cookies
      });
    } catch (error) {
      // Retry on network errors (max 2 retries with exponential backoff)
      if (!_isRetry && error instanceof TypeError) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          response = await fetch(`${this.baseUrl}${endpoint}`, {
            ...fetchOptions,
            headers,
            credentials: 'include',
          });
        } catch {
          await new Promise((r) => setTimeout(r, 2000));
          response = await fetch(`${this.baseUrl}${endpoint}`, {
            ...fetchOptions,
            headers,
            credentials: 'include',
          });
        }
      } else {
        throw error;
      }
    }

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

  // Auth
  async register(email: string, phone: string, password: string, country = 'BF', firstName?: string, lastName?: string) {
    return this.request<{ message: string; userId: string }>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, phone, password, country, firstName, lastName }),
    });
  }

  async login(identifier: string, password: string, totpCode?: string) {
    const response = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // Allow server to set httpOnly cookies
      body: JSON.stringify({ identifier, password, totpCode }),
    });

    const data = await response.json();

    // Handle 2FA setup required
    if (data.error?.code === 'AUTH_2FA_SETUP_REQUIRED') {
      return {
        success: false as const,
        requires2FASetup: true,
        setupToken: data.data?.setupToken,
        error: data.error,
      };
    }

    // Handle 2FA code required
    if (data.error?.code === 'AUTH_2FA_REQUIRED') {
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
      },
    };
  }

  // 2FA Setup - get secret and QR code (using setup token)
  async setup2FA(setupToken: string) {
    return this.request<{
      secret: string;
      uri: string;
      issuer: string;
      message: string;
    }>('/api/v1/auth/2fa/setup-init', {
      method: 'POST',
      body: JSON.stringify({ setupToken }),
    });
  }

  // 2FA Complete - verify code and complete setup
  async complete2FASetup(setupToken: string, code: string) {
    return this.request<{
      message: string;
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
    }>('/api/v1/auth/2fa/setup-complete', {
      method: 'POST',
      body: JSON.stringify({ setupToken, code }),
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

  async logout(token?: string) {
    return this.request<{ message: string }>('/api/v1/auth/logout', {
      method: 'POST',
      token, // Optional for backward compatibility with mobile
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

  async verifyPasswordlessCode(identifier: string, code: string, totpCode?: string) {
    const response = await fetch(`${this.baseUrl}/api/v1/auth/passwordless/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // Allow server to set httpOnly cookies
      body: JSON.stringify({ identifier, code, totpCode }),
    });

    const data = await response.json();

    // Handle 2FA required
    if (data.error?.code === 'AUTH_2FA_REQUIRED') {
      return {
        success: false as const,
        requires2FA: true,
        error: data.error,
      };
    }

    if (!data.success) {
      throw new Error(data.error?.message || 'Code invalide');
    }

    return {
      success: true as const,
      data: data.data as {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
        user: {
          id: string;
          email: string;
          phone: string;
          country: string;
          kycLevel: string;
          kycStatus: string;
          emailVerified: boolean;
          phoneVerified: boolean;
          twoFactorEnabled: boolean;
        };
        sessionId: string;
      },
    };
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
    return this.request<MarketStockData>('/api/v1/market/stock');
  }

  async getQuote(type: 'BUY' | 'SELL', amount: number, amountType: 'grams' | 'xof', token?: string) {
    return this.request<QuoteData>('/api/v1/market/quote', {
      method: 'POST',
      body: JSON.stringify({ type, amount, amountType }),
      token,
    });
  }

  async executeBuy(quoteId: string, paymentMethod: string, token?: string) {
    return this.request<TradeExecutionData>('/api/v1/market/buy', {
      method: 'POST',
      body: JSON.stringify({ quoteId, paymentMethod }),
      token,
    });
  }

  async executeSell(quoteId: string, paymentMethod: string, token?: string) {
    return this.request<TradeExecutionData>('/api/v1/market/sell', {
      method: 'POST',
      body: JSON.stringify({ quoteId, paymentMethod }),
      token,
    });
  }

  // Wallet
  async getWallet(token?: string) {
    return this.request<WalletData>('/api/v1/wallet', { token });
  }

  async getTransactions(page = 1, limit = 20, token?: string) {
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

  async deposit(amount: number, paymentMethod: string, phoneNumber: string, token?: string) {
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

  async withdraw(amount: number, paymentMethod: string, phoneNumber: string, token?: string) {
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
  async getProfile(token?: string) {
    return this.request<UserProfileData>('/api/v1/users/me', { token });
  }

  // ── Producer consignments (export workflow) ──
  async submitConsignment(data: {
    weightGrams: number;
    purity: number;
    goldType: 'nuggets' | 'powder' | 'bar';
    originCountry?: string;
    gps?: { lat: number; lng: number };
    photos?: string[];
    estimatedValueXof?: number;
  }) {
    return this.request<ProducerConsignment>('/api/v1/producer/consignments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getMyConsignments(page = 1, limit = 20) {
    return this.request<{ items: ProducerConsignment[]; meta: { page: number; limit: number; total: number } }>(
      `/api/v1/producer/consignments?page=${page}&limit=${limit}`
    );
  }

  async getMyConsignment(id: string) {
    return this.request<{ consignment: ProducerConsignment; events: ProducerConsignmentEvent[] }>(
      `/api/v1/producer/consignments/${id}`
    );
  }

  async uploadConsignmentPhoto(file: File): Promise<{ key: string }> {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${this.baseUrl}/api/v1/producer/consignments/photos`, {
      method: 'POST', body: fd, credentials: 'include',
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error?.message || 'Échec de l\'envoi de la photo');
    return data.data as { key: string };
  }

  /** Fetch a consignment photo (authenticated) and return an object URL. */
  async fetchConsignmentPhoto(id: string, idx: number): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/v1/producer/consignments/${id}/photos/${idx}`, { credentials: 'include' });
    if (!res.ok) throw new Error('Photo introuvable');
    return URL.createObjectURL(await res.blob());
  }

  // ── Répartition d'un lot (raffineur) ──
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

  // ── Gold lease (location d'or) ──
  async getLeaseTerms() {
    return this.request<LeaseTermsData>('/api/v1/lease/terms');
  }

  async getLeasePositions() {
    return this.request<LeasePositionsData>('/api/v1/lease/positions');
  }

  async getLeaseAccruals(positionId: string) {
    return this.request<LeaseAccrualsData>(`/api/v1/lease/positions/${positionId}/accruals`);
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

  // ── Public reserve attestations (no auth — ADR 002 phase 1) ──
  async getReserveAttestations(page = 1, limit = 20) {
    return this.request<{
      items: Array<{
        sequence: number;
        digest: string;
        previousDigest: string | null;
        anchorChain: string | null;
        anchorTxHash: string | null;
        anchoredAt: string | null;
        createdAt: string;
      }>;
      meta: { page: number; limit: number; total: number };
    }>(`/api/v1/public/reserve/attestations?page=${page}&limit=${limit}`);
  }

  async getReserveAttestation(digest: string) {
    return this.request<ReserveAttestation>(`/api/v1/public/reserve/attestations/${digest}`);
  }

  async getReserveAttestationLatest() {
    return this.request<ReserveAttestation>('/api/v1/public/reserve/attestations/latest');
  }

  async getReserveVerificationKey() {
    return this.request<{ alg: string; jwk: JsonWebKey }>('/api/v1/public/reserve/key');
  }

  // ── Producer KYB (the entity behind the account) ──
  async getProducerProfile() {
    return this.request<ProducerProfile>('/api/v1/producer/profile');
  }

  async submitProducerProfile(data: {
    entityType: 'INDIVIDUAL' | 'COOPERATIVE' | 'COMPANY';
    legalName: string;
    registrationNumber?: string;
    miningAuthorization?: string;
    taxId?: string;
    address?: string;
    city?: string;
    region?: string;
    representativeName: string;
    representativeRole?: string;
    representativePhone?: string;
    documents?: string[];
  }) {
    return this.request<ProducerProfile>('/api/v1/producer/profile', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async uploadProducerDocument(file: File): Promise<{ key: string }> {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${this.baseUrl}/api/v1/producer/profile/documents`, {
      method: 'POST', body: fd, credentials: 'include',
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error?.message || 'Échec de l\'envoi du document');
    return data.data as { key: string };
  }

  async updateProfile(data: { phone?: string; country?: string }, token?: string) {
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
  async sendPhoneVerification(phone: string, authToken?: string) {
    return this.request<{ message: string }>('/api/v1/auth/verify-phone/send', {
      method: 'POST',
      body: JSON.stringify({ phone }),
      token: authToken,
    });
  }

  async verifyPhone(code: string, authToken?: string) {
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

  async changePassword(currentPassword: string, newPassword: string, authToken?: string) {
    return this.request<{ message: string }>('/api/v1/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
      token: authToken,
    });
  }

  // 2FA (from profile settings)
  async setup2FAProfile(authToken?: string) {
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
      token: authToken,
    });
  }

  async verify2FA(code: string, authToken?: string) {
    return this.request<{
      message: string;
      backupCodes: string[];
    }>('/api/v1/auth/2fa/verify', {
      method: 'POST',
      body: JSON.stringify({ code }),
      token: authToken,
    });
  }

  async disable2FA(code: string, authToken?: string) {
    return this.request<{ message: string }>('/api/v1/auth/2fa/disable', {
      method: 'POST',
      body: JSON.stringify({ code }),
      token: authToken,
    });
  }

  // Sessions
  async getSessions(authToken?: string) {
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

  async revokeSession(sessionId: string, authToken?: string) {
    return this.request<{ message: string }>(`/api/v1/auth/sessions/${sessionId}`, {
      method: 'DELETE',
      token: authToken,
    });
  }

  async revokeAllSessions(authToken?: string) {
    return this.request<{ message: string }>('/api/v1/auth/sessions', {
      method: 'DELETE',
      token: authToken,
    });
  }

  // KYC
  async getKycStatus(authToken?: string) {
    return this.request<KycStatusData>('/api/v1/users/me/kyc/status', { token: authToken });
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
    authToken?: string
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

  async uploadKycDocument(file: File, authToken?: string) {
    const formData = new FormData();
    formData.append('file', file);

    const headers: Record<string, string> = {};
    // For backward compatibility with mobile, still support explicit token
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(`${this.baseUrl}/api/v1/users/me/kyc/documents`, {
      method: 'POST',
      headers,
      credentials: 'include', // Send httpOnly cookies
      body: formData,
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error?.message || 'Erreur lors du téléchargement');
    }

    return data as ApiResponse<{ url: string; documentId: string }>;
  }

  // Notification Preferences
  async getNotificationPreferences(authToken?: string) {
    return this.request<NotificationPreferencesData>('/api/v1/users/me/preferences/notifications', { token: authToken });
  }

  async updateNotificationPreferences(
    preferences: {
      email?: boolean;
      sms?: boolean;
      priceAlerts?: boolean;
      transactionAlerts?: boolean;
      marketingEmails?: boolean;
    },
    authToken?: string
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
  async getPriceAlerts(includeTriggered = false, authToken?: string) {
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
    authToken?: string
  ) {
    return this.request<PriceAlertsData>('/api/v1/users/me/price-alerts', {
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
    authToken?: string
  ) {
    return this.request<{ id: string; message: string }>(`/api/v1/users/me/price-alerts/${alertId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
      token: authToken,
    });
  }

  async deletePriceAlert(alertId: string, authToken?: string) {
    return this.request<{ message: string }>(`/api/v1/users/me/price-alerts/${alertId}`, {
      method: 'DELETE',
      token: authToken,
    });
  }

  // Certificate
  async generateCertificate(authToken?: string) {
    // These are exactly the fields the route returns. The previous declaration
    // promised expiresAt / currentPriceXof / estimatedValueXof / generatedAt,
    // none of which the API sends — so the UI rendered NaN and "Invalid Date"
    // while TypeScript reported no problem.
    return this.request<{
      certificateId: string;
      verificationCode: string;
      downloadUrl: string;
      viewUrl: string;
      userName: string;
      tokenBalance: number;
      /** Grams in an open lease: owned, lent out, not in the wallet. */
      leasedBalance: number;
      totalOwnedGrams: number;
      issuedAt: string;
    }>('/api/v1/wallet/certificate', { token: authToken });
  }

  // Account deletion
  async deleteAccount(password: string, authToken?: string) {
    return this.request<{ message: string }>('/api/v1/users/me', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
      token: authToken,
    });
  }
}

export type ConsignmentStatus =
  | 'SUBMITTED' | 'FORWARDER_VALIDATED' | 'IN_TRANSIT' | 'ARRIVED_DUBAI' | 'AUDIT_VALIDATED' | 'REJECTED';

export interface ProducerConsignment {
  id: string;
  reference: string;
  weight_declared_g: number;
  purity_declared: number;
  gold_type: 'nuggets' | 'powder' | 'bar';
  origin_country: string | null;
  photos: string | null;
  estimated_value_xof: number | null;
  status: ConsignmentStatus;
  refined_weight_g: number | null;
  producer_tokens_credited: number | null;
  refinery_lot: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProducerConsignmentEvent {
  id: string;
  from_status: string | null;
  to_status: string;
  actor_role: string | null;
  note: string | null;
  created_at: string;
}

export interface ReserveAttestation {
  sequence: number;
  digest: string;
  previousDigest: string | null;
  payload: string;
  signature: string | null;
  signingKeyId: string | null;
  anchorChain: string | null;
  anchorTxHash: string | null;
  anchoredAt: string | null;
  anchorUrl: string | null;
  createdAt: string;
  verification?: {
    digestMatches: boolean;
    chainLinkValid: boolean;
    signatureValid: boolean;
    anchored: boolean;
  };
}

export type KybStatus = 'SUBMITTED' | 'PROCESSING' | 'VERIFIED' | 'REJECTED';

export interface ProducerProfile {
  id: string;
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
  status: KybStatus;
  rejection_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeaseTerms {
  annualRate: number;
  annualRatePercent: number;
  exitSettlementBusinessDays: number;
  minimumGrams: number;
  /** The plain-language warning the API returns; displayed verbatim, never paraphrased. */
  disclosure: string;
}

export type LeasePositionStatus = 'ACTIVE' | 'EXITING' | 'CLOSED';

export interface LeasePosition {
  id: string;
  principalG: number;
  annualRate: number;
  /** Yield accrued so far, in XOF. The principal stays in grams — two units, never mixed. */
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
  sell_transaction_id: string | null;
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
  /** Avertissement de l'API sur la facturation de la garde — affiché tel quel. */
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

export const api = new ApiClient(API_URL);
export default api;
