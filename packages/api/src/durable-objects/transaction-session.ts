/**
 * TransactionSession Durable Object
 * Provides strong consistency guarantees for financial transactions:
 * - Prevents concurrent transactions for the same user
 * - Ensures exactly-once execution via lock acquisition
 * - Auto-releases locks after timeout to prevent deadlocks
 */

interface LockData {
  quoteId: string;
  transactionType: 'BUY' | 'SELL' | 'WITHDRAWAL';
  tokenAmount: number;
  timestamp: number;
  requestId: string;
}

const LOCK_TIMEOUT_MS = 120000; // 2 minutes

export class TransactionSession {
  state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    switch (url.pathname) {
      case '/lock':
        return this.lockTransaction(request);
      case '/release':
        return this.releaseTransaction(request);
      case '/status':
        return this.getStatus(request);
      case '/execute':
        return this.executeWithLock(request);
      default:
        return new Response('Not Found', { status: 404 });
    }
  }

  /**
   * Acquire a lock for a user's transaction.
   * Only one transaction per user can be in progress at a time.
   */
  async lockTransaction(request: Request): Promise<Response> {
    const body = await request.json() as {
      userId: string;
      quoteId: string;
      transactionType: 'BUY' | 'SELL' | 'WITHDRAWAL';
      tokenAmount: number;
      requestId: string;
    };

    const key = `lock:${body.userId}`;

    // Check for existing lock
    const existing = await this.state.storage.get<LockData>(key);
    if (existing) {
      const age = Date.now() - existing.timestamp;
      if (age < LOCK_TIMEOUT_MS) {
        // Lock is still valid - reject concurrent request
        return new Response(JSON.stringify({
          locked: false,
          reason: 'TRANSACTION_IN_PROGRESS',
          message: 'Une transaction est déjà en cours. Veuillez attendre.',
          existingQuoteId: existing.quoteId,
          ageSeconds: Math.floor(age / 1000),
        }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Lock expired - clean it up and allow new lock
      await this.state.storage.delete(key);
    }

    // Acquire the lock
    const lockData: LockData = {
      quoteId: body.quoteId,
      transactionType: body.transactionType,
      tokenAmount: body.tokenAmount,
      timestamp: Date.now(),
      requestId: body.requestId,
    };

    await this.state.storage.put(key, lockData);

    // Set alarm to auto-release after timeout
    await this.state.storage.setAlarm(Date.now() + LOCK_TIMEOUT_MS);

    return new Response(JSON.stringify({ locked: true, lockId: body.requestId }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Release a lock after transaction completion (success or failure).
   * Only the owner (matching requestId) can release the lock.
   */
  async releaseTransaction(request: Request): Promise<Response> {
    const { userId, requestId } = await request.json() as { userId: string; requestId: string };
    const key = `lock:${userId}`;

    const existing = await this.state.storage.get<LockData>(key);
    if (!existing) {
      return new Response(JSON.stringify({ released: true, reason: 'NO_LOCK' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Only the lock owner can release
    if (existing.requestId !== requestId) {
      return new Response(JSON.stringify({
        released: false,
        reason: 'NOT_OWNER',
        message: 'Lock owned by different request',
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await this.state.storage.delete(key);

    return new Response(JSON.stringify({ released: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Check lock status for a user.
   */
  async getStatus(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    if (!userId) {
      return new Response(JSON.stringify({ error: 'userId required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const lock = await this.state.storage.get<LockData>(`lock:${userId}`);

    if (!lock) {
      return new Response(JSON.stringify({ locked: false }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const age = Date.now() - lock.timestamp;
    const expired = age >= LOCK_TIMEOUT_MS;

    return new Response(JSON.stringify({
      locked: !expired,
      expired,
      details: {
        quoteId: lock.quoteId,
        transactionType: lock.transactionType,
        tokenAmount: lock.tokenAmount,
        ageSeconds: Math.floor(age / 1000),
      },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Execute a transaction with lock verification.
   * This provides an additional safety check that the caller holds the lock.
   */
  async executeWithLock(request: Request): Promise<Response> {
    const { userId, requestId, action } = await request.json() as {
      userId: string;
      requestId: string;
      action: 'VERIFY' | 'COMPLETE';
    };

    const key = `lock:${userId}`;
    const lock = await this.state.storage.get<LockData>(key);

    if (!lock) {
      return new Response(JSON.stringify({
        success: false,
        error: 'NO_LOCK',
        message: 'Transaction lock not held',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (lock.requestId !== requestId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'LOCK_MISMATCH',
        message: 'Request ID does not match lock',
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const age = Date.now() - lock.timestamp;
    if (age >= LOCK_TIMEOUT_MS) {
      await this.state.storage.delete(key);
      return new Response(JSON.stringify({
        success: false,
        error: 'LOCK_EXPIRED',
        message: 'Transaction lock has expired',
      }), {
        status: 408,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'COMPLETE') {
      // Release the lock after successful completion
      await this.state.storage.delete(key);
    }

    return new Response(JSON.stringify({
      success: true,
      lockValid: true,
      quoteId: lock.quoteId,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Alarm handler - clean up expired locks.
   */
  async alarm() {
    const keys = await this.state.storage.list<LockData>({ prefix: 'lock:' });
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [key, value] of keys) {
      if (now - value.timestamp >= LOCK_TIMEOUT_MS) {
        toDelete.push(key);
        console.log(`[TransactionSession] Auto-releasing expired lock: ${key}`);
      }
    }

    if (toDelete.length > 0) {
      await this.state.storage.delete(toDelete);
    }

    // Check if there are remaining locks that need future cleanup
    const remaining = await this.state.storage.list({ prefix: 'lock:' });
    if (remaining.size > 0) {
      // Set next alarm
      await this.state.storage.setAlarm(Date.now() + LOCK_TIMEOUT_MS);
    }
  }
}
