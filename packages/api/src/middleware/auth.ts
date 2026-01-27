import { Context, Next } from 'hono';
import type { Env } from '../types/env';
import { AuthService } from '../services/auth.service';

// Cache for Cloudflare Access public keys
let cfAccessKeysCache: { keys: JsonWebKey[]; fetchedAt: number } | null = null;
const CF_KEYS_CACHE_TTL = 3600000; // 1 hour in ms

/**
 * Fetch Cloudflare Access public keys for JWT verification
 */
async function getCloudflareAccessPublicKeys(teamDomain: string): Promise<JsonWebKey[]> {
  // Check cache
  if (cfAccessKeysCache && (Date.now() - cfAccessKeysCache.fetchedAt) < CF_KEYS_CACHE_TTL) {
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
    console.error('Failed to fetch Cloudflare Access public keys:', error);
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
  audience: string
): Promise<{ email: string; sub: string } | null> {
  try {
    // Split the JWT
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    // Decode header to get key ID (kid)
    const headerJson = atob(parts[0].replace(/-/g, '+').replace(/_/g, '/'));
    const header = JSON.parse(headerJson) as { alg: string; kid: string };

    if (header.alg !== 'RS256') {
      console.warn('Unexpected JWT algorithm:', header.alg);
      return null;
    }

    // Get public keys
    const publicKeys = await getCloudflareAccessPublicKeys(teamDomain);

    // Find the matching key
    const matchingKey = publicKeys.find((key: any) => key.kid === header.kid);
    if (!matchingKey) {
      console.warn('No matching public key found for kid:', header.kid);
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
      console.warn('JWT signature verification failed');
      return null;
    }

    // Decode and validate payload
    const payloadJson = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadJson) as {
      aud: string[];
      email: string;
      sub: string;
      iat: number;
      exp: number;
      iss: string;
    };

    // Validate expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      console.warn('JWT token expired');
      return null;
    }

    // Validate issuer
    const expectedIssuer = `https://${teamDomain}.cloudflareaccess.com`;
    if (payload.iss !== expectedIssuer) {
      console.warn('Invalid JWT issuer:', payload.iss);
      return null;
    }

    // Validate audience
    if (!payload.aud.includes(audience)) {
      console.warn('Invalid JWT audience:', payload.aud);
      return null;
    }

    return {
      email: payload.email,
      sub: payload.sub,
    };
  } catch (error) {
    console.error('JWT verification error:', error);
    return null;
  }
}

/**
 * Middleware for authenticating regular users via JWT
 */
export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
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
export async function adminAuthMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
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
      const jwtPayload = await verifyCloudflareAccessJWT(cfAccessJwt, cfTeamDomain, cfAudience);

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
        console.warn('Email mismatch in CF Access:', jwtPayload.email, 'vs', cfAccessUser);
        return c.json({
          success: false,
          error: {
            code: 'ADMIN_AUTH_EMAIL_MISMATCH',
            message: 'Email invalide',
          },
          requestId: crypto.randomUUID(),
        }, 401);
      }
    }
    // In development or if CF Access is not configured, trust the headers

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

    c.set('adminId', admin.id);
    c.set('adminEmail', cfAccessUser);
    c.set('adminRole', admin.role);

    await next();
  } catch (error) {
    console.error('Admin auth error:', error);
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
export async function stateAuthMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
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
      const jwtPayload = await verifyCloudflareAccessJWT(cfAccessJwt, cfTeamDomain, cfAudience);

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

    c.set('adminId', admin.id);
    c.set('adminEmail', cfAccessUser);
    c.set('adminRole', 'STATE_OPERATOR');

    await next();
  } catch (error) {
    console.error('State auth error:', error);
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
