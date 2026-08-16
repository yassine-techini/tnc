/**
 * Device push tokens against a real SQLite engine.
 *
 * Two behaviours matter beyond the happy path: a token belongs to exactly one
 * installation (so nobody gets doubled notifications, and a re-used device stops
 * notifying its former owner), and only a PERMANENT provider rejection may
 * deactivate a device — unsubscribing someone because of a quota blip would be
 * silent and hard to notice.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PushTokenService, isTokenPermanentlyInvalid } from '../../src/services/push-token.service';
import { createTestD1, type TestD1 } from '../helpers/real-d1';

const asD1 = (db: TestD1) => db as unknown as D1Database;
const ALICE = 'user-alice';
const BOB = 'user-bob';
const TOKEN = 'fcm-token-abcdefghij';

function rows(db: TestD1): Array<{ user_id: string; token: string; active: number }> {
  return db.sqlite.prepare('SELECT user_id, token, active FROM push_tokens').all() as Array<{
    user_id: string;
    token: string;
    active: number;
  }>;
}

describe('PushTokenService (real D1)', () => {
  let db: TestD1;
  let svc: PushTokenService;

  beforeEach(() => {
    db = createTestD1();
    svc = new PushTokenService(asD1(db));
  });

  it('registers a device and lists it', async () => {
    await svc.register({ userId: ALICE, token: TOKEN, platform: 'android', deviceId: 'pixel-1' });
    const active = await svc.listActive(ALICE);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ token: TOKEN, platform: 'android', device_id: 'pixel-1', active: 1 });
  });

  it('registering twice keeps one row, so notifications are not doubled', async () => {
    await svc.register({ userId: ALICE, token: TOKEN, platform: 'android' });
    await svc.register({ userId: ALICE, token: TOKEN, platform: 'android' });
    expect(rows(db)).toHaveLength(1);
    expect(await svc.listActive(ALICE)).toHaveLength(1);
  });

  it('moves a token to the new user when a device changes hands', async () => {
    await svc.register({ userId: ALICE, token: TOKEN, platform: 'android' });
    await svc.register({ userId: BOB, token: TOKEN, platform: 'android' });

    // The installation now belongs to Bob — Alice must stop receiving it.
    expect(rows(db)).toHaveLength(1);
    expect(await svc.listActive(ALICE)).toHaveLength(0);
    expect(await svc.listActive(BOB)).toHaveLength(1);
  });

  it('deactivates a token and reactivates it on re-registration', async () => {
    await svc.register({ userId: ALICE, token: TOKEN, platform: 'ios' });
    expect(await svc.deactivate(TOKEN)).toBe(true);
    expect(await svc.listActive(ALICE)).toHaveLength(0);
    // Deactivating twice is a no-op, not an error.
    expect(await svc.deactivate(TOKEN)).toBe(false);

    // A reinstall reusing the token comes back to life.
    await svc.register({ userId: ALICE, token: TOKEN, platform: 'ios' });
    expect(await svc.listActive(ALICE)).toHaveLength(1);
  });

  it('logout only silences the caller own device', async () => {
    await svc.register({ userId: ALICE, token: TOKEN, platform: 'web' });
    // Bob cannot silence Alice's device by guessing her token.
    expect(await svc.deactivateForUser(BOB, TOKEN)).toBe(false);
    expect(await svc.listActive(ALICE)).toHaveLength(1);

    expect(await svc.deactivateForUser(ALICE, TOKEN)).toBe(true);
    expect(await svc.listActive(ALICE)).toHaveLength(0);
  });

  it('keeps a user several devices apart', async () => {
    await svc.register({ userId: ALICE, token: 'token-phone-aaaa', platform: 'android' });
    await svc.register({ userId: ALICE, token: 'token-tablet-bbb', platform: 'ios' });
    expect(await svc.listActive(ALICE)).toHaveLength(2);

    await svc.deactivate('token-phone-aaaa');
    expect(await svc.listActive(ALICE)).toHaveLength(1);
  });
});

describe('isTokenPermanentlyInvalid', () => {
  it('treats an unregistered device as gone', () => {
    expect(isTokenPermanentlyInvalid(404, '{"error":{"status":"NOT_FOUND"}}')).toBe(true);
  });

  it('treats a malformed token as gone', () => {
    expect(
      isTokenPermanentlyInvalid(400, '{"error":{"status":"INVALID_ARGUMENT","message":"Invalid registration token"}}')
    ).toBe(true);
  });

  it('does NOT unsubscribe a device on a transient failure', () => {
    // These are the ones that would silently empty the table if mishandled.
    expect(isTokenPermanentlyInvalid(429, 'QUOTA_EXCEEDED')).toBe(false);
    expect(isTokenPermanentlyInvalid(500, 'INTERNAL')).toBe(false);
    expect(isTokenPermanentlyInvalid(503, 'UNAVAILABLE')).toBe(false);
    expect(isTokenPermanentlyInvalid(401, 'UNAUTHENTICATED')).toBe(false);
    // A 400 that is not about the token — a malformed payload, say.
    expect(isTokenPermanentlyInvalid(400, '{"error":{"status":"INVALID_ARGUMENT","message":"Invalid JSON payload"}}')).toBe(false);
  });
});
