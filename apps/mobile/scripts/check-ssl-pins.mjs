#!/usr/bin/env node
/**
 * Refuse a release build whose SSL pins are not usable.
 *
 * Pinning fails closed: a release build with no pins for a pinned host refuses
 * that host, so the app simply does not work. That must be a build failure, not
 * something discovered by users on release day — which is what this script is
 * for. Run it before `eas build`.
 *
 * It also rejects a host with a single pin. One pin means the app breaks the day
 * the certificate rotates, and an app broken by its own security control is how
 * pinning ends up being removed after an outage instead of maintained.
 *
 * Usage:
 *   node scripts/check-ssl-pins.mjs            # checks app.json
 *   node scripts/check-ssl-pins.mjs --json     # machine-readable
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appJsonPath = path.join(here, '..', 'app.json');

const PIN_PATTERN = /^sha256\/[A-Za-z0-9+/]{43}=$/;

function normalize(pin) {
  const trimmed = String(pin).trim();
  return trimmed.startsWith('sha256/') ? trimmed : `sha256/${trimmed}`;
}

export function checkDomains(domains) {
  const problems = [];
  const hosts = Object.keys(domains || {});

  if (hosts.length === 0) {
    problems.push('expo.extra.sslPinning.domains is empty or missing — nothing is pinned.');
    return { ready: false, problems, hosts };
  }

  for (const host of hosts) {
    const pins = domains[host] || [];
    if (pins.length === 0) {
      problems.push(`${host}: no pins — a release build will refuse every request to this host.`);
      continue;
    }
    if (pins.length < 2) {
      problems.push(
        `${host}: only one pin. Add a backup pin, or the app breaks the day the certificate is rotated.`
      );
    }
    for (const pin of pins) {
      if (!PIN_PATTERN.test(normalize(pin))) {
        problems.push(`${host}: malformed pin ${String(pin).slice(0, 20)}… (expected sha256/<44 chars base64>).`);
      }
    }
    if (new Set(pins.map(normalize)).size !== pins.length) {
      // Two identical pins look like a backup and are not one.
      problems.push(`${host}: duplicate pins — a repeated pin is not a backup pin.`);
    }
  }

  return { ready: problems.length === 0, problems, hosts };
}

function main() {
  const json = process.argv.includes('--json');
  let domains;
  try {
    const config = JSON.parse(readFileSync(appJsonPath, 'utf8'));
    domains = config?.expo?.extra?.sslPinning?.domains;
  } catch (error) {
    console.error(`Cannot read ${appJsonPath}: ${error.message}`);
    process.exit(1);
  }

  const result = checkDomains(domains);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ready) {
    console.log(`SSL pinning OK — ${result.hosts.length} host(s) pinned:`);
    for (const host of result.hosts) console.log(`  - ${host} (${domains[host].length} pins)`);
  } else {
    console.error('SSL pinning NOT ready for release:');
    for (const problem of result.problems) console.error(`  - ${problem}`);
    console.error('\nSee lib/ssl-pinning.ts for how the pins are read and enforced.');
  }

  process.exit(result.ready ? 0 : 1);
}

// Only run when invoked directly, so the check can also be imported by tests.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
