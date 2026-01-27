/**
 * PriceTracker Durable Object
 * Manages real-time gold price updates with WebSocket support
 *
 * Features:
 * - Automatic price refresh via alarms (every 5 minutes)
 * - WebSocket connections for real-time price updates
 * - Price history management (24h retention)
 * - Price alert subscriptions
 * - Health monitoring
 */

interface PriceData {
  priceUsd: number;
  priceXof: number;
  buyPrice: number;
  sellPrice: number;
  exchangeRate: number;
  source: string;
  timestamp: string;
}

interface PriceAlert {
  userId: string;
  targetPrice: number;
  direction: 'above' | 'below';
  createdAt: string;
  triggered?: boolean;
}

interface HealthStatus {
  lastUpdate: string | null;
  updateCount: number;
  wsConnections: number;
  alertsCount: number;
  status: 'healthy' | 'stale' | 'error';
}

// Price refresh interval: 5 minutes
const REFRESH_INTERVAL = 5 * 60 * 1000;

// History retention: 24 hours
const HISTORY_RETENTION = 24 * 60 * 60 * 1000;

// Price staleness threshold: 10 minutes
const STALE_THRESHOLD = 10 * 60 * 1000;

export class PriceTracker implements DurableObject {
  state: DurableObjectState;
  env: unknown;
  sessions: Map<WebSocket, { userId?: string }>;

  constructor(state: DurableObjectState, env: unknown) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();

    // Restore sessions from hibernation
    this.state.getWebSockets().forEach((ws) => {
      const meta = ws.deserializeAttachment();
      this.sessions.set(ws, meta || {});
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle WebSocket upgrades
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }

    switch (url.pathname) {
      case '/price':
        return this.getCurrentPrice();
      case '/update':
        return this.updatePrice(request);
      case '/history':
        return this.getPriceHistory(request);
      case '/alerts':
        return this.handleAlerts(request);
      case '/health':
        return this.getHealth();
      case '/start':
        return this.startAutoRefresh();
      case '/stop':
        return this.stopAutoRefresh();
      default:
        return new Response('Not Found', { status: 404 });
    }
  }

