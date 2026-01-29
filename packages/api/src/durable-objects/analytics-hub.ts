/**
 * AnalyticsHub Durable Object
 * Real-time metrics aggregation, WebSocket broadcasting, and alert management
 */

import { DurableObject } from 'cloudflare:workers';

// Metrics tracked in real-time
export interface RealtimeMetrics {
  timestamp: string;
  activeConnections: number;
  transactionsLastHour: number;
  transactionsLast5Min: number;
  buyVolumeLastHour: number;
  sellVolumeLastHour: number;
  buyVolumeLast24h: number;
  sellVolumeLast24h: number;
  errorRateLast5Min: number;
  requestsLast5Min: number;
  errorsLast5Min: number;
  avgLatencyLast5Min: number;
  pendingKyc: number;
  pendingWithdrawals: number;
  goldStockCoverage: number;
  newUsersToday: number;
  transactionFailureRate: number;
}

// Event received from API
interface MetricEvent {
  type: 'transaction' | 'request' | 'error' | 'user' | 'kyc' | 'withdrawal' | 'stock';
  timestamp: number;
  data: Record<string, unknown>;
}

// Time-bucketed data point
interface DataPoint {
  timestamp: number;
  value: number;
  metadata?: Record<string, unknown>;
}

// Alert rule from D1
interface AlertRule {
  id: string;
  name: string;
  metric: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  threshold: number;
  severity: 'info' | 'warning' | 'critical';
  cooldownMinutes: number;
  notifyEmail: boolean;
  notifySms: boolean;
  notifyWebhook: string | null;
  lastTriggeredAt: number | null;
}

// Active alert
interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: string;
  message: string;
  currentValue: number;
  threshold: number;
  triggeredAt: string;
  acknowledged: boolean;
}

const FIVE_MINUTES = 5 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

export class AnalyticsHub extends DurableObject {
  // WebSocket connections
  private connections: Set<WebSocket> = new Set();

  // Time-series data (sliding windows)
  private transactions: DataPoint[] = [];
  private requests: DataPoint[] = [];
  private errors: DataPoint[] = [];
  private latencies: DataPoint[] = [];
  private newUsers: DataPoint[] = [];

  // Current counters
  private pendingKyc = 0;
  private pendingWithdrawals = 0;
  private goldStockCoverage = 1.0;

  // Alert rules (cached from D1)
  private alertRules: AlertRule[] = [];
  private activeAlerts: Map<string, Alert> = new Map();

  constructor(state: DurableObjectState, env: unknown) {
    super(state, env);

    // Load persisted state
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<{
        transactions: DataPoint[];
        requests: DataPoint[];
        errors: DataPoint[];
        latencies: DataPoint[];
        newUsers: DataPoint[];
        pendingKyc: number;
        pendingWithdrawals: number;
        goldStockCoverage: number;
        alertRules: AlertRule[];
      }>('state');

      if (stored) {
        this.transactions = stored.transactions || [];
        this.requests = stored.requests || [];
        this.errors = stored.errors || [];
        this.latencies = stored.latencies || [];
        this.newUsers = stored.newUsers || [];
        this.pendingKyc = stored.pendingKyc || 0;
        this.pendingWithdrawals = stored.pendingWithdrawals || 0;
        this.goldStockCoverage = stored.goldStockCoverage || 1.0;
        this.alertRules = stored.alertRules || [];
      }

      // Schedule cleanup alarm
      const alarm = await this.ctx.storage.getAlarm();
      if (!alarm) {
        await this.ctx.storage.setAlarm(Date.now() + FIVE_MINUTES);
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }

    // REST API
    switch (path) {
      case '/metrics':
        return this.handleGetMetrics();
      case '/event':
        if (request.method === 'POST') {
          return this.handleEvent(request);
        }
        break;
      case '/alerts':
        return this.handleGetAlerts();
      case '/alerts/rules':
        if (request.method === 'GET') {
          return this.handleGetAlertRules();
        }
        if (request.method === 'POST') {
          return this.handleUpdateAlertRules(request);
        }
        break;
      case '/history':
        return this.handleGetHistory(url);
      case '/health':
        return this.handleHealth();
      case '/update-counters':
        if (request.method === 'POST') {
          return this.handleUpdateCounters(request);
        }
        break;
    }

    // Acknowledge alert
    if (path.startsWith('/alerts/') && path.endsWith('/acknowledge') && request.method === 'POST') {
      const alertId = path.split('/')[2];
      return this.handleAcknowledgeAlert(alertId, request);
    }

    return new Response('Not Found', { status: 404 });
  }

