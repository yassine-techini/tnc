/**
 * TransactionSession Durable Object
 * Manages transaction state to prevent double-spending
 */

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
      default:
        return new Response('Not Found', { status: 404 });
    }
  }
  
  async lockTransaction(request: Request): Promise<Response> {
    const { userId, quoteId } = await request.json();
    const key = `lock:${userId}`;
    
    const existing = await this.state.storage.get(key);
    if (existing) {
      return new Response(JSON.stringify({ locked: false, reason: 'Transaction in progress' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    await this.state.storage.put(key, { quoteId, timestamp: Date.now() });
    
    // Auto-release after 2 minutes
    this.state.storage.setAlarm(Date.now() + 120000);
    
    return new Response(JSON.stringify({ locked: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  
  async releaseTransaction(request: Request): Promise<Response> {
    const { userId } = await request.json();
    await this.state.storage.delete(`lock:${userId}`);
    return new Response('OK');
  }
  
  async getStatus(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    const lock = await this.state.storage.get(`lock:${userId}`);
    return new Response(JSON.stringify({ locked: !!lock, details: lock }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  
  async alarm() {
    // Clean up expired locks
    const keys = await this.state.storage.list({ prefix: 'lock:' });
    const now = Date.now();
    
    for (const [key, value] of keys) {
      const lock = value as { timestamp: number };
      if (now - lock.timestamp > 120000) {
        await this.state.storage.delete(key);
      }
    }
  }
}
