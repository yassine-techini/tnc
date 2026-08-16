import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';
import { registerForPush, unregisterForPush } from '../lib/push-registration';

interface User {
  id: string;
  email: string;
  phone: string;
  country: string;
  kycLevel: 'BASIC' | 'STANDARD' | 'VERIFIED';
  kycStatus: 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  emailVerified: boolean;
  phoneVerified: boolean;
  twoFactorEnabled: boolean;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface AuthState {
  user: User | null;
  tokens: Tokens | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  tokenExpiresAt: number | null;
  lastActivityAt: number | null;
  loginAt: number | null;
  login: (user: User, tokens: Tokens) => void;
  logout: () => void;
  setUser: (user: User) => void;
  setTokens: (tokens: Tokens) => void;
  setLoading: (loading: boolean) => void;
  updateActivity: () => void;
  isTokenExpired: () => boolean;
}

// Session timeout: 30 minutes in milliseconds
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

// Custom storage for Zustand using Expo SecureStore
const secureStorage = {
  getItem: async (name: string) => {
    try {
      return await SecureStore.getItemAsync(name);
    } catch {
      return null;
    }
  },
  setItem: async (name: string, value: string) => {
    try {
      await SecureStore.setItemAsync(name, value);
    } catch {
      // Fallback silently
    }
  },
  removeItem: async (name: string) => {
    try {
      await SecureStore.deleteItemAsync(name);
    } catch {
      // Fallback silently
    }
  },
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      tokens: null,
      isAuthenticated: false,
      isLoading: true,
      tokenExpiresAt: null,
      lastActivityAt: null,
      loginAt: null,
      login: (user, tokens) => {
        const now = Date.now();
        const tokenExpiresAt = now + tokens.expiresIn * 1000;

        set({
          user,
          tokens,
          isAuthenticated: true,
          isLoading: false,
          tokenExpiresAt,
          lastActivityAt: now,
          loginAt: now,
        });

        // Best-effort and deliberately not awaited: a device that cannot
        // register for push must still be able to log in.
        void registerForPush();
      },
      logout: () => {
        // Fire before clearing the session — the call needs the access token,
        // and the next user of this device must not inherit these notifications.
        void unregisterForPush();

        set({
          user: null,
          tokens: null,
          isAuthenticated: false,
          isLoading: false,
          tokenExpiresAt: null,
          lastActivityAt: null,
          loginAt: null,
        });
      },
      setUser: (user) => set({ user }),
      setTokens: (tokens) => {
        const now = Date.now();
        const tokenExpiresAt = now + tokens.expiresIn * 1000;

        set({
          tokens,
          tokenExpiresAt,
          lastActivityAt: now,
        });
      },
      setLoading: (isLoading) => set({ isLoading }),
      updateActivity: () => {
        set({ lastActivityAt: Date.now() });
      },
      isTokenExpired: () => {
        const state = get();

        // No token expiry set means no valid session
        if (!state.tokenExpiresAt) {
          return true;
        }

        // Check if token has expired
        return Date.now() >= state.tokenExpiresAt;
      },
    }),
    {
      name: 'tnc-mobile-auth',
      storage: createJSONStorage(() => secureStorage),
      onRehydrateStorage: () => (state) => {
        if (!state) {
          return;
        }

        const now = Date.now();

        // Check if token has expired
        if (state.tokenExpiresAt && now >= state.tokenExpiresAt) {
          // Token expired - force logout
          state.logout();
          return;
        }

        // Check if session has timed out (30 minutes of inactivity)
        if (state.lastActivityAt && now - state.lastActivityAt > SESSION_TIMEOUT_MS) {
          // Session timeout - force logout
          state.logout();
          return;
        }

        // Update activity timestamp on successful rehydration
        if (state.isAuthenticated) {
          state.updateActivity();
        }

        // Mark loading as complete
        state.setLoading(false);
      },
    }
  )
);
