-- ============================================
-- 0024 IP allowlist for the privileged portals
-- This deployment does not use Cloudflare Access, so nothing sits in front of
-- the back-office and the government portal: application auth (Argon2id,
-- mandatory TOTP, lockout, portal-bound tokens) is the only layer. These keys
-- restore a network layer, applied before authentication so an operator-only
-- portal is not brute-forceable from anywhere in the world.
--
-- Empty means DISABLED, deliberately: enforcing an empty list would lock out
-- every operator including whoever would fix it, and there is no Zero-Trust
-- console to fall back on. Entries are comma or whitespace separated, each an
-- address or a CIDR block (IPv4 and IPv6).
-- ============================================

INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('admin_ip_allowlist', '', 'IP/CIDR autorisés sur /admin/* — vide = désactivé'),
    ('state_ip_allowlist', '', 'IP/CIDR autorisés sur /state/* — vide = désactivé');
