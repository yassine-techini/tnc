/**
 * RBAC - Role-Based Access Control
 * Predefined roles with default permissions + per-admin overrides via DB
 */

export const MODULES = [
  'dashboard', 'users', 'kyc', 'transactions', 'stock',
  'withdrawals', 'reconciliation', 'integrations', 'audit', 'admins',
  'analytics', 'logs', 'alerts', 'consignments',
] as const;

export const ACTIONS = [
  'view', 'create', 'update', 'delete', 'approve', 'reject', 'export',
] as const;

export type Module = typeof MODULES[number];
export type Action = typeof ACTIONS[number];

export type PermissionMap = Record<Module, Action[]>;

/**
 * Default permissions per role.
 * These apply unless overridden by admin_permissions table entries.
 */
export const ROLE_DEFAULTS: Record<string, PermissionMap> = {
  SUPER_ADMIN: {
    dashboard: ['view'],
    users: ['view', 'update', 'delete', 'export'],
    kyc: ['view', 'approve', 'reject', 'export'],
    transactions: ['view', 'export'],
    stock: ['view', 'update'],
    withdrawals: ['view', 'approve', 'reject', 'export'],
    reconciliation: ['view', 'update', 'export'],
    integrations: ['view', 'update'],
    audit: ['view', 'export'],
    admins: ['view', 'create', 'update', 'delete'],
    analytics: ['view', 'export'],
    logs: ['view', 'export'],
    alerts: ['view', 'create', 'update', 'delete'],
    consignments: ['view', 'update', 'approve', 'reject', 'export'],
  },
  ADMIN: {
    dashboard: ['view'],
    users: ['view', 'update', 'export'],
    kyc: ['view', 'approve', 'reject', 'export'],
    transactions: ['view', 'export'],
    stock: ['view'],
    withdrawals: ['view', 'approve', 'reject'],
    reconciliation: ['view', 'export'],
    integrations: ['view'],
    audit: ['view'],
    admins: [],
    analytics: ['view'],
    logs: ['view'],
    alerts: ['view', 'update'],
    consignments: ['view', 'update', 'approve', 'reject', 'export'],
  },
  KYC_REVIEWER: {
    dashboard: ['view'],
    users: ['view'],
    kyc: ['view', 'approve', 'reject'],
    transactions: [],
    stock: [],
    withdrawals: [],
    reconciliation: [],
    integrations: [],
    audit: [],
    admins: [],
    analytics: [],
    logs: [],
    alerts: [],
    consignments: [],
  },
  FINANCE: {
    dashboard: ['view'],
    users: ['view'],
    kyc: [],
    transactions: ['view', 'export'],
    stock: ['view', 'update'],
    withdrawals: ['view', 'approve', 'reject', 'export'],
    reconciliation: ['view', 'update', 'export'],
    integrations: [],
    audit: ['view'],
    admins: [],
    analytics: ['view'],
    logs: [],
    alerts: ['view'],
    consignments: ['view', 'export'],
  },
  SUPPORT: {
    dashboard: ['view'],
    users: ['view', 'update'],
    kyc: ['view'],
    transactions: ['view'],
    stock: [],
    withdrawals: ['view'],
    reconciliation: [],
    integrations: [],
    audit: [],
    admins: [],
    analytics: [],
    logs: [],
    alerts: ['view'],
    consignments: ['view'],
  },
  STATE_OPERATOR: {
    // Read-only access for government monitoring
    dashboard: ['view'],
    users: ['view'], // Can view aggregate user stats
    kyc: [], // No access to individual KYC documents
    transactions: ['view', 'export'], // Can view and export transaction reports
    stock: ['view'], // Can view gold stock levels
    withdrawals: ['view'], // Can view withdrawal stats
    reconciliation: ['view'], // Can view reconciliation reports
    integrations: [], // No access to integrations
    audit: ['view'], // Can view audit logs
    admins: [], // No access to admin management
    analytics: ['view', 'export'], // Full analytics access
    logs: ['view'], // Can view system logs
    alerts: ['view'], // Can view alerts
    consignments: ['view', 'export'], // Government oversight of gold sourcing
  },
  // Freight forwarder: validates the operation and drives transport status.
  TRANSITAIRE: {
    dashboard: ['view'],
    users: [],
    kyc: [],
    transactions: [],
    stock: [],
    withdrawals: [],
    reconciliation: [],
    integrations: [],
    audit: [],
    admins: [],
    analytics: [],
    logs: [],
    alerts: [],
    consignments: ['view', 'update'],
  },
  // Dubai-side auditor: runs the final audit validation that allocates stock.
  DUBAI_VALIDATOR: {
    dashboard: ['view'],
    users: [],
    kyc: [],
    transactions: [],
    stock: ['view'],
    withdrawals: [],
    reconciliation: [],
    integrations: [],
    audit: ['view'],
    admins: [],
    analytics: [],
    logs: [],
    alerts: [],
    consignments: ['view', 'approve', 'reject'],
  },
};

/**
 * Resolve effective permissions for an admin:
 * 1. Start with role defaults
 * 2. Apply overrides from admin_permissions table
 */
export async function resolvePermissions(
  db: D1Database,
  adminId: string,
  role: string,
): Promise<PermissionMap> {
  // Start with role defaults (clone to avoid mutation)
  const defaults = ROLE_DEFAULTS[role];
  const result: PermissionMap = {} as PermissionMap;
  for (const mod of MODULES) {
    result[mod] = defaults ? [...(defaults[mod] || [])] : [];
  }

  // Apply overrides
  const overrides = await db
    .prepare('SELECT module, action, granted FROM admin_permissions WHERE admin_id = ?')
    .bind(adminId)
    .all<{ module: string; action: string; granted: number }>();

  if (overrides.results) {
    for (const row of overrides.results) {
      const mod = row.module as Module;
      const act = row.action as Action;
      if (!MODULES.includes(mod) || !ACTIONS.includes(act)) continue;

      if (row.granted === 1 && !result[mod].includes(act)) {
        result[mod].push(act);
      } else if (row.granted === 0) {
        result[mod] = result[mod].filter((a) => a !== act);
      }
    }
  }

  return result;
}

/**
 * Check a single permission against a resolved map
 */
export function hasPermission(permissions: PermissionMap, module: Module, action: Action): boolean {
  return permissions[module]?.includes(action) ?? false;
}
