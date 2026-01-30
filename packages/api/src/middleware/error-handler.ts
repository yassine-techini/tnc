import { Context } from 'hono';
import type { AppEnv } from '../types/env';
import { logger } from '../lib/logger';

/** Redact PII and sensitive data from error messages before logging */
function redactPii(value: unknown): string {
  const str = typeof value === 'string' ? value : String(value);
  return str
    // Email addresses
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')
    // Phone numbers (international format)
    .replace(/\+?\d{10,15}/g, '[PHONE]')
    // Credit card numbers
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[CARD]')
    // JWT tokens
    .replace(/eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[JWT]')
    // Passwords in various formats
    .replace(/password[\s"':=]+\S+/gi, 'password=[REDACTED]')
    // IP addresses (IPv4)
    .replace(/\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g, '[IP]')
    // UUIDs
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[UUID]')
    // API keys and secrets (common patterns)
    .replace(/(?:api[_-]?key|secret|token|auth)[\s"':=]+[a-zA-Z0-9_-]{20,}/gi, '$1=[REDACTED]')
    // Large transaction amounts (6+ digits with optional decimals)
    .replace(/\b\d{6,}(?:\.\d{1,2})?\s*(?:XOF|FCFA|USD|EUR)?\b/gi, '[AMOUNT]')
    // Hex strings that might be hashes/keys (32+ chars)
    .replace(/\b[a-f0-9]{32,}\b/gi, '[HASH]');
}

/** Report error to Sentry via store envelope endpoint (lightweight, no SDK) */
function reportToSentry(err: Error, dsn: string, env: string, requestId: string) {
  try {
    const dsnUrl = new URL(dsn);
    const projectId = dsnUrl.pathname.replace('/', '');
    const publicKey = dsnUrl.username;
    const endpoint = `https://${dsnUrl.host}/api/${projectId}/envelope/`;

    const envelope = [
      JSON.stringify({ dsn, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify({
        event_id: crypto.randomUUID().replace(/-/g, ''),
        timestamp: Date.now() / 1000,
        platform: 'javascript',
        environment: env,
        tags: { requestId },
        exception: {
          values: [{
            type: err.name,
            value: err.message,
            stacktrace: err.stack ? { frames: parseStack(err.stack) } : undefined,
          }],
        },
      }),
    ].join('\n');

    // Fire-and-forget
    fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${publicKey}`,
      },
      body: envelope,
    }).catch(() => {});
  } catch {}
}

/**
 * Sanitize file path to remove sensitive absolute paths.
 * Converts "/home/deploy/app/src/routes/auth.ts" to "src/routes/auth.ts"
 */
function sanitizeFilePath(filePath: string): string {
  // Remove absolute path prefixes, keep only relative path from src/ or packages/
  const patterns = [
    /^.*?(?=packages\/)/,  // Remove everything before "packages/"
    /^.*?(?=src\/)/,       // Remove everything before "src/"
    /^.*?(?=node_modules\/)/, // Keep node_modules path for dependencies
  ];

  for (const pattern of patterns) {
    const match = filePath.match(pattern);
    if (match) {
      return filePath.slice(match[0].length);
    }
  }

  // If no pattern matched, just return the filename
  const lastSlash = filePath.lastIndexOf('/');
  return lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
}

function parseStack(stack: string): Array<{ filename: string; lineno?: number; function?: string }> {
  return stack.split('\n').slice(1, 10).map((line) => {
    const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):\d+\)/);
    if (match) {
      return {
        function: match[1],
        filename: sanitizeFilePath(match[2]), // SECURITY: Sanitize file paths
        lineno: parseInt(match[3]),
      };
    }
    // For lines without full path info, sanitize the entire line
    return { filename: sanitizeFilePath(line.trim()) };
  });
}

/**
 * Global error handler
 */
export function errorHandler(err: Error, c: Context<AppEnv>) {
  const requestId = c.req.header('X-Request-ID') || crypto.randomUUID();
  logger.error('API Error', { message: redactPii(err.message), stack: redactPii(err.stack || '') });

  // Report to Sentry if configured
  if (c.env.SENTRY_DSN) {
    c.executionCtx.waitUntil(
      Promise.resolve(reportToSentry(err, c.env.SENTRY_DSN, c.env.ENVIRONMENT, requestId))
    );
  }
  
  const isDev = c.env.ENVIRONMENT === 'development';
  
  // Handle known error types
  if (err.name === 'ValidationError') {
    return c.json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: err.message,
        details: isDev ? (err as any).details : undefined,
      },
      requestId,
    }, 400);
  }

  // Handle Zod validation errors
  if (err.name === 'ZodError') {
    return c.json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Données invalides',
        details: isDev ? (err as any).errors : undefined,
      },
      requestId,
    }, 400);
  }

  // Generic error response
  return c.json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: isDev ? err.message : 'Une erreur interne est survenue',
    },
    requestId,
  }, 500);
}
