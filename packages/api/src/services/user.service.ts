/**
 * User Service - D1 Database operations for users
 */

export interface UserRow {
  id: string;
  email: string;
  phone: string;
  password_hash: string;
  first_name: string | null;
  last_name: string | null;
  email_verified: number;
  phone_verified: number;
  country: string;
  kyc_level: 'BASIC' | 'STANDARD' | 'VERIFIED';
  kyc_status: 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  two_factor_enabled: number;
  two_factor_secret: string | null;
  failed_login_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export class UserService {
  constructor(private db: D1Database) {}

  async findByEmail(email: string): Promise<UserRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM users WHERE email = ?')
      .bind(email)
      .first<UserRow>();
    return result || null;
  }

  async findByPhone(phone: string): Promise<UserRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM users WHERE phone = ?')
      .bind(phone)
      .first<UserRow>();
    return result || null;
  }

  async findById(id: string): Promise<UserRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(id)
      .first<UserRow>();
    return result || null;
  }

  async findByEmailOrPhone(identifier: string): Promise<UserRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM users WHERE email = ? OR phone = ?')
      .bind(identifier, identifier)
      .first<UserRow>();
    return result || null;
  }

  async create(data: {
    id: string;
    email: string;
    phone: string;
    passwordHash: string;
    country: string;
    firstName?: string;
    lastName?: string;
  }): Promise<UserRow> {
    await this.db
      .prepare(
        `INSERT INTO users (id, email, phone, password_hash, country, first_name, last_name)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(data.id, data.email, data.phone, data.passwordHash, data.country, data.firstName || null, data.lastName || null)
      .run();

    const user = await this.findById(data.id);
    if (!user) throw new Error('Failed to create user');
    return user;
  }

  async updateLastLogin(userId: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
      )
      .bind(userId)
      .run();
  }

  async incrementFailedAttempts(userId: string): Promise<number> {
    await this.db
      .prepare(
        `UPDATE users SET failed_login_attempts = failed_login_attempts + 1, updated_at = datetime('now') WHERE id = ?`
      )
      .bind(userId)
      .run();

    const user = await this.findById(userId);
    return user?.failed_login_attempts || 0;
  }

  async lockAccount(userId: string, durationMinutes: number): Promise<void> {
    await this.db
      .prepare(
        `UPDATE users SET locked_until = datetime('now', '+${durationMinutes} minutes'), updated_at = datetime('now') WHERE id = ?`
      )
      .bind(userId)
      .run();
  }

  async resetFailedAttempts(userId: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, updated_at = datetime('now') WHERE id = ?`
      )
      .bind(userId)
      .run();
  }

  async updateKycStatus(
    userId: string,
    level: 'BASIC' | 'STANDARD' | 'VERIFIED',
    status: 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED'
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE users SET kyc_level = ?, kyc_status = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .bind(level, status, userId)
      .run();
  }

  async verifyEmail(userId: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE users SET email_verified = 1, updated_at = datetime('now') WHERE id = ?`
      )
      .bind(userId)
      .run();
  }

  async verifyPhone(userId: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE users SET phone_verified = 1, updated_at = datetime('now') WHERE id = ?`
      )
      .bind(userId)
      .run();
  }

  async enable2FA(userId: string, secret: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE users SET two_factor_enabled = 1, two_factor_secret = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .bind(secret, userId)
      .run();
  }

  async disable2FA(userId: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL, updated_at = datetime('now') WHERE id = ?`
      )
      .bind(userId)
      .run();
  }
}
