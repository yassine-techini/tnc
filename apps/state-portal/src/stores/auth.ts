import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { stateApi } from '../lib/api';

interface StateUser {
  id: string;
  email: string;
  ministry: string;
}

interface StateAuthState {
  user: StateUser | null;
  isAuthenticated: boolean;
  login: (user: StateUser) => void;
  logout: () => void;
}

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export const useStateStore = create<StateAuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      login: (user) =>
        set({
          user,
          isAuthenticated: true,
        }),
      logout: () =>
        set({
          user: null,
          isAuthenticated: false,
        }),
    }),
    {
      name: 'tnc-state-auth',
      // Only persist user info for UI state, NOT tokens (tokens are in httpOnly cookies)
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

// Set up API client auth error callback to trigger logout
stateApi.setAuthErrorCallback(() => {
  useStateStore.getState().logout();
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

export function touchActivity() {
  _lastActivity = Date.now();
}
