import { Context, Next } from 'hono';
import type { AppEnv } from '../types/env';
import { AuthService } from '../services/auth.service';
import { ConfigService } from '../services/config.service';
import { logger } from '../lib/logger';

// Cache for Cloudflare Access public keys
let cfAccessKeysCache: { keys: JsonWebKey[]; fetchedAt: number } | null = null;
let cfKeysCacheTtl: number | null = null;

/**
 * Fetch Cloudflare Access public keys for JWT verification
 */
async function getCloudflareAccessPublicKeys(teamDomain: string, cacheTtlMs: number = 3600000): Promise<JsonWebKey[]> {
  // Check cache
  if (cfAccessKeysCache && (Date.now() - cfAccessKeysCache.fetchedAt) < cacheTtlMs) {
    return cfAccessKeysCache.keys;
  }

  try {
    const certsUrl = `https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`;
    const response = await fetch(certsUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch CF Access certs: ${response.status}`);
    }

    const data = await response.json() as { keys: JsonWebKey[] };
    cfAccessKeysCache = {
      keys: data.keys,
      fetchedAt: Date.now(),
    };

    return data.keys;
  } catch (error) {
    logger.error('Failed to fetch Cloudflare Access public keys', { error: String(error) });
    // Return cached keys if available, even if expired
    if (cfAccessKeysCache) {
      return cfAccessKeysCache.keys;
    }
    throw error;
  }
}

/**
 * Verify Cloudflare Access JWT token
 */
async function verifyCloudflareAccessJWT(
  token: string,
  teamDomain: string,
  audience: string,
  cacheTtlMs: number = 3600000
): Promise<{ email: string; sub: string } | null> {
  try {
    // Split the JWT
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    // Decode header to get key ID (kid)
    let header: { alg: string; kid: string };
    try {
      const headerJson = atob(parts[0].replace(/-/g, '+').replace(/_/g, '/'));
      header = JSON.parse(headerJson) as { alg: string; kid: string };
    } catch {
      logger.warn('Invalid JWT header format');
      return null;
    }

    if (header.alg !== 'RS256') {
      logger.warn('Unexpected JWT algorithm', { alg: header.alg });
      return null;
    }

    // Get public keys
    const publicKeys = await getCloudflareAccessPublicKeys(teamDomain, cacheTtlMs);

    // Find the matching key
    const matchingKey = publicKeys.find((key: any) => key.kid === header.kid);
    if (!matchingKey) {
      logger.warn('No matching public key found', { kid: header.kid });
      return null;
    }

    // Import the public key for verification
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      matchingKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // Prepare signature and data for verification
    const signatureBase64 = parts[2].replace(/-/g, '+').replace(/_/g, '/');
    const signature = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);

    // Verify signature
    const isValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      signature,
      data
    );

    if (!isValid) {
      logger.warn('JWT signature verification failed');
      return null;
    }

    // Decode and validate payload
    let payload: {
      aud: string[];
      email: string;
      sub: string;
      iat: number;
      exp: number;
      iss: string;
    };
    try {
      const payloadJson = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
      payload = JSON.parse(payloadJson);
    } catch {
      logger.warn('Invalid JWT payload format');
      return null;
    }

    // Validate expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      logger.warn('JWT token expired');
      return null;
    }

    // Validate issuer
    const expectedIssuer = `https://${teamDomain}.cloudflareaccess.com`;
    if (payload.iss !== expectedIssuer) {
      logger.warn('Invalid JWT issuer', { iss: payload.iss });
      return null;
    }

    // Validate audience
    if (!payload.aud.includes(audience)) {
      logger.warn('Invalid JWT audience', { aud: payload.aud });
      return null;
    }

    return {
      email: payload.email,
      sub: payload.sub,
    };
  } catch (error) {
    logger.error('JWT verification error', { error: String(error) });
    return null;
  }
}

/**
 * Middleware for authenticating regular users via JWT
 */
export async function authMiddleware(c: Context<AppEnv>, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({
      success: false,
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Authentification requise',
      },
      requestId: crypto.randomUUID(),
    }, 401);
  }

  const token = authHeader.substring(7);

  try {
    const authService = new AuthService(c.env.JWT_SECRET);
    const payload = await authService.verifyToken(token);

    if (!payload) {
      return c.json({
        success: false,
        error: {
          code: 'AUTH_INVALID_TOKEN',
          message: 'Token invalide ou expiré',
        },
        requestId: crypto.randomUUID(),
      }, 401);
    }

    if (payload.type !== 'access') {
      return c.json({
        success: false,
        error: {
          code: 'AUTH_INVALID_TOKEN_TYPE',
          message: 'Type de token invalide',
        },
        requestId: crypto.randomUUID(),
      }, 401);
    }

    c.set('userId', payload.sub);
    c.set('userEmail', payload.email);
    c.set('kycLevel', payload.kycLevel);

    await next();
  } catch (error) {
    return c.json({
      success: false,
      error: {
        code: 'AUTH_INVALID_TOKEN',
        message: 'Token invalide ou expiré',
      },
      requestId: crypto.randomUUID(),
    }, 401);
  }
}