  /**
   * Handle WebSocket connection for real-time updates
   */
  async handleWebSocket(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket with hibernation support
    this.state.acceptWebSocket(server);

    // Extract userId from query params if present
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');

    const meta = { userId: userId || undefined };
    server.serializeAttachment(meta);
    this.sessions.set(server, meta);

    // Send current price immediately
    const currentPrice = await this.state.storage.get<PriceData>('currentPrice');
    if (currentPrice) {
      server.send(JSON.stringify({
        type: 'price',
        data: currentPrice,
      }));
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  /**
   * Handle WebSocket messages
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const data = JSON.parse(message.toString());

      switch (data.type) {
        case 'subscribe':
          // Subscribe to price alerts
          if (data.userId && data.targetPrice && data.direction) {
            await this.addAlert({
              userId: data.userId,
              targetPrice: data.targetPrice,
              direction: data.direction,
              createdAt: new Date().toISOString(),
            });
            ws.send(JSON.stringify({ type: 'subscribed', success: true }));
          }
          break;

        case 'unsubscribe':
          if (data.userId) {
            await this.removeAlert(data.userId);
            ws.send(JSON.stringify({ type: 'unsubscribed', success: true }));
          }
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;
      }
    } catch (error) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  }

  /**
   * Handle WebSocket close
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    this.sessions.delete(ws);
  }

  /**
   * Handle WebSocket error
   */
  async webSocketError(ws: WebSocket, error: unknown) {
    console.error('WebSocket error:', error);
    this.sessions.delete(ws);
  }

  /**
   * Get current price
   */
  async getCurrentPrice(): Promise<Response> {
    const price = await this.state.storage.get<PriceData>('currentPrice');
    return new Response(JSON.stringify(price || null), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Update price and broadcast to all connected clients
   */
  async updatePrice(request: Request): Promise<Response> {
    try {
      const price = await request.json() as PriceData;

      // Store current price
      await this.state.storage.put('currentPrice', price);

      // Store in history
      const historyKey = `history:${Date.now()}`;
      await this.state.storage.put(historyKey, price);

      // Update metrics
      const updateCount = await this.state.storage.get<number>('updateCount') || 0;
      await this.state.storage.put('updateCount', updateCount + 1);
      await this.state.storage.put('lastUpdate', new Date().toISOString());

      // Broadcast to all WebSocket connections
      this.broadcast({
        type: 'price',
        data: price,
      });

      // Check and trigger alerts
      await this.checkAlerts(price);

      // Clean up old history
      await this.cleanupHistory();

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Price update error:', error);
      return new Response(JSON.stringify({ success: false, error: 'Update failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  /**
   * Get price history
   */
  async getPriceHistory(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const period = url.searchParams.get('period') || '1h';

    // Calculate time range
    const now = Date.now();
    let fromTime: number;
    switch (period) {
      case '1h':
        fromTime = now - 60 * 60 * 1000;
        break;
      case '24h':
        fromTime = now - 24 * 60 * 60 * 1000;
        break;
      case '7d':
        fromTime = now - 7 * 24 * 60 * 60 * 1000;
        break;
      default:
        fromTime = now - 60 * 60 * 1000;
    }

    // Get history entries
    const entries = await this.state.storage.list<PriceData>({
      prefix: 'history:',
    });

    const history: PriceData[] = [];
    for (const [key, value] of entries) {
      const timestamp = parseInt(key.replace('history:', ''));
      if (timestamp >= fromTime) {
        history.push(value);
      }
    }

    // Sort by timestamp
    history.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    return new Response(JSON.stringify({ history, period }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Handle price alerts (per-user key storage: alert:{userId})
   */
  async handleAlerts(request: Request): Promise<Response> {
    if (request.method === 'GET') {
      const alerts = await this.getAllAlerts();
      return new Response(JSON.stringify({ alerts }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'POST') {
      const alert = await request.json() as PriceAlert;
      await this.addAlert(alert);
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'DELETE') {
      const { userId } = await request.json();
      await this.removeAlert(userId);
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Method not allowed', { status: 405 });
  }

  /**
   * Get all alerts (reads per-user keys)
   */
  async getAllAlerts(): Promise<PriceAlert[]> {
    const entries = await this.state.storage.list<PriceAlert>({ prefix: 'alert:' });
    return Array.from(entries.values());
  }

  /**
   * Add a price alert (per-user key)
   */
  async addAlert(alert: PriceAlert): Promise<void> {
    await this.state.storage.put(`alert:${alert.userId}`, alert);
  }

  /**
   * Remove a price alert (per-user key)
   */
  async removeAlert(userId: string): Promise<void> {
    await this.state.storage.delete(`alert:${userId}`);
  }

  /**
   * Check and trigger alerts
   */
  async checkAlerts(price: PriceData): Promise<void> {
    const entries = await this.state.storage.list<PriceAlert>({ prefix: 'alert:' });
    const toUpdate: [string, PriceAlert][] = [];

    for (const [key, alert] of entries) {
      if (alert.triggered) continue;

      const shouldTrigger =
        (alert.direction === 'above' && price.priceXof >= alert.targetPrice) ||
        (alert.direction === 'below' && price.priceXof <= alert.targetPrice);

      if (shouldTrigger) {
        alert.triggered = true;
        toUpdate.push([key, alert]);

        // Notify the user via their WebSocket if connected
        for (const [ws, meta] of this.sessions) {
          if (meta.userId === alert.userId) {
            ws.send(JSON.stringify({
              type: 'alert',
              data: {
                targetPrice: alert.targetPrice,
                currentPrice: price.priceXof,
                direction: alert.direction,
                message: alert.direction === 'above'
                  ? `Le prix de l'or a atteint ${price.priceXof} XOF/g (objectif: ${alert.targetPrice} XOF)`
                  : `Le prix de l'or est descendu à ${price.priceXof} XOF/g (objectif: ${alert.targetPrice} XOF)`,
              },
            }));
          }
        }
      }
    }

    // Batch-update triggered alerts
    if (toUpdate.length > 0) {
      await this.state.storage.put(Object.fromEntries(toUpdate));
    }
  }

  /**
   * Get health status
   */
  async getHealth(): Promise<Response> {
    const lastUpdate = await this.state.storage.get<string>('lastUpdate');
    const updateCount = await this.state.storage.get<number>('updateCount') || 0;
    const alertEntries = await this.state.storage.list<PriceAlert>({ prefix: 'alert:' });

    // Determine health status
    let status: 'healthy' | 'stale' | 'error' = 'healthy';
    if (lastUpdate) {
      const lastUpdateTime = new Date(lastUpdate).getTime();
      if (Date.now() - lastUpdateTime > STALE_THRESHOLD) {
        status = 'stale';
      }
    } else {
      status = 'error';
    }

    const health: HealthStatus = {
      lastUpdate,
      updateCount,
      wsConnections: this.sessions.size,
      alertsCount: alertEntries.size,
      status,
    };

    return new Response(JSON.stringify(health), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Start automatic price refresh
   */
  async startAutoRefresh(): Promise<Response> {
    // Set alarm for next refresh
    await this.state.storage.put('autoRefreshEnabled', true);
    await this.state.storage.setAlarm(Date.now() + REFRESH_INTERVAL);

    return new Response(JSON.stringify({
      success: true,
      message: 'Auto-refresh started',
      interval: REFRESH_INTERVAL
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Stop automatic price refresh
   */
  async stopAutoRefresh(): Promise<Response> {
    await this.state.storage.put('autoRefreshEnabled', false);
    await this.state.storage.deleteAlarm();

    return new Response(JSON.stringify({
      success: true,
      message: 'Auto-refresh stopped'
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Alarm handler for automatic price refresh
   */
  async alarm(): Promise<void> {
    const autoRefreshEnabled = await this.state.storage.get<boolean>('autoRefreshEnabled');

    if (autoRefreshEnabled) {
      // Broadcast a refresh request to trigger price update from main API
      // The API should call the /update endpoint with fresh price data
      this.broadcast({
        type: 'refresh_needed',
        timestamp: Date.now(),
      });

      // Schedule next alarm
      await this.state.storage.setAlarm(Date.now() + REFRESH_INTERVAL);
    }

    // Clean up old history regardless of auto-refresh
    await this.cleanupHistory();

    // Clean up triggered alerts older than 24h
    await this.cleanupAlerts();
  }

  /**
   * Clean up old price history
   */
  async cleanupHistory(): Promise<void> {
    const cutoff = Date.now() - HISTORY_RETENTION;
    const entries = await this.state.storage.list({ prefix: 'history:' });

    const keysToDelete: string[] = [];
    for (const [key] of entries) {
      const timestamp = parseInt(key.replace('history:', ''));
      if (timestamp < cutoff) {
        keysToDelete.push(key);
      }
    }

    if (keysToDelete.length > 0) {
      await this.state.storage.delete(keysToDelete);
    }
  }

  /**
   * Clean up triggered alerts (per-user keys)
   */
  async cleanupAlerts(): Promise<void> {
    const entries = await this.state.storage.list<PriceAlert>({ prefix: 'alert:' });
    const cutoff = Date.now() - HISTORY_RETENTION;
    const keysToDelete: string[] = [];

    for (const [key, alert] of entries) {
      if (alert.triggered) {
        const createdAt = new Date(alert.createdAt).getTime();
        if (createdAt <= cutoff) {
          keysToDelete.push(key);
        }
      }
    }

    if (keysToDelete.length > 0) {
      await this.state.storage.delete(keysToDelete);
    }
  }

  /**
   * Broadcast message to all connected WebSocket clients
   */
  broadcast(message: object): void {
    const messageStr = JSON.stringify(message);

    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(messageStr);
      } catch (error) {
        // Client disconnected, will be cleaned up
      }
    }
  }
}
