import { Context } from 'hono';
import type { Env } from '../types/env';

/**
 * Global error handler
 */
export function errorHandler(err: Error, c: Context<{ Bindings: Env }>) {
  console.error('API Error:', err);
  
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
      requestId: c.req.header('X-Request-ID') || crypto.randomUUID(),
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
      requestId: c.req.header('X-Request-ID') || crypto.randomUUID(),
    }, 400);
  }
  
  // Generic error response
  return c.json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: isDev ? err.message : 'Une erreur interne est survenue',
      stack: isDev ? err.stack : undefined,
    },
    requestId: c.req.header('X-Request-ID') || crypto.randomUUID(),
  }, 500);
}
