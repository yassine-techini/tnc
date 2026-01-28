/**
 * Auth Service - JWT and password hashing
 */

import * as jose from 'jose';
import { ConfigService } from './config.service';

export interface JwtPayload {
  sub: string;
  email: string;
  kycLevel: 'BASIC' | 'STANDARD' | 'VERIFIED';
  type: 'access' | 'refresh';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
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
   * Hash password using Web Crypto API (PBKDF2)
   */
  private async getPbkdf2Iterations(): Promise<number> {
    if (this.configService) {
      return this.configService.getNumber('password_pbkdf2_iterations', 100000);
    }
    return 100000;
  }

  async hashPassword(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iterations = await this.getPbkdf2Iterations();
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );

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

    const hashArray = new Uint8Array(hash);
    const combined = new Uint8Array(salt.length + hashArray.length);
    combined.set(salt);
    combined.set(hashArray, salt.length);

    return btoa(String.fromCharCode(...combined));
  }

  /**
   * Verify password against stored hash
   */
  async verifyPassword(password: string, storedHash: string): Promise<boolean> {
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
   * Verify and decode JWT token
   */
  async verifyToken(token: string): Promise<JwtPayload | null> {
    try {
      const { payload } = await jose.jwtVerify(token, this.jwtSecret);
      return payload as unknown as JwtPayload;
    } catch {
      return null;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<TokenPair | null> {
    const payload = await this.verifyToken(refreshToken);

    if (!payload || payload.type !== 'refresh') {
      return null;
    }

    return this.generateTokens({
      sub: payload.sub,
      email: payload.email,
      kycLevel: payload.kycLevel,
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