  /**
   * Handle WebSocket connection for real-time dashboard
   */
  private handleWebSocket(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    this.connections.add(server);

    // Send current metrics immediately
    const metrics = this.computeMetrics();
    server.send(JSON.stringify({ type: 'metrics', data: metrics }));

    // Send active alerts
    const alerts = Array.from(this.activeAlerts.values());
    if (alerts.length > 0) {
      server.send(JSON.stringify({ type: 'alerts', data: alerts }));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Handle WebSocket close
   */
  webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): void {
    this.connections.delete(ws);
  }

  /**
   * Handle incoming metric event
   */
  private async handleEvent(request: Request): Promise<Response> {
    try {
      const event = await request.json() as MetricEvent;
      const now = Date.now();

      switch (event.type) {
        case 'transaction':
          this.transactions.push({
            timestamp: now,
            value: (event.data.cashAmount as number) || 0,
            metadata: {
              type: event.data.transactionType,
              status: event.data.status,
            },
          });
          break;

        case 'request':
          this.requests.push({ timestamp: now, value: 1 });
          if (event.data.latencyMs) {
            this.latencies.push({
              timestamp: now,
              value: event.data.latencyMs as number,
            });
          }
          break;

        case 'error':
          this.errors.push({ timestamp: now, value: 1 });
          break;

        case 'user':
          if (event.data.action === 'REGISTER') {
            this.newUsers.push({ timestamp: now, value: 1 });
          }
          break;

        case 'kyc':
          this.pendingKyc = (event.data.count as number) || 0;
          break;

        case 'withdrawal':
          this.pendingWithdrawals = (event.data.count as number) || 0;
          break;

        case 'stock':
          this.goldStockCoverage = (event.data.coverage as number) || 1.0;
          break;
      }

      // Persist state (debounced by DO)
      await this.persistState();

      // Broadcast update to connected clients
      this.broadcastMetrics();

      // Check alert rules
      await this.evaluateAlerts();

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Invalid event' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  /**
   * Get current metrics
   */
  private handleGetMetrics(): Response {
    const metrics = this.computeMetrics();
    return new Response(JSON.stringify({ success: true, data: metrics }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Get active alerts
   */
  private handleGetAlerts(): Response {
    const alerts = Array.from(this.activeAlerts.values());
    return new Response(JSON.stringify({ success: true, data: alerts }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Get alert rules
   */
  private handleGetAlertRules(): Response {
    return new Response(JSON.stringify({ success: true, data: this.alertRules }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Update alert rules (from D1 sync)
   */
  private async handleUpdateAlertRules(request: Request): Promise<Response> {
    try {
      const { rules } = await request.json() as { rules: AlertRule[] };
      this.alertRules = rules;
      await this.persistState();
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid rules' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  /**
   * Get historical data
   */
  private handleGetHistory(url: URL): Response {
    const period = url.searchParams.get('period') || '1h';
    const now = Date.now();

    let cutoff: number;
    switch (period) {
      case '5m': cutoff = now - FIVE_MINUTES; break;
      case '1h': cutoff = now - ONE_HOUR; break;
      case '24h': cutoff = now - ONE_DAY; break;
      default: cutoff = now - ONE_HOUR;
    }

    const history = {
      transactions: this.transactions.filter(p => p.timestamp >= cutoff),
      requests: this.requests.filter(p => p.timestamp >= cutoff),
      errors: this.errors.filter(p => p.timestamp >= cutoff),
      latencies: this.latencies.filter(p => p.timestamp >= cutoff),
    };

    return new Response(JSON.stringify({ success: true, data: history }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Health check
   */
  private handleHealth(): Response {
    const metrics = this.computeMetrics();
    const status = metrics.errorRateLast5Min > 10 ? 'degraded' : 'healthy';

    return new Response(JSON.stringify({
      success: true,
      data: {
        status,
        activeConnections: this.connections.size,
        dataPoints: {
          transactions: this.transactions.length,
          requests: this.requests.length,
          errors: this.errors.length,
        },
        alertRules: this.alertRules.length,
        activeAlerts: this.activeAlerts.size,
      },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Update counters from external source (KYC count, withdrawals, stock)
   */
  private async handleUpdateCounters(request: Request): Promise<Response> {
    try {
      const data = await request.json() as {
        pendingKyc?: number;
        pendingWithdrawals?: number;
        goldStockCoverage?: number;
      };

      if (data.pendingKyc !== undefined) this.pendingKyc = data.pendingKyc;
      if (data.pendingWithdrawals !== undefined) this.pendingWithdrawals = data.pendingWithdrawals;
      if (data.goldStockCoverage !== undefined) this.goldStockCoverage = data.goldStockCoverage;

      await this.persistState();
      this.broadcastMetrics();
      await this.evaluateAlerts();

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid data' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  /**
   * Acknowledge an alert
   */
  private async handleAcknowledgeAlert(alertId: string, request: Request): Promise<Response> {
    try {
      const { acknowledgedBy } = await request.json() as { acknowledgedBy?: string };

      const alert = this.activeAlerts.get(alertId);
      if (!alert) {
        return new Response(JSON.stringify({ error: 'Alert not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      alert.acknowledged = true;
      this.activeAlerts.set(alertId, alert);

      // Broadcast alert update
      this.broadcast({ type: 'alert_acknowledged', data: { id: alertId, acknowledgedBy } });

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid request' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  /**
   * Compute current metrics from time-series data
   */
  private computeMetrics(): RealtimeMetrics {
    const now = Date.now();
    const fiveMinAgo = now - FIVE_MINUTES;
    const oneHourAgo = now - ONE_HOUR;
    const oneDayAgo = now - ONE_DAY;
    const startOfDay = new Date().setUTCHours(0, 0, 0, 0);

    // Filter data by time windows
    const txLast5Min = this.transactions.filter(p => p.timestamp >= fiveMinAgo);
    const txLastHour = this.transactions.filter(p => p.timestamp >= oneHourAgo);
    const txLast24h = this.transactions.filter(p => p.timestamp >= oneDayAgo);
    const reqLast5Min = this.requests.filter(p => p.timestamp >= fiveMinAgo);
    const errLast5Min = this.errors.filter(p => p.timestamp >= fiveMinAgo);
    const latLast5Min = this.latencies.filter(p => p.timestamp >= fiveMinAgo);
    const newUsersToday = this.newUsers.filter(p => p.timestamp >= startOfDay);

    // Calculate buy/sell volumes
    const buyVolume24h = txLast24h
      .filter(t => t.metadata?.type === 'BUY' && t.metadata?.status === 'COMPLETED')
      .reduce((sum, t) => sum + t.value, 0);
    const sellVolume24h = txLast24h
      .filter(t => t.metadata?.type === 'SELL' && t.metadata?.status === 'COMPLETED')
      .reduce((sum, t) => sum + t.value, 0);
    const buyVolumeHour = txLastHour
      .filter(t => t.metadata?.type === 'BUY' && t.metadata?.status === 'COMPLETED')
      .reduce((sum, t) => sum + t.value, 0);
    const sellVolumeHour = txLastHour
      .filter(t => t.metadata?.type === 'SELL' && t.metadata?.status === 'COMPLETED')
      .reduce((sum, t) => sum + t.value, 0);

    // Calculate failure rate
    const completedTx = txLast5Min.filter(t => t.metadata?.status === 'COMPLETED').length;
    const failedTx = txLast5Min.filter(t => t.metadata?.status === 'FAILED').length;
    const totalTx = completedTx + failedTx;
    const failureRate = totalTx > 0 ? (failedTx / totalTx) * 100 : 0;

    // Calculate error rate
    const requestCount = reqLast5Min.length;
    const errorCount = errLast5Min.length;
    const errorRate = requestCount > 0 ? (errorCount / requestCount) * 100 : 0;

    // Calculate average latency
    const avgLatency = latLast5Min.length > 0
      ? latLast5Min.reduce((sum, l) => sum + l.value, 0) / latLast5Min.length
      : 0;

    return {
      timestamp: new Date().toISOString(),
      activeConnections: this.connections.size,
      transactionsLastHour: txLastHour.length,
      transactionsLast5Min: txLast5Min.length,
      buyVolumeLastHour: buyVolumeHour,
      sellVolumeLastHour: sellVolumeHour,
      buyVolumeLast24h: buyVolume24h,
      sellVolumeLast24h: sellVolume24h,
      errorRateLast5Min: Math.round(errorRate * 100) / 100,
      requestsLast5Min: requestCount,
      errorsLast5Min: errorCount,
      avgLatencyLast5Min: Math.round(avgLatency),
      pendingKyc: this.pendingKyc,
      pendingWithdrawals: this.pendingWithdrawals,
      goldStockCoverage: this.goldStockCoverage,
      newUsersToday: newUsersToday.length,
      transactionFailureRate: Math.round(failureRate * 100) / 100,
    };
  }

  /**
   * Evaluate alert rules against current metrics
   */
  private async evaluateAlerts(): Promise<void> {
    const metrics = this.computeMetrics();
    const now = Date.now();

    for (const rule of this.alertRules) {
      const metricValue = (metrics as unknown as Record<string, unknown>)[rule.metric];
      if (typeof metricValue !== 'number') continue;

      // Check cooldown
      if (rule.lastTriggeredAt) {
        const cooldownMs = rule.cooldownMinutes * 60 * 1000;
        if (now - rule.lastTriggeredAt < cooldownMs) continue;
      }

      // Evaluate condition
      let triggered = false;
      switch (rule.operator) {
        case '>': triggered = metricValue > rule.threshold; break;
        case '<': triggered = metricValue < rule.threshold; break;
        case '>=': triggered = metricValue >= rule.threshold; break;
        case '<=': triggered = metricValue <= rule.threshold; break;
        case '==': triggered = metricValue === rule.threshold; break;
        case '!=': triggered = metricValue !== rule.threshold; break;
      }

      if (triggered && !this.activeAlerts.has(rule.id)) {
        // Create alert
        const alert: Alert = {
          id: crypto.randomUUID(),
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          message: `${rule.name}: ${rule.metric} = ${metricValue} (seuil: ${rule.operator} ${rule.threshold})`,
          currentValue: metricValue,
          threshold: rule.threshold,
          triggeredAt: new Date().toISOString(),
          acknowledged: false,
        };

        this.activeAlerts.set(rule.id, alert);
        rule.lastTriggeredAt = now;

        // Broadcast new alert
        this.broadcast({ type: 'alert', data: alert });

        // TODO: Queue notification (email/SMS/webhook)
        console.log(`[Alert] ${rule.severity.toUpperCase()}: ${alert.message}`);
      } else if (!triggered && this.activeAlerts.has(rule.id)) {
        // Resolve alert
        const alert = this.activeAlerts.get(rule.id)!;
        this.activeAlerts.delete(rule.id);
        this.broadcast({ type: 'alert_resolved', data: { id: alert.id, ruleId: rule.id } });
      }
    }
  }

  /**
   * Broadcast metrics to all connected WebSockets
   */
  private broadcastMetrics(): void {
    const metrics = this.computeMetrics();
    this.broadcast({ type: 'metrics', data: metrics });
  }

  /**
   * Broadcast message to all WebSocket connections
   */
  private broadcast(message: { type: string; data: unknown }): void {
    const payload = JSON.stringify(message);
    for (const ws of this.connections) {
      try {
        ws.send(payload);
      } catch {
        this.connections.delete(ws);
      }
    }
  }

  /**
   * Persist state to durable storage
   */
  private async persistState(): Promise<void> {
    await this.ctx.storage.put('state', {
      transactions: this.transactions,
      requests: this.requests,
      errors: this.errors,
      latencies: this.latencies,
      newUsers: this.newUsers,
      pendingKyc: this.pendingKyc,
      pendingWithdrawals: this.pendingWithdrawals,
      goldStockCoverage: this.goldStockCoverage,
      alertRules: this.alertRules,
    });
  }

  /**
   * Alarm handler - cleanup old data and broadcast metrics
   */
  async alarm(): Promise<void> {
    const now = Date.now();
    const oneDayAgo = now - ONE_DAY;

    // Cleanup old data (keep last 24 hours)
    this.transactions = this.transactions.filter(p => p.timestamp >= oneDayAgo);
    this.requests = this.requests.filter(p => p.timestamp >= oneDayAgo);
    this.errors = this.errors.filter(p => p.timestamp >= oneDayAgo);
    this.latencies = this.latencies.filter(p => p.timestamp >= oneDayAgo);
    this.newUsers = this.newUsers.filter(p => p.timestamp >= oneDayAgo);

    await this.persistState();

    // Broadcast current metrics
    this.broadcastMetrics();

    // Evaluate alerts
    await this.evaluateAlerts();

    // Schedule next alarm
    await this.ctx.storage.setAlarm(now + FIVE_MINUTES);
  }
}
