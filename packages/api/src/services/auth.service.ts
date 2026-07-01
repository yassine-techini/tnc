/**
 * Auth Service - JWT and password hashing
 * Uses Argon2id for new password hashes (memory-hard, GPU-resistant)
 * Maintains backward compatibility with legacy PBKDF2 hashes
 */

import * as jose from 'jose';
import argon2 from 'argon2-browser';
import { z } from 'zod';
import { ConfigService } from './config.service';

// Zod schema for JWT payload validation
const JwtPayloadSchema = z.object({
  sub: z.string().uuid(),
  email: z.string().email(),
  kycLevel: z.enum(['BASIC', 'STANDARD', 'VERIFIED']),
  type: z.enum(['access', 'refresh']),
  // Stable session id, carried across token refreshes so a session can be
  // identified deterministically (not by spoofable/NAT-shared IP).
  sid: z.string().optional(),
});

// Hash format prefix to identify algorithm version
const ARGON2_PREFIX = '$argon2id$';

// Argon2id parameters (OWASP recommended)
const ARGON2_CONFIG = {
  type: argon2.ArgonType.Argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,       // 3 iterations
  parallelism: 4,    // 4 parallel threads
  hashLen: 32,       // 256-bit output
};

export interface JwtPayload {
  sub: string;
  email: string;
  kycLevel: 'BASIC' | 'STANDARD' | 'VERIFIED';
  type: 'access' | 'refresh';
  sid?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface PasswordVerifyResult {
  valid: boolean;
  needsRehash: boolean; // True if using legacy PBKDF2 - should upgrade
}

export class AuthService {
  private jwtSecret: Uint8Array;
  private configService: ConfigService | null;

  constructor(jwtSecretString: string, configService?: ConfigService) {
    if (!jwtSecretString) {
      throw new Error('JWT_SECRET is required — cannot start without a signing key');
    }
    this.jwtSecret = new TextEncoder().encode(jwtSecretString);
    this.configService = configService || null;
  }

  /**
   * Hash password using Argon2id (recommended for new hashes)
   * Format: $argon2id$<base64-encoded-salt>$<base64-encoded-hash>
   */
  async hashPassword(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));

    const result = await argon2.hash({
      pass: password,
      salt,
      ...ARGON2_CONFIG,
    });

