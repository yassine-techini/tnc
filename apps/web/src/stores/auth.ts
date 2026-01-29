import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@tnc-trading/shared';
import api from '../lib/api';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  _hasHydrated: boolean;

  // Actions
  setUser: (user: User) => void;
  login: (user: User) => void;
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
      isAuthenticated: false,
      isLoading: true,
      _hasHydrated: false,

      setUser: (user) => set({ user }),

      login: (user) => set({
        user,
        isAuthenticated: true,
        isLoading: false,
      }),

      logout: () => set({
        user: null,
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
      // Only persist user info for UI state, NOT tokens (tokens are in httpOnly cookies)
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

// Set up API client auth error callback to trigger logout
api.setAuthErrorCallback(() => {
  useAuthStore.getState().logout();
  window.location.href = '/login?reason=session_expired';
});

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
      // Call logout endpoint to clear cookies server-side
      api.logout().catch(() => {});
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
