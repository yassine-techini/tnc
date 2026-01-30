/**
 * Security Service - Banking-grade security implementations
 * Implements secure-by-design patterns for financial operations
 */

import { ConfigService } from './config.service';

// Default security constants (used when ConfigService is not available)
export const SECURITY_DEFAULTS = {
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_DURATION_MINUTES: 15,
  PROGRESSIVE_LOCKOUT: true,
  PASSWORD_MIN_LENGTH: 12,
  PASSWORD_REQUIRE_UPPERCASE: true,
  PASSWORD_REQUIRE_LOWERCASE: true,
  PASSWORD_REQUIRE_NUMBER: true,
  PASSWORD_REQUIRE_SPECIAL: true,
  PASSWORD_MAX_LENGTH: 128,
  SESSION_TIMEOUT_MINUTES: 15,
  ABSOLUTE_SESSION_TIMEOUT_HOURS: 8,
  TOTP_WINDOW: 1,
  TOTP_ISSUER: 'TNC Trading',
  TRANSACTION_SIGNATURE_VALIDITY_SECONDS: 300,
  HIGH_VALUE_THRESHOLD_XOF: 1_000_000,
  RATE_LIMIT_LOGIN_PER_MINUTE: 5,
  RATE_LIMIT_SENSITIVE_OPS_PER_HOUR: 10,
};

// Re-export for backward compatibility (static defaults)
export const SECURITY_CONFIG = SECURITY_DEFAULTS;

export interface SecurityConfigValues {
  maxLoginAttempts: number;
  lockoutDurationMinutes: number;
  progressiveLockout: boolean;
  passwordMinLength: number;
  passwordMaxLength: number;
  sessionTimeoutMinutes: number;
  absoluteSessionTimeoutHours: number;
  totpWindow: number;
  totpIssuer: string;
  transactionSignatureValiditySeconds: number;
  highValueThresholdXof: number;
  rateLimitLoginPerMinute: number;
  rateLimitSensitiveOpsPerHour: number;
}

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
  strength: 'weak' | 'medium' | 'strong' | 'very_strong';
  score: number;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId?: string;
  adminId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  ipAddress?: string;
  userAgent?: string;
  oldValue?: string;
  newValue?: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  success: boolean;
  failureReason?: string;
}

export class SecurityService {
  private configService: ConfigService;

  constructor(
    private db: D1Database,
    private cache: KVNamespace,
    configService?: ConfigService
  ) {
    this.configService = configService || new ConfigService(db, cache);
  }

  /**
   * Safely parse JSON from cache, returning default value if parsing fails.
   * Prevents crashes from corrupted cache data.
   */
  private safeJsonParse<T>(json: string | null, defaultValue: T): T {
    if (!json) return defaultValue;
    try {
      return JSON.parse(json) as T;
    } catch {
      console.warn('[SecurityService] Failed to parse cached JSON, using default');
      return defaultValue;
    }
  }

