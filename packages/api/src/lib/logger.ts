/**
 * Structured logger for Cloudflare Workers.
 * Outputs JSON to Workers logs (viewable in wrangler tail / CF dashboard).
 * Includes timestamp, environment, and request context.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  environment?: string;
  requestId?: string;
  [key: string]: unknown;
}

let currentEnvironment: string = 'development';
let currentRequestId: string | undefined;

function formatLog(entry: LogEntry): string {
  return JSON.stringify({
    ...entry,
    timestamp: new Date().toISOString(),
    environment: currentEnvironment,
    requestId: currentRequestId,
  });
}

/**
 * Set logger context for the current request
 */
export function setLoggerContext(env?: string, requestId?: string) {
  if (env) currentEnvironment = env;
  if (requestId) currentRequestId = requestId;
}

/**
 * Clear logger context after request completes
 */
export function clearLoggerContext() {
  currentRequestId = undefined;
}

export const logger = {
  /**
   * Debug level - development troubleshooting, not shown in production
   */
  debug(message: string, context?: Record<string, unknown>) {
    if (currentEnvironment === 'production') return;
    console.debug(formatLog({ timestamp: '', level: 'debug', message, ...context }));
  },

  /**
   * Info level - general operational messages
   */
  info(message: string, context?: Record<string, unknown>) {
    console.info(formatLog({ timestamp: '', level: 'info', message, ...context }));
  },

  /**
   * Warn level - potentially problematic situations
   */
  warn(message: string, context?: Record<string, unknown>) {
    console.warn(formatLog({ timestamp: '', level: 'warn', message, ...context }));
  },

  /**
   * Error level - errors that need attention
   */
  error(message: string, context?: Record<string, unknown>) {
    console.error(formatLog({ timestamp: '', level: 'error', message, ...context }));
  },

  /**
   * Fatal level - critical errors that may cause service failure
   */
  fatal(message: string, context?: Record<string, unknown>) {
    console.error(formatLog({ timestamp: '', level: 'error', message, severity: 'FATAL', ...context }));
  },
};
