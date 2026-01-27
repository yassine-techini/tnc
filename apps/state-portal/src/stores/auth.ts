import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface StateUser {
  id: string;
  email: string;
  ministry: string;
}

interface StateTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface StateAuthState {
  user: StateUser | null;
  tokens: StateTokens | null;
  isAuthenticated: boolean;
  login: (user: StateUser, tokens: StateTokens) => void;
  logout: () => void;
}

export const useStateStore = create<StateAuthState>()(
  persist(
    (set) => ({
      user: null,
      tokens: null,
      isAuthenticated: false,
      login: (user, tokens) =>
        set({
          user,
          tokens,
          isAuthenticated: true,
        }),
      logout: () =>
        set({
          user: null,
          tokens: null,
          isAuthenticated: false,
        }),
    }),
    {
      name: 'tnc-state-auth',
    }
  )
);
