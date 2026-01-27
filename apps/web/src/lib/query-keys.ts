/**
 * Centralized query keys and stale time configuration.
 * StaleTime varies by data volatility.
 */

export const queryKeys = {
  price: ['market', 'price'] as const,
  priceHistory: (period: string) => ['market', 'price', 'history', period] as const,
  stock: ['market', 'stock'] as const,
  wallet: ['wallet'] as const,
  transactions: (page: number, type?: string, status?: string) =>
    ['wallet', 'transactions', { page, type, status }] as const,
  profile: ['user', 'profile'] as const,
  kycStatus: ['user', 'kyc'] as const,
  sessions: ['auth', 'sessions'] as const,
  notifications: ['user', 'notifications'] as const,
  priceAlerts: ['user', 'priceAlerts'] as const,
};

export const staleTimes = {
  price: 30 * 1000,           // 30s - prices change frequently
  priceHistory: 2 * 60 * 1000, // 2min
  stock: 2 * 60 * 1000,       // 2min
  wallet: 2 * 60 * 1000,      // 2min
  transactions: 5 * 60 * 1000, // 5min
  profile: 10 * 60 * 1000,    // 10min
  kyc: 30 * 60 * 1000,        // 30min
  sessions: 5 * 60 * 1000,    // 5min
  notifications: 60 * 1000,   // 1min
  priceAlerts: 5 * 60 * 1000, // 5min
};
