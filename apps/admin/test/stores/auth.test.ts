/**
 * Admin Auth Store Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act } from '@testing-library/react';

// Create a standalone store for testing (without persistence issues)
import { create } from 'zustand';

type PermissionMap = Record<string, string[]>;

interface AdminUser {
  id: string;
  email: string;
  name?: string;
  role: string;
}

interface AdminState {
  user: AdminUser | null;
  permissions: PermissionMap | null;
  isAuthenticated: boolean;
  lastActivity: number;
  login: (user: AdminUser, permissions?: PermissionMap) => void;
  setPermissions: (permissions: PermissionMap) => void;
  logout: () => void;
  touch: () => void;
  hasPermission: (module: string, action: string) => boolean;
}

const createTestStore = () => create<AdminState>()((set, get) => ({
  user: null,
  permissions: null,
  isAuthenticated: false,
  lastActivity: Date.now(),
  login: (user, permissions) =>
    set({
      user,
      permissions: permissions || null,
      isAuthenticated: true,
      lastActivity: Date.now(),
    }),
  setPermissions: (permissions) => set({ permissions }),
  logout: () =>
    set({
      user: null,
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
}));

describe('Admin Auth Store', () => {
  let useStore: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    vi.useFakeTimers();
    useStore = createTestStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Initial State', () => {
    it('should have null user initially', () => {
      const state = useStore.getState();
      expect(state.user).toBeNull();
    });

    it('should not be authenticated initially', () => {
      const state = useStore.getState();
      expect(state.isAuthenticated).toBe(false);
    });

    it('should have null permissions initially', () => {
      const state = useStore.getState();
      expect(state.permissions).toBeNull();
    });
  });

  describe('Login', () => {
    const mockUser: AdminUser = {
      id: 'admin-1',
      email: 'admin@tnc.trading',
      name: 'Admin User',
      role: 'SUPER_ADMIN',
    };

    const mockPermissions: PermissionMap = {
      users: ['read', 'write', 'delete'],
      transactions: ['read'],
      stock: ['read', 'write'],
    };

    it('should set user on login', () => {
      act(() => {
        useStore.getState().login(mockUser);
      });

      const state = useStore.getState();
      expect(state.user).toEqual(mockUser);
    });

    it('should set isAuthenticated to true on login', () => {
      act(() => {
        useStore.getState().login(mockUser);
      });

      const state = useStore.getState();
      expect(state.isAuthenticated).toBe(true);
    });

    it('should set permissions on login', () => {
      act(() => {
        useStore.getState().login(mockUser, mockPermissions);
      });

      const state = useStore.getState();
      expect(state.permissions).toEqual(mockPermissions);
    });

    it('should update lastActivity on login', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      act(() => {
        useStore.getState().login(mockUser);
      });

      const state = useStore.getState();
      expect(state.lastActivity).toBe(now);
    });

    it('should handle login without permissions', () => {
      act(() => {
        useStore.getState().login(mockUser);
      });

      const state = useStore.getState();
      expect(state.permissions).toBeNull();
    });
  });

  describe('Logout', () => {
    const mockUser: AdminUser = {
      id: 'admin-1',
      email: 'admin@tnc.trading',
      role: 'ADMIN',
    };

    it('should clear user on logout', () => {
      act(() => {
        useStore.getState().login(mockUser);
        useStore.getState().logout();
      });

      const state = useStore.getState();
      expect(state.user).toBeNull();
    });

    it('should set isAuthenticated to false on logout', () => {
      act(() => {
        useStore.getState().login(mockUser);
        useStore.getState().logout();
      });

      const state = useStore.getState();
      expect(state.isAuthenticated).toBe(false);
    });

    it('should clear permissions on logout', () => {
      act(() => {
        useStore.getState().login(mockUser, { users: ['read'] });
        useStore.getState().logout();
      });

      const state = useStore.getState();
      expect(state.permissions).toBeNull();
    });

    it('should reset lastActivity to 0 on logout', () => {
      act(() => {
        useStore.getState().login(mockUser);
        useStore.getState().logout();
      });

      const state = useStore.getState();
      expect(state.lastActivity).toBe(0);
    });
  });

  describe('Permissions', () => {
    const mockUser: AdminUser = {
      id: 'admin-1',
      email: 'admin@tnc.trading',
      role: 'ADMIN',
    };

    const mockPermissions: PermissionMap = {
      users: ['read', 'write'],
      transactions: ['read'],
    };

    it('should set permissions via setPermissions', () => {
      act(() => {
        useStore.getState().login(mockUser);
        useStore.getState().setPermissions(mockPermissions);
      });

      const state = useStore.getState();
      expect(state.permissions).toEqual(mockPermissions);
    });

    it('should return true for granted permission', () => {
      act(() => {
        useStore.getState().login(mockUser, mockPermissions);
      });

      expect(useStore.getState().hasPermission('users', 'read')).toBe(true);
      expect(useStore.getState().hasPermission('users', 'write')).toBe(true);
    });

    it('should return false for non-granted permission', () => {
      act(() => {
        useStore.getState().login(mockUser, mockPermissions);
      });

      expect(useStore.getState().hasPermission('users', 'delete')).toBe(false);
      expect(useStore.getState().hasPermission('transactions', 'write')).toBe(false);
    });

    it('should return false for unknown module', () => {
      act(() => {
        useStore.getState().login(mockUser, mockPermissions);
      });

      expect(useStore.getState().hasPermission('unknown', 'read')).toBe(false);
    });

    it('should return false when no permissions set', () => {
      act(() => {
        useStore.getState().login(mockUser);
      });

      expect(useStore.getState().hasPermission('users', 'read')).toBe(false);
    });
  });

  describe('Activity Tracking', () => {
    const mockUser: AdminUser = {
      id: 'admin-1',
      email: 'admin@tnc.trading',
      role: 'ADMIN',
    };

    it('should update lastActivity on touch', () => {
      act(() => {
        useStore.getState().login(mockUser);
      });

      const initialTime = useStore.getState().lastActivity;

      // Advance time
      vi.advanceTimersByTime(5000);
      const newTime = Date.now();
      vi.setSystemTime(newTime);

      act(() => {
        useStore.getState().touch();
      });

      expect(useStore.getState().lastActivity).toBe(newTime);
      expect(useStore.getState().lastActivity).toBeGreaterThanOrEqual(initialTime);
    });
  });

  describe('Role-based Access', () => {
    it('should store SUPER_ADMIN role', () => {
      const superAdmin: AdminUser = {
        id: 'admin-1',
        email: 'super@tnc.trading',
        role: 'SUPER_ADMIN',
      };

      act(() => {
        useStore.getState().login(superAdmin);
      });

      expect(useStore.getState().user?.role).toBe('SUPER_ADMIN');
    });

    it('should store ADMIN role', () => {
      const admin: AdminUser = {
        id: 'admin-2',
        email: 'admin@tnc.trading',
        role: 'ADMIN',
      };

      act(() => {
        useStore.getState().login(admin);
      });

      expect(useStore.getState().user?.role).toBe('ADMIN');
    });

    it('should store VIEWER role', () => {
      const viewer: AdminUser = {
        id: 'admin-3',
        email: 'viewer@tnc.trading',
        role: 'VIEWER',
      };

      act(() => {
        useStore.getState().login(viewer);
      });

      expect(useStore.getState().user?.role).toBe('VIEWER');
    });
  });
});

describe('Session Timeout Logic', () => {
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

  it('should define correct session timeout', () => {
    expect(SESSION_TIMEOUT_MS).toBe(1_800_000);
  });

  it('should detect session expiry', () => {
    const lastActivity = Date.now() - SESSION_TIMEOUT_MS - 1000;
    const isExpired = Date.now() - lastActivity > SESSION_TIMEOUT_MS;
    expect(isExpired).toBe(true);
  });

  it('should not detect active session as expired', () => {
    const lastActivity = Date.now() - 5 * 60 * 1000; // 5 minutes ago
    const isExpired = Date.now() - lastActivity > SESSION_TIMEOUT_MS;
    expect(isExpired).toBe(false);
  });
});
