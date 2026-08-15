/**
 * Portal binding for privileged access tokens.
 *
 * The customer app, the admin back-office and the government portal all mint
 * their access tokens with the SAME `JWT_SECRET` and the same payload shape, and
 * both privileged middlewares used to identify the caller by `payload.email`
 * alone. Any access token whose email matched an active row in `admins` was
 * therefore accepted on `/admin/*` — including a token minted through the
 * ordinary customer login, which does not enforce the admin TOTP.
 *
 * Privileged tokens now carry the portal that issued them, and each middleware
 * only accepts its own.
 */

export type Portal = 'admin' | 'state';

/** Roles that belong to the admin back-office. */
export const ADMIN_PORTAL_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'KYC_REVIEWER',
  'FINANCE',
  'SUPPORT',
  'TRANSITAIRE',
  'DUBAI_VALIDATOR',
] as const;

/**
 * Roles that belong to the government portal.
 *
 * STATE_OPERATOR is deliberately absent from ADMIN_PORTAL_ROLES: the government
 * sees aggregates through `/state/*`, and must not reach the back-office where
 * the same read permissions would expose individual users and transactions.
 */
export const STATE_PORTAL_ROLES = ['STATE_OPERATOR'] as const;

/** Whether a verified token payload was minted by `expected`. */
export function isPortalToken(payload: { portal?: unknown } | null, expected: Portal): boolean {
  return !!payload && payload.portal === expected;
}

/** Whether this admin role may use the back-office. */
export function canAccessAdminPortal(role: string): boolean {
  return (ADMIN_PORTAL_ROLES as readonly string[]).includes(role);
}

/** Whether this admin role may use the government portal. */
export function canAccessStatePortal(role: string): boolean {
  return (STATE_PORTAL_ROLES as readonly string[]).includes(role);
}
