import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PermissionMap = Record<string, string[]>;

interface AdminUser {
  id: string;
  email: string;
  name?: string;
  role: string;
}

interface AdminTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface AdminState {
  user: AdminUser | null;
  tokens: AdminTokens | null;
  permissions: PermissionMap | null;
  isAuthenticated: boolean;
  lastActivity: number;
  login: (user: AdminUser, tokens: AdminTokens, permissions?: PermissionMap) => void;
  setPermissions: (permissions: PermissionMap) => void;
  logout: () => void;
  touch: () => void;
  hasPermission: (module: string, action: string) => boolean;
}

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export const useAdminStore = create<AdminState>()(
  persist(
    (set, get) => ({
      user: null,
      tokens: null,
      permissions: null,
      isAuthenticated: false,
      lastActivity: Date.now(),
      login: (user, tokens, permissions) =>
        set({
          user,
          tokens,
          permissions: permissions || null,
          isAuthenticated: true,
          lastActivity: Date.now(),
        }),
      setPermissions: (permissions) => set({ permissions }),
      logout: () =>
        set({
          user: null,
          tokens: null,
          permissions: null,
          isAuthenticated: false,
          lastActivity: 0,
        }),
      touch: () => set({ lastActivity: Date.now() }),
      hasPermission: (module: string, action: string) => {
        const perms = get().permissions;
        if (!perms) return false;
        return perms[module]?.includes(action) ?? false;
      },
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
