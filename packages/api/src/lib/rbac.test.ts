import { describe, it, expect, vi } from 'vitest';
import {
  MODULES,
  ACTIONS,
  ROLE_DEFAULTS,
  resolvePermissions,
  hasPermission,
  type PermissionMap,
  type Module,
  type Action,
} from './rbac';

// ─── Constants ─────────────────────────────────────────

describe('RBAC constants', () => {
  it('defines 10 modules', () => {
    expect(MODULES).toHaveLength(10);
    expect(MODULES).toContain('dashboard');
    expect(MODULES).toContain('admins');
    expect(MODULES).toContain('integrations');
    expect(MODULES).toContain('audit');
  });

  it('defines 7 actions', () => {
    expect(ACTIONS).toHaveLength(7);
    expect(ACTIONS).toContain('view');
    expect(ACTIONS).toContain('approve');
    expect(ACTIONS).toContain('export');
  });

  it('defines 5 roles', () => {
    const roles = Object.keys(ROLE_DEFAULTS);
    expect(roles).toHaveLength(5);
    expect(roles).toEqual(expect.arrayContaining([
      'SUPER_ADMIN', 'ADMIN', 'KYC_REVIEWER', 'FINANCE', 'SUPPORT',
    ]));
  });

  it('every role covers all modules', () => {
    for (const [role, perms] of Object.entries(ROLE_DEFAULTS)) {
      for (const mod of MODULES) {
        expect(perms).toHaveProperty(mod, expect.any(Array));
      }
    }
  });

  it('SUPER_ADMIN has full admin management', () => {
    const sa = ROLE_DEFAULTS.SUPER_ADMIN;
    expect(sa.admins).toEqual(expect.arrayContaining(['view', 'create', 'update', 'delete']));
  });

  it('KYC_REVIEWER can only access dashboard, users, kyc', () => {
    const kycReviewer = ROLE_DEFAULTS.KYC_REVIEWER;
    expect(kycReviewer.dashboard).toContain('view');
    expect(kycReviewer.users).toContain('view');
    expect(kycReviewer.kyc).toEqual(expect.arrayContaining(['view', 'approve', 'reject']));
    // Should not have access to stock, withdrawals, etc.
    expect(kycReviewer.stock).toHaveLength(0);
    expect(kycReviewer.withdrawals).toHaveLength(0);
    expect(kycReviewer.admins).toHaveLength(0);
  });

  it('FINANCE has withdrawal approval but no KYC', () => {
    const finance = ROLE_DEFAULTS.FINANCE;
    expect(finance.withdrawals).toContain('approve');
    expect(finance.kyc).toHaveLength(0);
  });

  it('ADMIN has no admin management', () => {
    expect(ROLE_DEFAULTS.ADMIN.admins).toHaveLength(0);
  });
});

// ─── hasPermission ─────────────────────────────────────

describe('hasPermission', () => {
  const perms: PermissionMap = {
    dashboard: ['view'],
    users: ['view', 'update'],
    kyc: [],
    transactions: ['view', 'export'],
    stock: [],
    withdrawals: [],
    reconciliation: [],
    integrations: [],
    audit: [],
    admins: [],
  };

  it('returns true when action is in the module list', () => {
    expect(hasPermission(perms, 'dashboard', 'view')).toBe(true);
    expect(hasPermission(perms, 'users', 'update')).toBe(true);
    expect(hasPermission(perms, 'transactions', 'export')).toBe(true);
  });

  it('returns false when action is not in the module list', () => {
    expect(hasPermission(perms, 'dashboard', 'delete')).toBe(false);
    expect(hasPermission(perms, 'kyc', 'view')).toBe(false);
    expect(hasPermission(perms, 'admins', 'create')).toBe(false);
  });

  it('returns false for empty module actions', () => {
    expect(hasPermission(perms, 'stock', 'view')).toBe(false);
  });
});

// ─── resolvePermissions ────────────────────────────────