  /**
   * Constant-time string comparison to prevent timing attacks.
   * Used for comparing secrets, signatures, and TOTP codes.
   */
  private constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
      // Still do comparison to maintain constant time for equal-length check
      // but result will be false
      const dummy = 'x'.repeat(Math.max(a.length, b.length));
      a = a.padEnd(dummy.length, '\0');
      b = b.padEnd(dummy.length, '\0');
    }
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0 && a.length === b.length;
  }

  /**
   * Load security config values from DB (cached via ConfigService)
   */
  async getSecurityConfig(): Promise<SecurityConfigValues> {
    const [
      maxLoginAttempts,
      lockoutDurationMinutes,
      progressiveLockout,
      passwordMinLength,
      passwordMaxLength,
      sessionTimeoutMinutes,
      absoluteSessionTimeoutHours,
      totpWindow,
      totpIssuer,
      transactionSignatureValiditySeconds,
      highValueThresholdXof,
      rateLimitLoginPerMinute,
      rateLimitSensitiveOpsPerHour,
    ] = await Promise.all([
      this.configService.getNumber('login_max_attempts', SECURITY_DEFAULTS.MAX_LOGIN_ATTEMPTS),
      this.configService.getNumber('lockout_duration_minutes', SECURITY_DEFAULTS.LOCKOUT_DURATION_MINUTES),
      this.configService.getNumber('progressive_lockout', 1),
      this.configService.getNumber('password_min_length', SECURITY_DEFAULTS.PASSWORD_MIN_LENGTH),
      this.configService.getNumber('password_max_length', SECURITY_DEFAULTS.PASSWORD_MAX_LENGTH),
      this.configService.getNumber('session_timeout_minutes', SECURITY_DEFAULTS.SESSION_TIMEOUT_MINUTES),
      this.configService.getNumber('absolute_session_timeout_hours', SECURITY_DEFAULTS.ABSOLUTE_SESSION_TIMEOUT_HOURS),
      this.configService.getNumber('totp_window', SECURITY_DEFAULTS.TOTP_WINDOW),
      this.configService.get('totp_issuer', SECURITY_DEFAULTS.TOTP_ISSUER),
      this.configService.getNumber('transaction_signature_validity_seconds', SECURITY_DEFAULTS.TRANSACTION_SIGNATURE_VALIDITY_SECONDS),
      this.configService.getNumber('high_value_threshold_xof', SECURITY_DEFAULTS.HIGH_VALUE_THRESHOLD_XOF),
      this.configService.getNumber('rate_limit_login_per_minute', SECURITY_DEFAULTS.RATE_LIMIT_LOGIN_PER_MINUTE),
      this.configService.getNumber('rate_limit_sensitive_ops_per_hour', SECURITY_DEFAULTS.RATE_LIMIT_SENSITIVE_OPS_PER_HOUR),
    ]);

    return {
      maxLoginAttempts,
      lockoutDurationMinutes,
      progressiveLockout: progressiveLockout === 1,
      passwordMinLength,
      passwordMaxLength,
      sessionTimeoutMinutes,
      absoluteSessionTimeoutHours,
      totpWindow,
      totpIssuer: totpIssuer || SECURITY_DEFAULTS.TOTP_ISSUER,
      transactionSignatureValiditySeconds,
      highValueThresholdXof,
      rateLimitLoginPerMinute,
      rateLimitSensitiveOpsPerHour,
    };
  }

  // ==========================================
  // PASSWORD SECURITY
  // ==========================================

  /**
   * Validate password against security policy.
   * Accepts optional pre-loaded config to avoid async in synchronous callers.
   */
  validatePassword(password: string, cfg?: SecurityConfigValues): PasswordValidationResult {
    const minLen = cfg?.passwordMinLength ?? SECURITY_DEFAULTS.PASSWORD_MIN_LENGTH;
    const maxLen = cfg?.passwordMaxLength ?? SECURITY_DEFAULTS.PASSWORD_MAX_LENGTH;

    const errors: string[] = [];
    let score = 0;

    // Length checks
    if (password.length < minLen) {
      errors.push(`Le mot de passe doit contenir au moins ${minLen} caractères`);
    } else {
      score += Math.min(password.length / 4, 5);
    }

    if (password.length > maxLen) {
      errors.push(`Le mot de passe ne peut pas dépasser ${maxLen} caractères`);
    }

    // Character type checks
    if (!/[A-Z]/.test(password)) {
      errors.push('Le mot de passe doit contenir au moins une majuscule');
    } else {
      score += 2;
    }

    if (!/[a-z]/.test(password)) {
      errors.push('Le mot de passe doit contenir au moins une minuscule');
    } else {
      score += 2;
    }

    if (!/[0-9]/.test(password)) {
      errors.push('Le mot de passe doit contenir au moins un chiffre');
    } else {
      score += 2;
    }

    if (!/[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\\/`~]/.test(password)) {
      errors.push('Le mot de passe doit contenir au moins un caractère spécial');
    } else {
      score += 3;
    }

    // Check for common patterns (simplified)
    const commonPatterns = ['123456', 'password', 'qwerty', 'azerty', 'admin', '000000'];
    const lowerPassword = password.toLowerCase();
    for (const pattern of commonPatterns) {
      if (lowerPassword.includes(pattern)) {
        errors.push('Le mot de passe contient une séquence trop commune');
        score -= 5;
        break;
      }
    }

    // Check for repeated characters
    if (/(.)\1{2,}/.test(password)) {
      errors.push('Le mot de passe ne doit pas contenir plus de 2 caractères identiques consécutifs');
      score -= 2;
    }

    // Determine strength
    let strength: 'weak' | 'medium' | 'strong' | 'very_strong';
    if (score <= 5) strength = 'weak';
    else if (score <= 10) strength = 'medium';
    else if (score <= 14) strength = 'strong';
    else strength = 'very_strong';

    return {
      valid: errors.length === 0,
      errors,
      strength,
      score: Math.max(0, Math.min(score, 20)),
    };
  }

  /**
   * Check if password has been used recently
   */
  async checkPasswordHistory(userId: string, newPasswordHash: string, historyCount = 5): Promise<boolean> {
    const history = await this.db
      .prepare('SELECT password_hash FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .bind(userId, historyCount)
      .all<{ password_hash: string }>();

    for (const entry of history.results || []) {
      if (entry.password_hash === newPasswordHash) {
        return false; // Password was used recently
      }
    }
    return true;
  }

  /**
   * Add password to history
   */
  async addPasswordToHistory(userId: string, passwordHash: string): Promise<void> {
    await this.db
      .prepare('INSERT INTO password_history (id, user_id, password_hash, created_at) VALUES (?, ?, ?, datetime("now"))')
      .bind(crypto.randomUUID(), userId, passwordHash)
      .run();

    // Keep only last N entries (configurable)
    // SECURITY: Clamp historyCount to safe integer range [1, 100] to prevent SQL injection
    // SQLite LIMIT doesn't support bind parameters, so we validate the value strictly
    const rawHistoryCount = await this.configService.getNumber('password_history_count', 10);
    const historyCount = Math.max(1, Math.min(Math.floor(rawHistoryCount), 100));
    await this.db
      .prepare(`
        DELETE FROM password_history
        WHERE user_id = ? AND id NOT IN (
          SELECT id FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ${historyCount}
        )
      `)
      .bind(userId, userId)
      .run();
  }

  // ==========================================
  // ACCOUNT LOCKOUT
  // ==========================================

  /**
   * Record a failed login attempt
   */
  async recordFailedLogin(identifier: string, ipAddress?: string): Promise<{
    locked: boolean;
    attemptsRemaining: number;
    lockoutUntil?: string;
  }> {
    const cfg = await this.getSecurityConfig();
    const now = Date.now();
    const key = `login_attempts:${identifier}`;

    // Get current attempts from cache (safe parse to handle corrupted data)
    interface LoginAttempts {
      count: number;
      firstAttempt: number;
      lockoutCount: number;
      lastAttempt?: number;
      lockedUntil?: number;
    }
    const cached = await this.cache.get(key);
    let attempts = this.safeJsonParse<LoginAttempts>(cached, { count: 0, firstAttempt: now, lockoutCount: 0 });

    // Reset if first attempt was more than lockout duration ago
    if (now - attempts.firstAttempt > cfg.lockoutDurationMinutes * 60 * 1000) {
      attempts = { count: 0, firstAttempt: now, lockoutCount: attempts.lockoutCount };
    }

    attempts.count++;
    attempts.lastAttempt = now;

    // Check if should lock
    if (attempts.count >= cfg.maxLoginAttempts) {
      // Progressive lockout: double duration for each subsequent lockout
      const lockoutMultiplier = cfg.progressiveLockout
        ? Math.pow(2, attempts.lockoutCount)
        : 1;
      const lockoutDuration = cfg.lockoutDurationMinutes * lockoutMultiplier * 60 * 1000;
      const lockoutUntil = now + lockoutDuration;

      attempts.lockedUntil = lockoutUntil;
      attempts.lockoutCount++;

      await this.cache.put(key, JSON.stringify(attempts), {
        expirationTtl: Math.ceil(lockoutDuration / 1000) + 60
      });

      // Log security event
      await this.logSecurityEvent({
        action: 'ACCOUNT_LOCKED',
        identifier,
        ipAddress,
        details: { attempts: attempts.count, lockoutMinutes: cfg.lockoutDurationMinutes * lockoutMultiplier },
        riskLevel: 'high',
      });

      return {
        locked: true,
        attemptsRemaining: 0,
        lockoutUntil: new Date(lockoutUntil).toISOString(),
      };
    }

    await this.cache.put(key, JSON.stringify(attempts), {
      expirationTtl: cfg.lockoutDurationMinutes * 60 + 60
    });

    return {
      locked: false,
      attemptsRemaining: cfg.maxLoginAttempts - attempts.count,
    };
  }

  /**
   * Check if account is locked
   */
  async isAccountLocked(identifier: string): Promise<{
    locked: boolean;
    lockoutUntil?: string;
    remainingSeconds?: number;
  }> {
    const key = `login_attempts:${identifier}`;
    const cached = await this.cache.get(key);

    if (!cached) {
      return { locked: false };
    }

    const attempts = this.safeJsonParse(cached, { lockedUntil: null });
    if (attempts.lockedUntil && Date.now() < attempts.lockedUntil) {
      return {
        locked: true,
        lockoutUntil: new Date(attempts.lockedUntil).toISOString(),
        remainingSeconds: Math.ceil((attempts.lockedUntil - Date.now()) / 1000),
      };
    }

    return { locked: false };
  }

  /**
   * Clear login attempts after successful login
   */
  async clearLoginAttempts(identifier: string): Promise<void> {
    await this.cache.delete(`login_attempts:${identifier}`);
  }

  // ==========================================
  // AUDIT LOGGING
  // ==========================================

  /**
   * Log a security-sensitive action
   */
  async logAuditEvent(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<string> {
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    await this.db
      .prepare(`
        INSERT INTO audit_logs (
          id, admin_id, user_id, action, entity_type, entity_id,
          old_value, new_value, ip_address, user_agent, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        id,
        entry.adminId || null,
        entry.userId || null,
        entry.action,
        entry.entityType,
        entry.entityId || null,
        entry.oldValue || null,
        entry.newValue || null,
        entry.ipAddress || null,
        entry.userAgent || null,
        timestamp
      )
      .run();

    // For critical events, also store in KV for quick access
    if (entry.riskLevel === 'critical' || entry.riskLevel === 'high') {
      const alertKey = `security_alert:${id}`;
      const alertTtl = this.configService
        ? await this.configService.getNumber('security_alert_cache_ttl', 86400 * 7)
        : 86400 * 7;
      await this.cache.put(alertKey, JSON.stringify({ ...entry, id, timestamp }), {
        expirationTtl: alertTtl,
      });
    }

    return id;
  }

  /**
   * Log security event (for authentication, access control)
   */
  async logSecurityEvent(event: {
    action: string;
    identifier?: string;
    userId?: string;
    ipAddress?: string;
    userAgent?: string;
    details?: object;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
  }): Promise<void> {
    // Store in KV for quick analysis
    const key = `security_event:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
    await this.cache.put(key, JSON.stringify({
      ...event,
      timestamp: new Date().toISOString(),
    }), { expirationTtl: this.configService
      ? await this.configService.getNumber('security_event_cache_ttl', 86400 * 30)
      : 86400 * 30 });

    // For high/critical events, trigger alert (in production, would send to monitoring)
    if (event.riskLevel === 'high' || event.riskLevel === 'critical') {
      console.error('[SECURITY ALERT]', JSON.stringify(event));
    }
  }

  // ==========================================
  // DATA ENCRYPTION
  // ==========================================

  /**
   * Encrypt sensitive data using AES-GCM
   */
  async encryptSensitiveData(data: string, encryptionKey: string): Promise<string> {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);

    // Derive key from encryption key
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(encryptionKey),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      dataBuffer
    );

    // Combine salt + iv + encrypted data
    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);

    return btoa(String.fromCharCode(...combined));
  }

  /**
   * Decrypt sensitive data
   */
  async decryptSensitiveData(encryptedData: string, encryptionKey: string): Promise<string> {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 28);
    const data = combined.slice(28);

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(encryptionKey),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );

    return decoder.decode(decrypted);
  }

  // ==========================================
  // TRANSACTION SECURITY
  // ==========================================

  /**
   * Generate a transaction signature for verification
   */
  async generateTransactionSignature(
    transactionData: {
      userId: string;
      type: string;
      amount: number;
      timestamp: number;
    },
    secretKey: string
  ): Promise<string> {
    const encoder = new TextEncoder();
    const data = JSON.stringify(transactionData);

    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secretKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  }

  /**
   * Verify a transaction signature
   */
  async verifyTransactionSignature(
    transactionData: {
      userId: string;
      type: string;
      amount: number;
      timestamp: number;
    },
    signature: string,
    secretKey: string
  ): Promise<boolean> {
    const cfg = await this.getSecurityConfig();
    // Check timestamp validity
    const now = Date.now();
    if (Math.abs(now - transactionData.timestamp) > cfg.transactionSignatureValiditySeconds * 1000) {
      return false; // Signature expired
    }

    const expectedSignature = await this.generateTransactionSignature(transactionData, secretKey);
    // SECURITY: Use constant-time comparison to prevent timing attacks
    return this.constantTimeEqual(signature, expectedSignature);
  }

  /**
   * Check if transaction requires additional verification
   */
  async isHighValueTransaction(amount: number): Promise<boolean> {
    const cfg = await this.getSecurityConfig();
    return amount >= cfg.highValueThresholdXof;
  }

  // ==========================================
  // RATE LIMITING
  // ==========================================

  /**
   * Check rate limit for sensitive operations
   */
  async checkRateLimit(
    identifier: string,
    operation: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; resetAt: string }> {
    const key = `ratelimit:${operation}:${identifier}`;
    const cached = await this.cache.get(key);

    const now = Date.now();
    let data = this.safeJsonParse(cached, { count: 0, windowStart: now });

    // Reset window if expired
    if (now - data.windowStart > windowSeconds * 1000) {
      data = { count: 0, windowStart: now };
    }

    if (data.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(data.windowStart + windowSeconds * 1000).toISOString(),
      };
    }

    data.count++;
    await this.cache.put(key, JSON.stringify(data), { expirationTtl: windowSeconds + 60 });

    return {
      allowed: true,
      remaining: limit - data.count,
      resetAt: new Date(data.windowStart + windowSeconds * 1000).toISOString(),
    };
  }

  // ==========================================
  // 2FA / TOTP
  // ==========================================

  /**
   * Generate TOTP secret for 2FA setup
   */
  generateTotpSecret(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    return this.base32Encode(bytes);
  }

  /**
   * Generate TOTP code from secret
   */
  async generateTotpCode(secret: string, timestamp?: number): Promise<string> {
    const time = Math.floor((timestamp || Date.now()) / 1000 / 30);
    const timeBuffer = new ArrayBuffer(8);
    const timeView = new DataView(timeBuffer);
    timeView.setBigUint64(0, BigInt(time), false);

    const secretBytes = this.base32Decode(secret);
    const key = await crypto.subtle.importKey(
      'raw',
      secretBytes,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );

    const hmac = await crypto.subtle.sign('HMAC', key, timeBuffer);
    const hmacBytes = new Uint8Array(hmac);

    const offset = hmacBytes[19] & 0x0f;
    const code = (
      ((hmacBytes[offset] & 0x7f) << 24) |
      ((hmacBytes[offset + 1] & 0xff) << 16) |
      ((hmacBytes[offset + 2] & 0xff) << 8) |
      (hmacBytes[offset + 3] & 0xff)
    ) % 1000000;

    return code.toString().padStart(6, '0');
  }

  /**
   * Verify TOTP code
   */
  async verifyTotpCode(secret: string, code: string): Promise<boolean> {
    const cfg = await this.getSecurityConfig();
    const now = Date.now();

    // Check current window and adjacent windows
    // SECURITY: Use constant-time comparison for all checks to prevent timing attacks
    let valid = false;
    for (let i = -cfg.totpWindow; i <= cfg.totpWindow; i++) {
      const checkTime = now + i * 30000;
      const expectedCode = await this.generateTotpCode(secret, checkTime);
      // Always compare all windows to maintain constant time
      if (this.constantTimeEqual(code, expectedCode)) {
        valid = true;
      }
    }

    return valid;
  }

  /**
   * Generate TOTP provisioning URI for authenticator apps
   */
  async generateTotpUri(secret: string, email: string): Promise<string> {
    const cfg = await this.getSecurityConfig();
    const issuer = encodeURIComponent(cfg.totpIssuer);
    const account = encodeURIComponent(email);
    return `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  }

  // Helper methods for base32
  private base32Encode(bytes: Uint8Array): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let result = '';
    let bits = 0;
    let value = 0;

    for (const byte of bytes) {
      value = (value << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        result += alphabet[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }

    if (bits > 0) {
      result += alphabet[(value << (5 - bits)) & 31];
    }

    return result;
  }

  private base32Decode(str: string): Uint8Array {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const bytes: number[] = [];
    let bits = 0;
    let value = 0;

    for (const char of str.toUpperCase()) {
      const idx = alphabet.indexOf(char);
      if (idx === -1) continue;
      value = (value << 5) | idx;
      bits += 5;
      while (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }

    return new Uint8Array(bytes);
  }
}
