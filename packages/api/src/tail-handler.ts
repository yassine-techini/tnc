/**
 * Tail Worker Handler
 * Captures console logs from the main worker and archives them to R2
 *
 * Tail Workers receive TraceItem[] with all console.log, console.error, etc.
 * from the main worker execution.
 */

import type { Env } from './types/env';
import { LogArchiverService, type StructuredLog } from './services/log-archiver.service';

/**
 * Cloudflare Tail Worker types
 */
export interface TraceItem {
  /**
   * Array of events captured during request processing
   */
  logs: TraceLog[];

  /**
   * Exception thrown during request processing (if any)
   */
  exceptions: TraceException[];

  /**
   * The outcome of the request
   */
  outcome: 'ok' | 'exception' | 'exceededCpu' | 'canceled' | 'unknown';

  /**
   * Timestamp of the event
   */
  eventTimestamp: number;

  /**
   * Script name
   */
  scriptName: string;

  /**
   * Event type
   */
  event?: {
    request?: {
      url: string;
      method: string;
      headers: Record<string, string>;
    };
    scheduledTime?: number;
    cron?: string;
  };
}

interface TraceLog {
  /**
   * Log level: log, debug, info, warn, error
   */
  level: 'log' | 'debug' | 'info' | 'warn' | 'error';

  /**
   * Timestamp in milliseconds
   */
  timestamp: number;

  /**
   * Log message parts (arguments passed to console.log)
   */
  message: unknown[];
}

interface TraceException {
  /**
   * Exception name
   */
  name: string;

  /**
   * Exception message
   */
  message: string;

  /**
   * Stack trace
   */
  stack?: string;

  /**
   * Timestamp
   */
  timestamp: number;
}

/**
 * Parse log message to extract structured data
 * Supports format: [Category] Action: message {json}
 */
function parseLogMessage(messageParts: unknown[]): {
  category: string;
  action?: string;
  message: string;
  metadata?: Record<string, unknown>;
} {
  const fullMessage = messageParts.map(part =>
    typeof part === 'string' ? part : JSON.stringify(part)
  ).join(' ');

  // Try to parse structured log format: [Category] Action: message
  const structuredMatch = fullMessage.match(/^\[([^\]]+)\]\s*(?:([^:]+):\s*)?(.*)$/);

  if (structuredMatch) {
    const [, category, action, rest] = structuredMatch;

    // Try to extract JSON metadata at the end
    let message = rest;
    let metadata: Record<string, unknown> | undefined;

    const jsonMatch = rest.match(/^(.*?)\s*(\{.+\})$/s);
    if (jsonMatch) {
      message = jsonMatch[1].trim();
      try {
        metadata = JSON.parse(jsonMatch[2]);
      } catch {
        // Not valid JSON, keep as message
        message = rest;
      }
    }

    return { category, action, message, metadata };
  }

  // Default parsing for unstructured logs
  return {
    category: 'general',
    message: fullMessage,
  };
}

/**
 * Map trace level to log level
 */
function mapLevel(traceLevel: TraceLog['level']): StructuredLog['level'] {
  switch (traceLevel) {
    case 'debug': return 'debug';
    case 'info': return 'info';
    case 'log': return 'info';
    case 'warn': return 'warn';
    case 'error': return 'error';
    default: return 'info';
  }
}

/**
 * Extract request ID from headers or message
 */
function extractRequestId(trace: TraceItem, message: string): string | undefined {
  // Check request headers
  const requestId = trace.event?.request?.headers?.['x-request-id'];
  if (requestId) return requestId;

  // Try to extract from message
  const match = message.match(/requestId[=:]\s*([a-f0-9-]+)/i);
  return match?.[1];
}

/**
 * Extract user ID from message
 */
function extractUserId(message: string): string | undefined {
  const match = message.match(/userId[=:]\s*([a-f0-9-]+)/i);
  return match?.[1];
}

/**
 * Process trace items into structured logs
 */
function processTraceItems(traces: TraceItem[]): StructuredLog[] {
  const logs: StructuredLog[] = [];

  for (const trace of traces) {
    // Process regular logs
    for (const log of trace.logs) {
      const parsed = parseLogMessage(log.message);
      const message = parsed.message;

      logs.push({
        id: crypto.randomUUID(),
        timestamp: new Date(log.timestamp).toISOString(),
        level: mapLevel(log.level),
        category: parsed.category,
        action: parsed.action,
        message,
        requestId: extractRequestId(trace, message),
        userId: extractUserId(message),
        metadata: {
          ...parsed.metadata,
          scriptName: trace.scriptName,
          outcome: trace.outcome,
          url: trace.event?.request?.url,
          method: trace.event?.request?.method,
        },
      });
    }

    // Process exceptions as error logs
    for (const exception of trace.exceptions) {
      logs.push({
        id: crypto.randomUUID(),
        timestamp: new Date(exception.timestamp).toISOString(),
        level: 'fatal',
        category: 'exception',
        action: exception.name,
        message: exception.message,
        requestId: trace.event?.request?.headers?.['x-request-id'],
        stack: exception.stack,
        metadata: {
          scriptName: trace.scriptName,
          outcome: trace.outcome,
          url: trace.event?.request?.url,
          method: trace.event?.request?.method,
        },
      });
    }
  }

  return logs;
}

/**
 * Tail handler export
 * This is called by Cloudflare when logs are captured
 */
export async function handleTail(
  events: TraceItem[],
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  // Skip if no logs storage configured
  if (!env.LOGS_STORAGE || !env.DB) {
    return;
  }

  // Process trace items into structured logs
  const logs = processTraceItems(events);

  if (logs.length === 0) {
    return;
  }

  // Archive logs (using waitUntil to not block response)
  ctx.waitUntil(
    (async () => {
      try {
        const archiver = new LogArchiverService(
          env.DB,
          env.LOGS_STORAGE,
          env.ENVIRONMENT || 'development'
        );

        await archiver.archiveBatch(logs);
      } catch (error) {
        // Log archival failure should not throw
        console.error('[TailWorker] Failed to archive logs:', error);
      }
    })()
  );
}

/**
 * Default export for Tail Worker
 */
export default {
  tail: handleTail,
};
