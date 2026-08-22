import { Context, Next } from 'hono';
import type { AppEnv } from '../types/env';
import { AuthService } from '../services/auth.service';
import { ConfigService } from '../services/config.service';
import { logger } from '../lib/logger';
import { getAccessToken } from '../lib/cookies';
import { texte } from '../lib/reponse-erreur';

/*
 * NOTE — Cloudflare Access is NOT used on this deployment.
 *
 * This file used to carry adminAuthMiddleware and stateAuthMiddleware, which
 * verified Cf-Access-Jwt-Assertion headers. They were never mounted on any
 * route: the privileged portals authenticate with password + mandatory TOTP and
 * portal-bound JWTs (see routes/admin.ts and routes/state.ts), and the only
 * network control in front of them is middleware/portal-allowlist.
 *
 * Keeping ~170 lines of unreachable Zero-Trust code made the codebase look
 * protected by a control that does not exist, so it was removed rather than
 * left as a decoy.
 */

/**
 * Middleware for authenticating regular users via JWT
 * Supports both Authorization header (mobile) and httpOnly cookies (web)
 */
export async function authMiddleware(c: Context<AppEnv>, next: Next) {
  // Get token from header or cookie
  const token = getAccessToken(c);

  if (!token) {
    return c.json({
      success: false,
      error: {
        code: 'AUTH_REQUIRED',
        message: texte(c, 'AUTH_REQUIRED'),
      },
      requestId: crypto.randomUUID(),
    }, 401);
  }

  try {
    const authService = new AuthService(c.env.JWT_SECRET);
    const payload = await authService.verifyToken(token);

    if (!payload) {
      return c.json({
        success: false,
        error: {
          code: 'AUTH_INVALID_TOKEN',
          message: texte(c, 'AUTH_INVALID_TOKEN'),
        },
        requestId: crypto.randomUUID(),
      }, 401);
    }

    if (payload.type !== 'access') {
      return c.json({
        success: false,
        error: {
          code: 'AUTH_INVALID_TOKEN_TYPE',
          message: texte(c, 'AUTH_INVALID_TOKEN_TYPE'),
        },
        requestId: crypto.randomUUID(),
      }, 401);
    }

    c.set('userId', payload.sub);
    c.set('userEmail', payload.email);
    c.set('kycLevel', payload.kycLevel);

    return next();
  } catch (error) {
    return c.json({
      success: false,
      error: {
        code: 'AUTH_INVALID_TOKEN',
        message: texte(c, 'AUTH_INVALID_TOKEN'),
      },
      requestId: crypto.randomUUID(),
    }, 401);
  }
}

/**
 * Middleware for authenticating admin users via Cloudflare Access
 */
