import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AdminUser {
  id: string;
  email: string;
  role: 'ADMIN' | 'SUPER_ADMIN';
}

interface AdminTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface AdminState {
  user: AdminUser | null;
  tokens: AdminTokens | null;
  isAuthenticated: boolean;
  login: (user: AdminUser, tokens: AdminTokens) => void;
  logout: () => void;
}

export const useAdminStore = create<AdminState>()(
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
      name: 'tnc-admin-auth',
    }
  )
);