/**
 * Middleware for authenticating admin users via Cloudflare Access
 */
export async function adminAuthMiddleware(c: Context<AppEnv>, next: Next) {
  // Cloudflare Access injects these headers
  const cfAccessJwt = c.req.header('Cf-Access-Jwt-Assertion');
  const cfAccessUser = c.req.header('Cf-Access-Authenticated-User-Email');

  if (!cfAccessJwt || !cfAccessUser) {
    return c.json({
      success: false,
      error: {
        code: 'ADMIN_AUTH_REQUIRED',
        message: 'Accès administrateur requis',
      },
      requestId: crypto.randomUUID(),
    }, 401);
  }

  try {
    // Verify Cloudflare Access JWT if configured
    const cfTeamDomain = c.env.CF_ACCESS_TEAM_DOMAIN;
    const cfAudience = c.env.CF_ACCESS_AUDIENCE;

    if (cfTeamDomain && cfAudience) {
      // Load CF keys cache TTL from config (default 1 hour)
      if (cfKeysCacheTtl === null) {
        const configService = new ConfigService(c.env.DB, c.env.CACHE);
        const ttlSeconds = await configService.getNumber('cf_keys_cache_ttl_seconds', 3600);
        cfKeysCacheTtl = ttlSeconds * 1000;
      }
      const jwtPayload = await verifyCloudflareAccessJWT(cfAccessJwt, cfTeamDomain, cfAudience, cfKeysCacheTtl);

      if (!jwtPayload) {
        return c.json({
          success: false,
          error: {
            code: 'ADMIN_AUTH_INVALID_TOKEN',
            message: 'Token Cloudflare Access invalide',
          },
          requestId: crypto.randomUUID(),
        }, 401);
      }

      // Verify email matches
      if (jwtPayload.email !== cfAccessUser) {
        logger.warn('Email mismatch in CF Access', { jwtEmail: jwtPayload.email, headerEmail: cfAccessUser });
        return c.json({
          success: false,
          error: {
            code: 'ADMIN_AUTH_EMAIL_MISMATCH',
            message: 'Email invalide',
          },
          requestId: crypto.randomUUID(),
        }, 401);
      }
    } else if (c.env.ENVIRONMENT === 'production') {
      // In production, CF Access MUST be configured
      logger.error('CF Access not configured in production — rejecting admin request');
      return c.json({
        success: false,
        error: {
          code: 'ADMIN_AUTH_MISCONFIGURED',
          message: 'Cloudflare Access non configuré',
        },
        requestId: crypto.randomUUID(),
      }, 500);
    }
    // In development, trust the headers if CF Access is not configured

    // Check if user email is in admins table
    const admin = await c.env.DB
      .prepare('SELECT * FROM admins WHERE email = ? AND active = 1')
      .bind(cfAccessUser)
      .first();

    if (!admin) {
      return c.json({
        success: false,
        error: {
          code: 'ADMIN_NOT_FOUND',
          message: 'Administrateur non autorisé',
        },
        requestId: crypto.randomUUID(),
      }, 403);
    }

    c.set('adminId', admin.id as string);
    c.set('adminEmail', cfAccessUser);
    c.set('adminRole', admin.role as string);

    await next();
  } catch (error) {
    logger.error('Admin auth error', { error: String(error) });
    return c.json({
      success: false,
      error: {
        code: 'ADMIN_AUTH_FAILED',
        message: 'Authentification administrateur échouée',
      },
      requestId: crypto.randomUUID(),
    }, 401);
  }
}

