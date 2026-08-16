#!/usr/bin/env node
/**
 * Configuration readiness, from the terminal.
 *
 * Queries GET /admin/readiness and prints a key-by-key table. It never receives
 * a secret value — the endpoint reports presence only — so this output is safe
 * to paste into a ticket or a chat.
 *
 * Usage:
 *   node scripts/readiness.mjs --url https://api.example.com --token <admin JWT>
 *   node scripts/readiness.mjs --probe        # live read-only checks
 *
 * The token is an admin access token (portal-bound), obtained from
 * POST /api/v1/admin/login. Pass it via TNC_ADMIN_TOKEN rather than on the
 * command line if your shell keeps history.
 */

const args = process.argv.slice(2);

function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const baseUrl = arg('url', process.env.TNC_API_URL || 'http://localhost:8787');
const token = arg('token', process.env.TNC_ADMIN_TOKEN);
const probe = args.includes('--probe');

if (!token) {
  console.error('Jeton admin requis : --token <jwt> ou TNC_ADMIN_TOKEN.');
  console.error('Obtenu via POST /api/v1/admin/login (mot de passe + TOTP).');
  process.exit(2);
}

const STATE = {
  ok: { icon: '✓', label: 'OK', color: '\x1b[32m' },
  partial: { icon: '~', label: 'PARTIEL', color: '\x1b[33m' },
  missing: { icon: '✗', label: 'ABSENT', color: '\x1b[31m' },
  probe_failed: { icon: '!', label: 'ÉCHEC', color: '\x1b[31m' },
  not_probed: { icon: '·', label: 'NON TESTÉ', color: '\x1b[90m' },
};
const RESET = '\x1b[0m';
const DIM = '\x1b[90m';

const url = `${baseUrl.replace(/\/$/, '')}/api/v1/admin/readiness${probe ? '?probe=true' : ''}`;

let payload;
try {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  payload = await response.json();
  if (!response.ok || !payload?.success) {
    console.error(`Échec : ${payload?.error?.message || response.status}`);
    process.exit(1);
  }
} catch (error) {
  console.error(`Impossible de joindre ${url} : ${error.message}`);
  process.exit(1);
}

const { checks, summary, probed, generatedAt } = payload.data;

console.log(`\nÉtat de configuration — ${new Date(generatedAt).toLocaleString('fr-FR')}`);
console.log(probed ? `${DIM}Sondage actif (lecture seule ; aucune passerelle de paiement appelée)${RESET}` : `${DIM}Présence seule — relancer avec --probe pour tester les intégrations${RESET}`);

let currentGroup = null;
const labelWidth = Math.max(...checks.map((c) => c.label.length));

for (const check of checks) {
  if (check.group !== currentGroup) {
    currentGroup = check.group;
    console.log(`\n  ${currentGroup}`);
  }
  const s = STATE[check.state] || STATE.not_probed;
  console.log(
    `    ${s.color}${s.icon}${RESET} ${check.label.padEnd(labelWidth)}  ${s.color}${s.label.padEnd(9)}${RESET}${DIM}${check.detail}${RESET}`
  );
}

console.log(
  `\n  ${summary.ok} OK · ${summary.partial} partiels · ${summary.missing} absents` +
    (summary.failed ? ` · ${summary.failed} en échec` : '') +
    ` (sur ${summary.total})\n`
);

// What a démo would actually be missing.
const blocking = checks.filter((c) => c.state === 'missing' || c.state === 'probe_failed');
if (blocking.length) {
  console.log('  Fonctionnalités non démontrables en l\'état :');
  for (const check of blocking) console.log(`    ${DIM}·${RESET} ${check.impact}`);
  console.log();
}

// Non-zero exit so CI or a pre-demo script can gate on it.
process.exit(blocking.length ? 1 : 0);
