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

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

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
    const { isAuthenticated, logout } = useStateStore.getState();
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
