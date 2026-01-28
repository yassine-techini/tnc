/**
 * ConfigService - Reads platform configuration from D1 config table with KV caching
 */

interface ConfigRow {
  key: string;
  value: string;
  description: string | null;
  updated_by: string | null;
  updated_at: string;
}

export class ConfigService {
  private static readonly CACHE_PREFIX = 'config:';
  private static readonly CACHE_TTL = 300; // 5 minutes

  constructor(
    private db: D1Database,
    private kv: KVNamespace
  ) {}

  /**
   * Get a single config value by key (with KV cache)
   */
  async get(key: string, fallback?: string): Promise<string | null> {
    // Try KV cache first
    const cacheKey = `${ConfigService.CACHE_PREFIX}${key}`;
    const cached = await this.kv.get(cacheKey);
    if (cached !== null) return cached;

    // Read from DB
    try {
      const row = await this.db
        .prepare('SELECT value FROM config WHERE key = ?')
        .bind(key)
        .first<{ value: string }>();

      const value = row?.value ?? fallback ?? null;

      // Cache the result (even null as empty string to avoid repeated DB hits)
      if (value !== null) {
        await this.kv.put(cacheKey, value, { expirationTtl: ConfigService.CACHE_TTL });
      }

      return value;
    } catch {
      return fallback ?? null;
    }
  }

  /**
   * Get a config value as a number
   */
  async getNumber(key: string, fallback: number): Promise<number> {
    const value = await this.get(key);
    if (value === null) return fallback;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? fallback : parsed;
  }

  /**
   * Get multiple config values by prefix
   */
  async getByPrefix(prefix: string): Promise<Record<string, string>> {
    try {
      const result = await this.db
        .prepare('SELECT key, value FROM config WHERE key LIKE ?')
        .bind(`${prefix}%`)
        .all<{ key: string; value: string }>();

      const map: Record<string, string> = {};
      for (const row of result.results || []) {
        map[row.key] = row.value;
      }
      return map;
    } catch {
      return {};
    }
  }

  /**
   * Set a config value (admin use) - invalidates cache
   */
  async set(key: string, value: string, description?: string, updatedBy?: string): Promise<void> {
    if (description !== undefined) {
      await this.db
        .prepare(
          `INSERT INTO config (key, value, description, updated_by, updated_at)
           VALUES (?, ?, ?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = ?, description = ?, updated_by = ?, updated_at = datetime('now')`
        )
        .bind(key, value, description, updatedBy || null, value, description, updatedBy || null)
        .run();
    } else {
      await this.db
        .prepare(
          `UPDATE config SET value = ?, updated_by = ?, updated_at = datetime('now') WHERE key = ?`
        )
        .bind(value, updatedBy || null, key)
        .run();
    }

    // Invalidate cache
    await this.kv.delete(`${ConfigService.CACHE_PREFIX}${key}`);
  }

  /**
   * Get all config entries
   */
  async getAll(): Promise<ConfigRow[]> {
    try {
      const result = await this.db
        .prepare('SELECT key, value, description, updated_by, updated_at FROM config ORDER BY key')
        .all<ConfigRow>();
      return result.results || [];
    } catch {
      return [];
    }
  }
}
