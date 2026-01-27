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
  lastActivity: number;
  login: (user: AdminUser, tokens: AdminTokens) => void;
  logout: () => void;
  touch: () => void;
}

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export const useAdminStore = create<AdminState>()(
  persist(
    (set) => ({
      user: null,
      tokens: null,
      isAuthenticated: false,
      lastActivity: Date.now(),
      login: (user, tokens) =>
        set({
          user,
          tokens,
          isAuthenticated: true,
          lastActivity: Date.now(),
        }),
      logout: () =>
        set({
          user: null,
          tokens: null,
          isAuthenticated: false,
          lastActivity: 0,
        }),
      touch: () => set({ lastActivity: Date.now() }),
    }),
    {
      name: 'tnc-admin-auth',
    }
  )
);

// Inactivity monitor: auto-logout after 30 min idle
let _inactivityTimer: ReturnType<typeof setInterval> | null = null;

export function startInactivityMonitor() {
  if (_inactivityTimer) return;

  // Track user activity
  const touch = () => useAdminStore.getState().touch();
  ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach((event) =>
    document.addEventListener(event, touch, { passive: true })
  );

  // Check every 60s
  _inactivityTimer = setInterval(() => {
    const { isAuthenticated, lastActivity, logout } = useAdminStore.getState();
    if (isAuthenticated && Date.now() - lastActivity > SESSION_TIMEOUT_MS) {
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
