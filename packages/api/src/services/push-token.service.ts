/**
 * Device push tokens.
 *
 * `push_tokens` has existed since the initial schema but nothing ever wrote to
 * it: the platform could not have notified anyone even once FCM was repaired.
 *
 * A token identifies an app installation, not a person. Re-registering a token
 * therefore MOVES it to the current user rather than adding a row — otherwise a
 * shared or resold device keeps notifying whoever logged in first.
 */

export type Platform = 'ios' | 'android' | 'web';

export interface PushTokenRow {
  id: string;
  user_id: string;
  token: string;
  platform: Platform;
  device_id: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export class PushTokenService {
  constructor(private db: D1Database) {}

  /**
   * Register (or move) a device token for a user. Idempotent: registering the
   * same token again refreshes it and reactivates it after a prune.
   */
  async register(p: {
    userId: string;
    token: string;
    platform: Platform;
    deviceId?: string | null;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO push_tokens (id, user_id, token, platform, device_id, active)
         VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT(token) DO UPDATE SET
           user_id = excluded.user_id,
           platform = excluded.platform,
           device_id = excluded.device_id,
           active = 1,
           updated_at = datetime('now')`
      )
      .bind(crypto.randomUUID(), p.userId, p.token, p.platform, p.deviceId ?? null)
      .run();
  }

  /** Active tokens for a user — the fan-out list for one notification. */
  async listActive(userId: string): Promise<PushTokenRow[]> {
    const rows = await this.db
      .prepare('SELECT * FROM push_tokens WHERE user_id = ? AND active = 1 ORDER BY updated_at DESC')
      .bind(userId)
      .all<PushTokenRow>();
    return rows.results || [];
  }

  /**
   * Deactivate a token the provider rejected as unknown. Kept rather than
   * deleted so a reinstall reusing the token can reactivate it, and so the row
   * still shows the device existed.
   */
  async deactivate(token: string): Promise<boolean> {
    const res = await this.db
      .prepare("UPDATE push_tokens SET active = 0, updated_at = datetime('now') WHERE token = ? AND active = 1")
      .bind(token)
      .run();
    return res.meta.changes > 0;
  }

  /** Called on logout: this installation should stop receiving notifications. */
  async deactivateForUser(userId: string, token: string): Promise<boolean> {
    const res = await this.db
      .prepare(
        "UPDATE push_tokens SET active = 0, updated_at = datetime('now') WHERE user_id = ? AND token = ? AND active = 1"
      )
      .bind(userId, token)
      .run();
    return res.meta.changes > 0;
  }
}

/**
 * Whether an FCM HTTP v1 error means the token is gone for good.
 *
 * Only these justify deactivating: a transient failure (quota, 5xx) must not
 * silently unsubscribe a device that is perfectly fine.
 */
export function isTokenPermanentlyInvalid(status: number, body: string): boolean {
  if (status === 404) return true; // UNREGISTERED
  if (status !== 400) return false;
  return /INVALID_ARGUMENT/.test(body) && /token/i.test(body);
}
