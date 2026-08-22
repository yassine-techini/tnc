/**
 * Network layer in front of the privileged portals.
 *
 * This deployment does not use Cloudflare Access, so without this there is no
 * network control at all ahead of the back-office and the government portal —
 * application auth is the only layer. The allowlist is applied BEFORE
 * authentication, login included: an operator-only portal should not be
 * brute-forceable from anywhere in the world just because the credentials are
 * strong.
 *
 * Off by default (empty list). See lib/ip-allowlist for why.
 */
import type { Context, Next } from 'hono';
import type { AppEnv } from '../types/env';
import { ConfigService } from '../services/config.service';
import { isAllowed } from '../lib/ip-allowlist';
import { texte } from '../lib/reponse-erreur';

export function portalAllowlist(configKey: 'admin_ip_allowlist' | 'state_ip_allowlist') {
  return async function middleware(c: Context<AppEnv>, next: Next) {
    const cfg = new ConfigService(c.env.DB, c.env.CACHE);
    const list = await cfg.get(configKey, '');
    if (!list) return next();

    // CF-Connecting-IP is set by Cloudflare and cannot be forged by the client;
    // X-Forwarded-For could be, so it is deliberately not consulted.
    const clientIp = c.req.header('CF-Connecting-IP');

    if (!isAllowed(list, clientIp)) {
      console.warn(`[Allowlist] ${configKey} refused ${clientIp ?? 'unknown IP'} on ${c.req.path}`);
      // 403 rather than 404: hiding the portal from its own operators when they
      // are simply off-network makes the failure impossible to diagnose.
      return c.json({
        success: false,
        error: {
          code: 'IP_NOT_ALLOWED',
          message: texte(c, 'IP_NOT_ALLOWED'),
        },
        requestId: crypto.randomUUID(),
      }, 403);
    }

    return next();
  };
}