    // Return with prefix for algorithm identification
    const saltBase64 = btoa(String.fromCharCode(...salt));
    const hashBase64 = btoa(String.fromCharCode(...result.hash));
    return `${ARGON2_PREFIX}${saltBase64}$${hashBase64}`;
  }

  /**
   * Legacy PBKDF2 hashing (for backward compatibility during migration)
   */
  private async getPbkdf2Iterations(): Promise<number> {
    if (this.configService) {
      return this.configService.getNumber('password_pbkdf2_iterations', 100000);
    }
    return 100000;
  }

  private async verifyPbkdf2Password(password: string, storedHash: string): Promise<boolean> {
    try {
      const combined = Uint8Array.from(atob(storedHash), (c) => c.charCodeAt(0));
      const salt = combined.slice(0, 16);
      const originalHash = combined.slice(16);

      const passwordKey = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
      );

      const iterations = await this.getPbkdf2Iterations();
      const hash = await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt,
          iterations,
          hash: 'SHA-256',
        },
        passwordKey,
        256
      );

      const newHash = new Uint8Array(hash);

      if (originalHash.length !== newHash.length) return false;

      // Constant-time comparison
      let isEqual = true;
      for (let i = 0; i < originalHash.length; i++) {
        if (originalHash[i] !== newHash[i]) isEqual = false;
      }
      return isEqual;
    } catch {
      return false;
    }
  }

  /**
   * Verify password against stored hash (supports both Argon2id and legacy PBKDF2)
   * Returns { valid, needsRehash } - needsRehash=true means caller should upgrade hash
   */
  async verifyPasswordWithRehashCheck(password: string, storedHash: string): Promise<PasswordVerifyResult> {
    // Detect hash algorithm by prefix
    if (storedHash.startsWith(ARGON2_PREFIX)) {
      // Modern Argon2id hash
      const valid = await this.verifyArgon2Password(password, storedHash);
      return { valid, needsRehash: false };
    } else {
      // Legacy PBKDF2 hash - verify and flag for upgrade
      const valid = await this.verifyPbkdf2Password(password, storedHash);
      return { valid, needsRehash: valid }; // Only rehash if valid
    }
  }

  /**
   * Simple password verification (backward-compatible API)
   */
  async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const result = await this.verifyPasswordWithRehashCheck(password, storedHash);
    return result.valid;
  }

  /**
   * Verify Argon2id password hash
   */
  private async verifyArgon2Password(password: string, storedHash: string): Promise<boolean> {
    try {
      // Parse: $argon2id$<saltBase64>$<hashBase64>
      const parts = storedHash.slice(ARGON2_PREFIX.length).split('$');
      if (parts.length !== 2) return false;

      const salt = Uint8Array.from(atob(parts[0]), (c) => c.charCodeAt(0));
      const originalHash = Uint8Array.from(atob(parts[1]), (c) => c.charCodeAt(0));

      const result = await argon2.hash({
        pass: password,
        salt,
        ...ARGON2_CONFIG,
      });

      // Constant-time comparison
      if (originalHash.length !== result.hash.length) return false;
      let isEqual = true;
      for (let i = 0; i < originalHash.length; i++) {
        if (originalHash[i] !== result.hash[i]) isEqual = false;
      }
      return isEqual;
    } catch {
      return false;
    }
  }

  /**
   * Generate JWT token pair
   */
  async generateTokens(payload: Omit<JwtPayload, 'type'>): Promise<TokenPair> {
    const accessExpiry = this.configService
      ? await this.configService.get('access_token_expiry', '15m')
      : '15m';
    const refreshExpiry = this.configService
      ? await this.configService.get('refresh_token_expiry', '7d')
      : '7d';
    const expiresInSeconds = this.configService
      ? await this.configService.getNumber('access_token_expiry_seconds', 900)
      : 900;

    const accessToken = await new jose.SignJWT({ ...payload, type: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(accessExpiry!)
      .setSubject(payload.sub)
      .sign(this.jwtSecret);

    const refreshToken = await new jose.SignJWT({ ...payload, type: 'refresh' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(refreshExpiry!)
      .setSubject(payload.sub)
      .sign(this.jwtSecret);

    return {
      accessToken,
      refreshToken,
      expiresIn: expiresInSeconds,
    };
  }

  /**
   * Verify and decode JWT token with full payload validation
   */
  async verifyToken(token: string): Promise<JwtPayload | null> {
    try {
      const { payload } = await jose.jwtVerify(token, this.jwtSecret);

      // SECURITY: Validate payload structure to prevent type confusion attacks
      const result = JwtPayloadSchema.safeParse(payload);
      if (!result.success) {
        console.warn('[AuthService] Invalid JWT payload structure:', result.error.issues);
        return null;
      }

      // Safe cast: Zod has validated the structure matches JwtPayload
      return result.data as JwtPayload;
    } catch {
      return null;
    }
  }

  /**
   * Refresh access token using refresh token.
   *
   * @param invalidBefore Optional ISO timestamp; refresh tokens issued before
   *   this instant are rejected. This is the per-user "token epoch" set on
   *   logout / password reset, giving immediate revocation of all previously
   *   issued refresh tokens without per-token storage.
   */
  async refreshAccessToken(refreshToken: string, invalidBefore?: string | null): Promise<TokenPair | null> {
    let rawPayload: jose.JWTPayload;
    try {
      ({ payload: rawPayload } = await jose.jwtVerify(refreshToken, this.jwtSecret));
    } catch {
      return null;
    }

    const parsed = JwtPayloadSchema.safeParse(rawPayload);
    if (!parsed.success || parsed.data.type !== 'refresh') {
      return null;
    }

    // Reject tokens issued before the user's invalidation epoch.
    if (invalidBefore && typeof rawPayload.iat === 'number') {
      const issuedAtMs = rawPayload.iat * 1000;
      const epochMs = new Date(invalidBefore).getTime();
      if (!Number.isNaN(epochMs) && issuedAtMs < epochMs) {
        return null;
      }
    }

    return this.generateTokens({
      sub: parsed.data.sub,
      email: parsed.data.email,
      kycLevel: parsed.data.kycLevel,
      sid: parsed.data.sid, // preserve session id across refresh
    });
  }

  /**
   * Generate a random verification code
   */
  generateVerificationCode(length = 6): string {
    const chars = '0123456789';
    let code = '';
    const randomBytes = crypto.getRandomValues(new Uint8Array(length));
    for (let i = 0; i < length; i++) {
      code += chars[randomBytes[i] % chars.length];
    }
    return code;
  }

  /**
   * Generate a secure random session ID
   */
  generateSessionId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
