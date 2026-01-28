/**
 * Structured logger for Cloudflare Workers.
 * Outputs JSON to Workers logs (viewable in wrangler tail / CF dashboard).
 * In development, uses human-readable format.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

function formatLog(entry: LogEntry): string {
  return JSON.stringify(entry);
}

export const logger = {
  debug(message: string, context?: Record<string, unknown>) {
    console.debug(formatLog({ level: 'debug', message, ...context }));
  },
  info(message: string, context?: Record<string, unknown>) {
    console.info(formatLog({ level: 'info', message, ...context }));
  },
  warn(message: string, context?: Record<string, unknown>) {
    console.warn(formatLog({ level: 'warn', message, ...context }));
  },
  error(message: string, context?: Record<string, unknown>) {
    console.error(formatLog({ level: 'error', message, ...context }));
  },
};
