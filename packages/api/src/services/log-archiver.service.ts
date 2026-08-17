/**
 * Log Archiver Service
 * Archives structured logs to R2 and indexes them in D1 for fast search
 */

import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { StructuredLogData } from '@tnc-trading/shared/contracts';

// La forme d un journal vient du contrat partage : elle est ecrite ici et lue
// par le back-office, donc les deux doivent parler du meme type.
export type StructuredLog = StructuredLogData;

export interface LogBatch {
  logs: StructuredLog[];
  date: string;
  batchId: string;
}

/**
 * Get log date for partitioning (YYYY-MM-DD)
 */
function getLogDate(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/**
 * Generate R2 key for log batch
 * Format: logs/{date}/{hour}/{batchId}.jsonl
 */
function getR2Key(date: string, batchId: string): string {
  const hour = new Date().getUTCHours().toString().padStart(2, '0');
  return `logs/${date}/${hour}/${batchId}.jsonl`;
}

/**
 * Log Archiver Service
 */
export class LogArchiverService {
  constructor(
    private db: D1Database,
    private storage: R2Bucket,
    private environment: string
  ) {}

  /**
   * Archive a batch of logs to R2 and index in D1
   */
  async archiveBatch(logs: StructuredLog[]): Promise<{ batchId: string; r2Key: string; count: number }> {
    if (logs.length === 0) {
      return { batchId: '', r2Key: '', count: 0 };
    }

    const batchId = crypto.randomUUID();
    const date = getLogDate(logs[0].timestamp);
    const r2Key = getR2Key(date, batchId);

    // Convert logs to JSONL format
    const jsonl = logs.map(log => JSON.stringify(log)).join('\n');

    // Store in R2
    await this.storage.put(r2Key, jsonl, {
      httpMetadata: {
        contentType: 'application/x-ndjson',
      },
      customMetadata: {
        environment: this.environment,
        date,
        count: logs.length.toString(),
        batchId,
      },
    });

    // Index logs in D1 for fast search
    await this.indexLogs(logs, r2Key);

    return { batchId, r2Key, count: logs.length };
  }

  /**
   * Index logs in D1 for fast search
   */
  private async indexLogs(logs: StructuredLog[], r2Key: string): Promise<void> {
    const statements = logs.map((log, offset) => {
      const preview = log.message.slice(0, 200);
      const logDate = getLogDate(log.timestamp);

      return this.db
        .prepare(`
          INSERT INTO log_index (
            id, timestamp, log_date, level, category, action,
            user_id, request_id, entity_type, entity_id,
            r2_key, r2_offset, message_preview
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          log.id,
          log.timestamp,
          logDate,
          log.level,
          log.category,
          log.action || null,
          log.userId || null,
          log.requestId || null,
          log.entityType || null,
          log.entityId || null,
          r2Key,
          offset,
          preview
        );
    });

    // Batch insert (D1 supports up to 100 statements per batch)
    const batchSize = 100;
    for (let i = 0; i < statements.length; i += batchSize) {
      const batch = statements.slice(i, i + batchSize);
      await this.db.batch(batch);
    }
  }

  /**
   * Search logs with filters
   */
  async searchLogs(filters: {
    startDate?: string;
    endDate?: string;
    level?: string;
    category?: string;
    action?: string;
    userId?: string;
    requestId?: string;
    entityType?: string;
    entityId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    logs: Array<{
      id: string;
      timestamp: string;
      level: string;
      category: string;
      action: string | null;
      userId: string | null;
      requestId: string | null;
      messagePreview: string;
    }>;
    total: number;
  }> {
    const conditions: string[] = ['1=1'];
    const params: (string | number)[] = [];

    if (filters.startDate) {
      conditions.push('log_date >= ?');
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      conditions.push('log_date <= ?');
      params.push(filters.endDate);
    }
    if (filters.level) {
      conditions.push('level = ?');
      params.push(filters.level);
    }
    if (filters.category) {
      conditions.push('category = ?');
      params.push(filters.category);
    }
    if (filters.action) {
      conditions.push('action = ?');
      params.push(filters.action);
    }
    if (filters.userId) {
      conditions.push('user_id = ?');
      params.push(filters.userId);
    }
    if (filters.requestId) {
      conditions.push('request_id = ?');
      params.push(filters.requestId);
    }
    if (filters.entityType) {
      conditions.push('entity_type = ?');
      params.push(filters.entityType);
    }
    if (filters.entityId) {
      conditions.push('entity_id = ?');
      params.push(filters.entityId);
    }
    if (filters.search) {
      conditions.push('message_preview LIKE ?');
      params.push(`%${filters.search}%`);
    }

    const whereClause = conditions.join(' AND ');
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    // Get total count
    const countResult = await this.db
      .prepare(`SELECT COUNT(*) as count FROM log_index WHERE ${whereClause}`)
      .bind(...params)
      .first<{ count: number }>();

    // Get logs
    const logsResult = await this.db
      .prepare(`
        SELECT
          id, timestamp, level, category, action,
          user_id, request_id, message_preview
        FROM log_index
        WHERE ${whereClause}
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `)
      .bind(...params, limit, offset)
      .all<{
        id: string;
        timestamp: string;
        level: string;
        category: string;
        action: string | null;
        user_id: string | null;
        request_id: string | null;
        message_preview: string;
      }>();

    return {
      logs: (logsResult.results || []).map(row => ({
        id: row.id,
        timestamp: row.timestamp,
        level: row.level,
        category: row.category,
        action: row.action,
        userId: row.user_id,
        requestId: row.request_id,
        messagePreview: row.message_preview,
      })),
      total: countResult?.count || 0,
    };
  }

  /**
   * Get full log content from R2
   */
  async getLogContent(logId: string): Promise<StructuredLog | null> {
    // Find the log index entry
    const indexEntry = await this.db
      .prepare('SELECT r2_key, r2_offset FROM log_index WHERE id = ?')
      .bind(logId)
      .first<{ r2_key: string; r2_offset: number }>();

    if (!indexEntry) {
      return null;
    }

    // Fetch from R2
    const object = await this.storage.get(indexEntry.r2_key);
    if (!object) {
      return null;
    }

    const content = await object.text();
    const lines = content.split('\n');

    if (indexEntry.r2_offset >= lines.length) {
      return null;
    }

    try {
      return JSON.parse(lines[indexEntry.r2_offset]) as StructuredLog;
    } catch {
      return null;
    }
  }

  /**
   * Clean up old logs (retention policy)
   */
  async cleanupOldLogs(retentionDays: number): Promise<{ deletedCount: number }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const cutoffDateStr = cutoffDate.toISOString().slice(0, 10);

    // Get R2 keys to delete
    const keysResult = await this.db
      .prepare('SELECT DISTINCT r2_key FROM log_index WHERE log_date < ?')
      .bind(cutoffDateStr)
      .all<{ r2_key: string }>();

    const keys = keysResult.results || [];

    // Delete from R2
    for (const { r2_key } of keys) {
      await this.storage.delete(r2_key);
    }

    // Delete from D1 index
    await this.db
      .prepare('DELETE FROM log_index WHERE log_date < ?')
      .bind(cutoffDateStr)
      .run();

    return { deletedCount: keys.length };
  }

  /**
   * Get log statistics
   */
  async getLogStats(startDate?: string, endDate?: string): Promise<{
    totalLogs: number;
    byLevel: Record<string, number>;
    byCategory: Record<string, number>;
    recentErrors: number;
  }> {
    const today = new Date().toISOString().slice(0, 10);
    const start = startDate || today;
    const end = endDate || today;

    // Total logs
    const totalResult = await this.db
      .prepare('SELECT COUNT(*) as count FROM log_index WHERE log_date BETWEEN ? AND ?')
      .bind(start, end)
      .first<{ count: number }>();

    // By level
    const levelResult = await this.db
      .prepare(`
        SELECT level, COUNT(*) as count
        FROM log_index
        WHERE log_date BETWEEN ? AND ?
        GROUP BY level
      `)
      .bind(start, end)
      .all<{ level: string; count: number }>();

    // By category
    const categoryResult = await this.db
      .prepare(`
        SELECT category, COUNT(*) as count
        FROM log_index
        WHERE log_date BETWEEN ? AND ?
        GROUP BY category
        ORDER BY count DESC
        LIMIT 10
      `)
      .bind(start, end)
      .all<{ category: string; count: number }>();

    // Recent errors (last hour)
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const errorsResult = await this.db
      .prepare(`
        SELECT COUNT(*) as count
        FROM log_index
        WHERE level IN ('error', 'fatal') AND timestamp > ?
      `)
      .bind(oneHourAgo)
      .first<{ count: number }>();

    const byLevel: Record<string, number> = {};
    for (const row of levelResult.results || []) {
      byLevel[row.level] = row.count;
    }

    const byCategory: Record<string, number> = {};
    for (const row of categoryResult.results || []) {
      byCategory[row.category] = row.count;
    }

    return {
      totalLogs: totalResult?.count || 0,
      byLevel,
      byCategory,
      recentErrors: errorsResult?.count || 0,
    };
  }
}
