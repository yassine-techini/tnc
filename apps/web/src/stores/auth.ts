import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, AuthTokens } from '@tnc-trading/shared';

interface AuthState {
  user: User | null;
  tokens: AuthTokens | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  _hasHydrated: boolean;

  // Actions
  setUser: (user: User) => void;
  setTokens: (tokens: AuthTokens) => void;
  login: (user: User, tokens: AuthTokens) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  updateUser: (updates: Partial<User>) => void;
  setHasHydrated: (hydrated: boolean) => void;
}

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      tokens: null,
      isAuthenticated: false,
      isLoading: true,
      _hasHydrated: false,

      setUser: (user) => set({ user }),

      setTokens: (tokens) => set({ tokens }),

      login: (user, tokens) => set({
        user,
        tokens,
        isAuthenticated: true,
        isLoading: false,
      }),

      logout: () => set({
        user: null,
        tokens: null,
        isAuthenticated: false,
        isLoading: false,
      }),

      setLoading: (isLoading) => set({ isLoading }),

      updateUser: (updates) => set((state) => ({
        user: state.user ? { ...state.user, ...updates } : null,
      })),

      setHasHydrated: (hydrated) => set({ _hasHydrated: hydrated, isLoading: false }),
    }),
    {
      name: 'tnc-auth-storage',
      partialize: (state) => ({
        tokens: state.tokens,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

// Inactivity monitor: auto-logout after 30 min idle
let _lastActivity = Date.now();
let _inactivityTimer: ReturnType<typeof setInterval> | null = null;

export function startInactivityMonitor() {
  if (_inactivityTimer) return;

  const touch = () => { _lastActivity = Date.now(); };
  ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach((event) =>
    document.addEventListener(event, touch, { passive: true })
  );

  _inactivityTimer = setInterval(() => {
    const { isAuthenticated, logout } = useAuthStore.getState();
    if (isAuthenticated && Date.now() - _lastActivity > SESSION_TIMEOUT_MS) {
      logout();
      window.location.href = '/login?reason=timeout';
    }
  }, 60_000);
}

export function stopInactivityMonitor() {
  if (_inactivityTimer) {
    clearInterval(_inactivityTimer);
    _inactivityTimer = null;
  }
}
