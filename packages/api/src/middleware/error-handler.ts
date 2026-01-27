import { Context } from 'hono';
import type { Env } from '../types/env';

/** Redact PII from error messages before logging */
function redactPii(value: unknown): string {
  const str = typeof value === 'string' ? value : String(value);
  return str
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')
    .replace(/\+?\d{10,15}/g, '[PHONE]')
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[CARD]')
    .replace(/eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[JWT]')
    .replace(/password[\s"':=]+\S+/gi, 'password=[REDACTED]');
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

function parseStack(stack: string): Array<{ filename: string; lineno?: number; function?: string }> {
  return stack.split('\n').slice(1, 10).map((line) => {
    const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):\d+\)/);
    if (match) return { function: match[1], filename: match[2], lineno: parseInt(match[3]) };
    return { filename: line.trim() };
  });
}

/**
 * Global error handler
 */
export function errorHandler(err: Error, c: Context<{ Bindings: Env }>) {
  const requestId = c.req.header('X-Request-ID') || crypto.randomUUID();
  console.error('API Error:', redactPii(err.message), redactPii(err.stack || ''));

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
