/**
 * RBAC Middleware
 * Checks admin permissions before allowing route access.
 */

import type { Context, Next } from 'hono';
import type { Env } from '../types/env';
import { ROLE_DEFAULTS, type Module, type Action, MODULES, ACTIONS } from '../lib/rbac';

/**
 * Middleware factory that checks if the current admin has the required permission.
 * Override entries in admin_permissions take precedence over role defaults.
 */
export function requirePermission(module: Module, action: Action) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const adminId = c.get('adminId' as never) as string | undefined;
    const adminRole = c.get('adminRole' as never) as string | undefined;

    if (!adminId || !adminRole) {
      return c.json({ success: false, error: 'Non authentifié' }, 401);
    }

    // 1. Check for a per-admin override
    const override = await c.env.DB.prepare(
      'SELECT granted FROM admin_permissions WHERE admin_id = ? AND module = ? AND action = ?',
    )
      .bind(adminId, module, action)
      .first<{ granted: number }>();

    if (override) {
      if (!override.granted) {
        return c.json({ success: false, error: 'Permission refusée' }, 403);
      }
      return next();
    }

    // 2. Fall back to role defaults
    const defaults = ROLE_DEFAULTS[adminRole];
    if (!defaults || !defaults[module]?.includes(action)) {
      return c.json({ success: false, error: 'Permission refusée' }, 403);
    }

    return next();
  };
}
