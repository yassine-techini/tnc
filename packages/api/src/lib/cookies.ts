/**
 * Cookie utilities for secure JWT authentication
 * Uses httpOnly cookies to prevent XSS attacks
 */

import type { Context } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';

// Cookie names
export const ACCESS_TOKEN_COOKIE = 'tnc_access_token';
export const REFRESH_TOKEN_COOKIE = 'tnc_refresh_token';

// Cookie options based on environment
interface CookieConfig {
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
  domain?: string;
}

/**
 * Get cookie configuration based on environment
 */
export function getCookieConfig(environment: string): CookieConfig {
  const isProduction = environment === 'production';
  const isStaging = environment === 'staging';

  return {
    secure: isProduction || isStaging, // HTTPS only in prod/staging
    sameSite: 'Lax', // Allow cross-site GET requests (needed for OAuth redirects)
    // domain is not set - defaults to exact domain match
  };
}

/**
 * Set authentication cookies after login/refresh
 */
export function setAuthCookies(
  c: Context,
  accessToken: string,
  refreshToken: string,
  accessExpiresIn: number, // seconds
  environment: string
): void {
  const config = getCookieConfig(environment);

  // Access token cookie - shorter lived, available to all API paths
  setCookie(c, ACCESS_TOKEN_COOKIE, accessToken, {
    httpOnly: true,
    secure: config.secure,
    sameSite: config.sameSite,
    path: '/',
    maxAge: accessExpiresIn,
  });

  // Refresh token cookie - longer lived, only sent to auth endpoints
  // 7 days for refresh token
  setCookie(c, REFRESH_TOKEN_COOKIE, refreshToken, {
    httpOnly: true,
    secure: config.secure,
    sameSite: config.sameSite,
    path: '/api/v1/auth',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  });
}

/**
 * Clear authentication cookies on logout
 */
export function clearAuthCookies(c: Context, environment: string): void {
  const config = getCookieConfig(environment);

  // Clear access token
  deleteCookie(c, ACCESS_TOKEN_COOKIE, {
    httpOnly: true,
    secure: config.secure,
    sameSite: config.sameSite,
    path: '/',
  });

  // Clear refresh token
  deleteCookie(c, REFRESH_TOKEN_COOKIE, {
    httpOnly: true,
    secure: config.secure,
    sameSite: config.sameSite,
    path: '/api/v1/auth',
  });
}

/**
 * Get access token from cookie or Authorization header
 * Supports both cookie-based and header-based auth for backwards compatibility
 */
export function getAccessToken(c: Context): string | null {
  // First try Authorization header (for mobile apps and explicit auth)
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Fall back to cookie (for web apps)
  const cookieToken = getCookie(c, ACCESS_TOKEN_COOKIE);
  return cookieToken || null;
}

/**
 * Get refresh token from cookie or request body
 * Supports both cookie-based and body-based refresh
 */
export function getRefreshToken(c: Context): string | null {
  // Try cookie first
  const cookieToken = getCookie(c, REFRESH_TOKEN_COOKIE);
  if (cookieToken) {
    return cookieToken;
  }

  return null;
}
