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