/**
 * Middleware for State portal (read-only access)
 */
export async function stateAuthMiddleware(c: Context<AppEnv>, next: Next) {
  const cfAccessJwt = c.req.header('Cf-Access-Jwt-Assertion');
  const cfAccessUser = c.req.header('Cf-Access-Authenticated-User-Email');

  if (!cfAccessJwt || !cfAccessUser) {
    return c.json({
      success: false,
      error: {
        code: 'STATE_AUTH_REQUIRED',
        message: 'Accès État requis',
      },
      requestId: crypto.randomUUID(),
    }, 401);
  }

  try {
    // Verify Cloudflare Access JWT if configured
    const cfTeamDomain = c.env.CF_ACCESS_TEAM_DOMAIN;
    const cfAudience = c.env.CF_ACCESS_STATE_AUDIENCE || c.env.CF_ACCESS_AUDIENCE;

    if (cfTeamDomain && cfAudience) {
      // Load CF keys cache TTL from config (default 1 hour)
      if (cfKeysCacheTtl === null) {
        const configService = new ConfigService(c.env.DB, c.env.CACHE);
        const ttlSeconds = await configService.getNumber('cf_keys_cache_ttl_seconds', 3600);
        cfKeysCacheTtl = ttlSeconds * 1000;
      }
      const jwtPayload = await verifyCloudflareAccessJWT(cfAccessJwt, cfTeamDomain, cfAudience, cfKeysCacheTtl);

      if (!jwtPayload) {
        return c.json({
          success: false,
          error: {
            code: 'STATE_AUTH_INVALID_TOKEN',
            message: 'Token Cloudflare Access invalide',
          },
          requestId: crypto.randomUUID(),
        }, 401);
      }

      if (jwtPayload.email !== cfAccessUser) {
        return c.json({
          success: false,
          error: {
            code: 'STATE_AUTH_EMAIL_MISMATCH',
            message: 'Email invalide',
          },
          requestId: crypto.randomUUID(),
        }, 401);
      }
    } else if (c.env.ENVIRONMENT === 'production') {
      logger.error('CF Access not configured in production — rejecting state request');
      return c.json({
        success: false,
        error: {
          code: 'STATE_AUTH_MISCONFIGURED',
          message: 'Cloudflare Access non configuré',
        },
        requestId: crypto.randomUUID(),
      }, 500);
    }

    // Check if user has STATE_OPERATOR role
    const admin = await c.env.DB
      .prepare('SELECT * FROM admins WHERE email = ? AND role = ? AND active = 1')
      .bind(cfAccessUser, 'STATE_OPERATOR')
      .first();

    if (!admin) {
      return c.json({
        success: false,
        error: {
          code: 'STATE_ACCESS_DENIED',
          message: 'Accès État non autorisé',
        },
        requestId: crypto.randomUUID(),
      }, 403);
    }

    c.set('adminId', admin.id as string);
    c.set('adminEmail', cfAccessUser);
    c.set('adminRole', 'STATE_OPERATOR');

    await next();
  } catch (error) {
    logger.error('State auth error', { error: String(error) });
    return c.json({
      success: false,
      error: {
        code: 'STATE_AUTH_FAILED',
        message: 'Authentification État échouée',
      },
      requestId: crypto.randomUUID(),
    }, 401);
  }
}
