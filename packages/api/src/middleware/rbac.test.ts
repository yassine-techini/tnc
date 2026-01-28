import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { requirePermission } from './rbac';

// Minimal Env type for testing
type TestEnv = {
  Bindings: {
    DB: D1Database;
    [key: string]: unknown;
  };
};

function createMockDB(overrideResult: { granted: number } | null = null) {
  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(overrideResult),
      }),
    }),
  } as unknown as D1Database;
}

function createApp(db: D1Database) {
  const app = new Hono<TestEnv>();

  // Simulate auth middleware that sets adminId and adminRole
  app.use('*', async (c, next) => {
    const adminId = c.req.header('x-admin-id');
    const adminRole = c.req.header('x-admin-role');
    if (adminId) c.set('adminId' as never, adminId);
    if (adminRole) c.set('adminRole' as never, adminRole);
    // Bind DB
    (c.env as any) = { DB: db };
    await next();
  });

  // Protected route
  app.get('/test', requirePermission('users', 'view'), (c) => {
    return c.json({ success: true, data: 'ok' });
  });

  app.get('/admin-only', requirePermission('admins', 'create'), (c) => {
    return c.json({ success: true, data: 'admin' });
  });

  return app;
}

describe('requirePermission middleware', () => {
  it('returns 401 when adminId is not set', async () => {
    const db = createMockDB();
    const app = createApp(db);

    const res = await app.request('/test');
    expect(res.status).toBe(401);

    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
  });

  it('allows access when role default includes the permission', async () => {
    // SUPER_ADMIN has users:view by default, no override
    const db = createMockDB(null);
    const app = createApp(db);

    const res = await app.request('/test', {
      headers: {
        'x-admin-id': 'admin-1',
        'x-admin-role': 'SUPER_ADMIN',
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.data).toBe('ok');
  });

  it('denies access when role does not have the permission', async () => {
    // KYC_REVIEWER does not have admins:create
    const db = createMockDB(null);
    const app = createApp(db);

    const res = await app.request('/admin-only', {
      headers: {
        'x-admin-id': 'admin-1',
        'x-admin-role': 'KYC_REVIEWER',
      },
    });

    expect(res.status).toBe(403);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
  });

  it('allows access when override grants permission (granted=1)', async () => {
    // KYC_REVIEWER normally has no admins:create, but override grants it
    const db = createMockDB({ granted: 1 });
    const app = createApp(db);

    const res = await app.request('/admin-only', {
      headers: {
        'x-admin-id': 'admin-1',
        'x-admin-role': 'KYC_REVIEWER',
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.data).toBe('admin');
  });

  it('denies access when override revokes permission (granted=0)', async () => {
    // SUPER_ADMIN normally has users:view, but override revokes it
    const db = createMockDB({ granted: 0 });
    const app = createApp(db);

    const res = await app.request('/test', {
      headers: {
        'x-admin-id': 'admin-1',
        'x-admin-role': 'SUPER_ADMIN',
      },
    });

    expect(res.status).toBe(403);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
  });

  it('denies access for unknown role with no override', async () => {
    const db = createMockDB(null);
    const app = createApp(db);

    const res = await app.request('/test', {
      headers: {
        'x-admin-id': 'admin-1',
        'x-admin-role': 'NONEXISTENT',
      },
    });

    expect(res.status).toBe(403);
  });

  it('queries DB with correct parameters', async () => {
    const mockFirst = vi.fn().mockResolvedValue(null);
    const mockBind = vi.fn().mockReturnValue({ first: mockFirst });
    const mockPrepare = vi.fn().mockReturnValue({ bind: mockBind });
    const db = { prepare: mockPrepare } as unknown as D1Database;

    const app = createApp(db);

    await app.request('/test', {
      headers: {
        'x-admin-id': 'admin-42',
        'x-admin-role': 'ADMIN',
      },
    });

    expect(mockPrepare).toHaveBeenCalledWith(
      'SELECT granted FROM admin_permissions WHERE admin_id = ? AND module = ? AND action = ?',
    );
    expect(mockBind).toHaveBeenCalledWith('admin-42', 'users', 'view');
  });
});
