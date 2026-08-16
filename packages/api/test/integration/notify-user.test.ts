/**
 * In-app notifications against the real schema.
 *
 * The two previous writers inserted into a `message` column that does not exist
 * (the table has `body`), so every notification silently wrote nothing. These
 * tests run the real SQL against the real constraints, which is the only way
 * that class of bug shows up.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { NotificationService } from '../../src/services/notification.service';
import { createTestD1, type TestD1 } from '../helpers/real-d1';

const asD1 = (db: TestD1) => db as unknown as D1Database;
const USER = 'user-1';

function stored(db: TestD1): Array<{ user_id: string; type: string; title: string; body: string; data: string | null; read: number }> {
  return db.sqlite.prepare('SELECT user_id, type, title, body, data, read FROM notifications').all() as never;
}

describe('notifyUser (real schema)', () => {
  let db: TestD1;
  let svc: NotificationService;

  beforeEach(() => {
    db = createTestD1();
    db.sqlite.prepare("INSERT INTO users (id, email) VALUES (?, 'u@example.bf')").run(USER);
    // No FCM configuration: push is unavailable, which must not stop the record
    // from being written.
    svc = new NotificationService(asD1(db), {});
  });

  it('writes a row that the app can actually read back', async () => {
    const id = await svc.notifyUser({
      userId: USER,
      type: 'TRANSACTION',
      title: 'Lot validé et payé',
      body: 'Votre lot CONS-AB12CD34 a été validé.',
      data: { consignmentReference: 'CONS-AB12CD34', creditedGrams: '810' },
    });

    expect(id).toBeTruthy();
    const rows = stored(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: USER,
      type: 'TRANSACTION',
      title: 'Lot validé et payé',
      read: 0,
    });
    expect(JSON.parse(rows[0].data!)).toEqual({ consignmentReference: 'CONS-AB12CD34', creditedGrams: '810' });
  });

  it('stores no data column when there is none', async () => {
    await svc.notifyUser({ userId: USER, type: 'KYC', title: 'Dossier validé', body: 'Vous pouvez consigner.' });
    expect(stored(db)[0].data).toBeNull();
  });

  it('records the notification even though push is not configured', async () => {
    // An unreachable device must never lose the durable in-app record.
    await expect(
      svc.notifyUser({ userId: USER, type: 'SYSTEM', title: 'T', body: 'B' })
    ).resolves.toBeTruthy();
    expect(stored(db)).toHaveLength(1);
  });

  it('refuses a type outside the CHECK constraint instead of writing junk', async () => {
    await expect(
      svc.notifyUser({ userId: USER, type: 'EMAIL' as never, title: 'T', body: 'B' })
    ).rejects.toThrow();
    expect(stored(db)).toHaveLength(0);
  });
});
