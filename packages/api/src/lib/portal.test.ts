import { describe, it, expect } from 'vitest';
import {
  isPortalToken,
  canAccessAdminPortal,
  canAccessStatePortal,
  ADMIN_PORTAL_ROLES,
  STATE_PORTAL_ROLES,
} from './portal';
import { ROLE_DEFAULTS } from './rbac';

describe('isPortalToken', () => {
  it('accepts a token minted by the expected portal', () => {
    expect(isPortalToken({ portal: 'admin' }, 'admin')).toBe(true);
    expect(isPortalToken({ portal: 'state' }, 'state')).toBe(true);
  });

  it('rejects a token from the other portal', () => {
    expect(isPortalToken({ portal: 'state' }, 'admin')).toBe(false);
    expect(isPortalToken({ portal: 'admin' }, 'state')).toBe(false);
  });

  it('rejects a customer token, which carries no portal claim', () => {
    // This is the escalation that was open: a token from the ordinary customer
    // login whose email matched an active admin row reached /admin/*.
    expect(isPortalToken({}, 'admin')).toBe(false);
    expect(isPortalToken({ portal: undefined }, 'admin')).toBe(false);
    expect(isPortalToken(null, 'admin')).toBe(false);
  });

  it('rejects a forged or unexpected portal value', () => {
    expect(isPortalToken({ portal: 'ADMIN' }, 'admin')).toBe(false);
    expect(isPortalToken({ portal: 1 }, 'admin')).toBe(false);
    expect(isPortalToken({ portal: true }, 'admin')).toBe(false);
  });
});

describe('portal membership', () => {
  it('keeps the government operator out of the back-office', () => {
    expect(canAccessAdminPortal('STATE_OPERATOR')).toBe(false);
    expect(canAccessStatePortal('STATE_OPERATOR')).toBe(true);
  });

  it('lets the consignment roles into the back-office', () => {
    expect(canAccessAdminPortal('TRANSITAIRE')).toBe(true);
    expect(canAccessAdminPortal('DUBAI_VALIDATOR')).toBe(true);
  });

  it('keeps back-office roles out of the government portal', () => {
    for (const role of ADMIN_PORTAL_ROLES) {
      expect(canAccessStatePortal(role)).toBe(false);
    }
  });

  it('rejects an unknown role on both portals', () => {
    expect(canAccessAdminPortal('WHATEVER')).toBe(false);
    expect(canAccessStatePortal('WHATEVER')).toBe(false);
  });

  it('assigns every RBAC role to exactly one portal', () => {
    // Guards against the failure mode that left TRANSITAIRE unassignable: a role
    // added to ROLE_DEFAULTS but forgotten in the access boundaries.
    const assigned = [...ADMIN_PORTAL_ROLES, ...STATE_PORTAL_ROLES];
    expect([...assigned].sort()).toEqual(Object.keys(ROLE_DEFAULTS).sort());
    expect(new Set(assigned).size).toBe(assigned.length);
  });
});
