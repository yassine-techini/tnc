/**
 * Session Cleanup Job
 * Removes expired sessions and cleanup old data
 */

import type { Env } from '../../types/env';
import { ConfigService } from '../../services/config.service';
import { ACTIONS_PERMANENTES } from '../../lib/audit-actions';

export async function cleanupExpiredSessions(env: Env, ctx: ExecutionContext): Promise<void> {
  console.log('[SessionCleanup] Starting session cleanup');

  try {
    const configService = new ConfigService(env.DB, env.CACHE);

    // Load retention periods from config (in days)
    const [
      verificationCodeRetentionHours,
      recoveryCodeRetentionDays,
      notificationRetentionDays,
      auditLogRetentionDays,
    ] = await Promise.all([
      configService.getNumber('cleanup_verification_code_hours', 24),
      configService.getNumber('cleanup_recovery_code_days', 30),
      configService.getNumber('cleanup_notification_days', 90),
      configService.getNumber('cleanup_audit_log_days', 365),
    ]);

    // 1. Delete expired sessions
    const expiredSessions = await env.DB.prepare(`
      DELETE FROM sessions
      WHERE expires_at < datetime('now')
      RETURNING id
    `).all();

    const sessionCount = expiredSessions.results?.length || 0;
    console.log(`[SessionCleanup] Deleted ${sessionCount} expired sessions`);

    // 2. Delete old verification codes (expired + older than configured hours)
    const expiredCodes = await env.DB.prepare(`
      DELETE FROM verification_codes
      WHERE expires_at < datetime('now')
        OR (used = 1 AND created_at < datetime('now', '-' || ? || ' hours'))
      RETURNING id
    `).bind(verificationCodeRetentionHours).all();

    const codeCount = expiredCodes.results?.length || 0;
    console.log(`[SessionCleanup] Deleted ${codeCount} expired verification codes`);

    // 3. Clean up used recovery codes older than configured days
    const usedRecoveryCodes = await env.DB.prepare(`
      DELETE FROM recovery_codes
      WHERE used = 1 AND used_at < datetime('now', '-' || ? || ' days')
      RETURNING id
    `).bind(recoveryCodeRetentionDays).all();

    const recoveryCount = usedRecoveryCodes.results?.length || 0;
    console.log(`[SessionCleanup] Deleted ${recoveryCount} used recovery codes`);

    // 4. Delete old read notifications (older than configured days)
    const oldNotifications = await env.DB.prepare(`
      DELETE FROM notifications
      WHERE read = 1 AND read_at < datetime('now', '-' || ? || ' days')
      RETURNING id
    `).bind(notificationRetentionDays).all();

    const notifCount = oldNotifications.results?.length || 0;
    console.log(`[SessionCleanup] Deleted ${notifCount} old notifications`);

    // 5. Clean up old audit logs (older than configured days, except critical actions)
    // DERIVEE du registre, jamais recopiee (ADR 014). La liste ecrite a la main
    // ici contenait `KYC_APPROVED`, `WITHDRAWAL_APPROVED` et `STOCK_ADJUSTED` ;
    // les routes ecrivaient `KYC_APPROVE`, `WITHDRAWAL_APPROVE`, `STOCK_ADJUST`.
    // Une entree sur six protegeait quelque chose, et personne ne pouvait le voir
    // — la purge s'executait sans erreur, en emportant ce qu'elle devait garder.
    const criticalActions = ACTIONS_PERMANENTES;

    const oldAuditLogs = await env.DB.prepare(`
      DELETE FROM audit_logs
      WHERE created_at < datetime('now', '-' || ? || ' days')
        AND action NOT IN (${criticalActions.map(() => '?').join(', ')})
      RETURNING id
    `).bind(auditLogRetentionDays, ...criticalActions).all();

    const auditCount = oldAuditLogs.results?.length || 0;
    console.log(`[SessionCleanup] Deleted ${auditCount} old audit logs`);

    // 6. Unlock accounts that have passed their lockout period
    const unlockedAccounts = await env.DB.prepare(`
      UPDATE users
      SET failed_login_attempts = 0, locked_until = NULL
      WHERE locked_until IS NOT NULL AND locked_until < datetime('now')
    `).run();

    console.log(`[SessionCleanup] Unlocked ${unlockedAccounts.meta?.changes || 0} accounts`);

    // 7. Remove suspended users' temporary suspensions that have expired
    const unsuspendedUsers = await env.DB.prepare(`
      UPDATE users
      SET suspended = 0, suspended_at = NULL, suspended_until = NULL, suspension_reason = NULL
      WHERE suspended = 1
        AND suspended_until IS NOT NULL
        AND suspended_until < datetime('now')
    `).run();

    console.log(`[SessionCleanup] Auto-unsuspended ${unsuspendedUsers.meta?.changes || 0} users`);

    // Log summary
    const summary = {
      sessions: sessionCount,
      verificationCodes: codeCount,
      recoveryCodes: recoveryCount,
      notifications: notifCount,
      auditLogs: auditCount,
      unlockedAccounts: unlockedAccounts.meta?.changes || 0,
      unsuspendedUsers: unsuspendedUsers.meta?.changes || 0,
    };

    await env.DB.prepare(`
      INSERT INTO audit_logs (id, action, entity_type, new_value, created_at)
      VALUES (?, 'SESSION_CLEANUP', 'SYSTEM', ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      JSON.stringify(summary)
    ).run();

    console.log('[SessionCleanup] Cleanup completed', summary);

  } catch (error) {
    console.error('[SessionCleanup] Error:', error);
    throw error;
  }
}