function createMockDb(overrides: Array<{ module: string; action: string; granted: number }> = []) {
  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({ results: overrides }),
      }),
    }),
  } as unknown as D1Database;
}

describe('resolvePermissions', () => {
  it('returns role defaults when no overrides exist', async () => {
    const db = createMockDb([]);
    const perms = await resolvePermissions(db, 'admin-1', 'SUPER_ADMIN');

    expect(perms.dashboard).toContain('view');
    expect(perms.admins).toEqual(expect.arrayContaining(['view', 'create', 'update', 'delete']));
  });

  it('returns empty permissions for unknown role with no overrides', async () => {
    const db = createMockDb([]);
    const perms = await resolvePermissions(db, 'admin-1', 'UNKNOWN_ROLE');

    for (const mod of MODULES) {
      expect(perms[mod]).toHaveLength(0);
    }
  });

  it('grants additional permission via override (granted=1)', async () => {
    const db = createMockDb([
      { module: 'admins', action: 'view', granted: 1 },
      { module: 'admins', action: 'create', granted: 1 },
    ]);

    // KYC_REVIEWER normally has no admin access
    const perms = await resolvePermissions(db, 'admin-1', 'KYC_REVIEWER');

    expect(perms.admins).toContain('view');
    expect(perms.admins).toContain('create');
  });

  it('revokes a default permission via override (granted=0)', async () => {
    const db = createMockDb([
      { module: 'kyc', action: 'approve', granted: 0 },
    ]);

    // ADMIN normally has kyc:approve
    const perms = await resolvePermissions(db, 'admin-1', 'ADMIN');

    expect(perms.kyc).not.toContain('approve');
    // Other kyc permissions should still be there
    expect(perms.kyc).toContain('view');
    expect(perms.kyc).toContain('reject');
  });

  it('does not duplicate already-granted permissions', async () => {
    const db = createMockDb([
      { module: 'dashboard', action: 'view', granted: 1 },
    ]);

    // SUPER_ADMIN already has dashboard:view
    const perms = await resolvePermissions(db, 'admin-1', 'SUPER_ADMIN');

    const viewCount = perms.dashboard.filter((a) => a === 'view').length;
    expect(viewCount).toBe(1);
  });

  it('ignores invalid module/action in overrides', async () => {
    const db = createMockDb([
      { module: 'nonexistent', action: 'view', granted: 1 },
      { module: 'dashboard', action: 'fly', granted: 1 },
    ]);

    const perms = await resolvePermissions(db, 'admin-1', 'ADMIN');

    // Should still work normally
    expect(perms.dashboard).toContain('view');
    expect(perms).not.toHaveProperty('nonexistent');
  });

  it('handles multiple overrides for different modules', async () => {
    const db = createMockDb([
      { module: 'stock', action: 'update', granted: 1 },
      { module: 'withdrawals', action: 'approve', granted: 0 },
      { module: 'audit', action: 'export', granted: 1 },
    ]);

    // ADMIN: stock=[view], withdrawals=[view,approve,reject], audit=[view]
    const perms = await resolvePermissions(db, 'admin-1', 'ADMIN');

    expect(perms.stock).toContain('update'); // added
    expect(perms.withdrawals).not.toContain('approve'); // revoked
    expect(perms.withdrawals).toContain('view'); // unchanged
    expect(perms.audit).toContain('export'); // added
    expect(perms.audit).toContain('view'); // unchanged
  });

  it('clones defaults and does not mutate ROLE_DEFAULTS', async () => {
    const db = createMockDb([
      { module: 'kyc', action: 'approve', granted: 0 },
    ]);

    // Capture original
    const originalKycPerms = [...ROLE_DEFAULTS.ADMIN.kyc];

    await resolvePermissions(db, 'admin-1', 'ADMIN');

    // ROLE_DEFAULTS should be unchanged
    expect(ROLE_DEFAULTS.ADMIN.kyc).toEqual(originalKycPerms);
  });
});
