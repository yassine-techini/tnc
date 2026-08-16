/**
 * The SSL pinning decision, with no platform dependency.
 *
 * Split from `ssl-pinning.ts` on purpose: that module reads the app config
 * through `expo-constants`, which needs a native runtime. The rules — does this
 * certificate match, is this build safe to release — are pure functions taking
 * their inputs as arguments, so the PRODUCTION behaviour can be tested from a
 * dev machine without building a release. That is the behaviour that matters:
 * the dev path is lenient by design.
 */

/** A SHA-256 public key hash in base64, "sha256/" prefixed. */
export type Pin = string;

/** Normalise a hash to the "sha256/BASE64" form the pins are written in. */
export function normalizePin(hash: string): string {
  const trimmed = String(hash).trim();
  return trimmed.startsWith('sha256/') ? trimmed : `sha256/${trimmed}`;
}

/** A SHA-256 in base64 is 43 characters plus '='. Anything else is a typo. */
export const PIN_PATTERN = /^sha256\/[A-Za-z0-9+/]{43}=$/;

export type PinDecisionReason =
  | 'PIN_MATCH'
  | 'PIN_MISMATCH'
  | 'NO_PINS_CONFIGURED'
  | 'NO_PINS_DEV';

/**
 * Validate a server public-key hash against the pins for a host.
 *
 * FAIL-CLOSED: a pinned host with no pins is a misconfigured build, not an open
 * door. Falling back to the system trust store there would make pinning
 * decorative — any device carrying a rogue CA, a corporate proxy or an
 * interception tool, would be trusted again.
 */
export function checkPin(input: {
  host: string;
  certificateHash: string;
  pins: Pin[];
  isDev: boolean;
}): { trusted: boolean; reason: PinDecisionReason } {
  if (input.pins.length === 0) {
    return input.isDev
      ? { trusted: true, reason: 'NO_PINS_DEV' }
      : { trusted: false, reason: 'NO_PINS_CONFIGURED' };
  }

  // Note the asymmetry: dev leniency covers a MISSING configuration, never a
  // WRONG certificate. A mismatch is refused everywhere.
  const received = normalizePin(input.certificateHash);
  const trusted = input.pins.some((pin) => normalizePin(pin) === received);
  return trusted
    ? { trusted: true, reason: 'PIN_MATCH' }
    : { trusted: false, reason: 'PIN_MISMATCH' };
}

/**
 * Is this configuration safe to release?
 *
 * Requires at least TWO pins per host. One pin means the app stops working the
 * day the certificate is rotated — and an app broken by its own security
 * control is how pinning ends up being ripped out after an outage instead of
 * being maintained.
 */
export function pinningReadiness(domains: Record<string, Pin[]>): {
  ready: boolean;
  problems: string[];
} {
  const problems: string[] = [];
  const hosts = Object.keys(domains || {});

  if (hosts.length === 0) {
    problems.push('Aucun domaine épinglé : expo.extra.sslPinning.domains est vide ou absent.');
  }

  for (const host of hosts) {
    const pins = domains[host] ?? [];
    if (pins.length === 0) {
      problems.push(`${host} : aucune empreinte — les requêtes vers cet hôte seront refusées.`);
      continue;
    }
    if (pins.length < 2) {
      problems.push(
        `${host} : une seule empreinte. Ajoutez une empreinte de secours, sinon l'application cassera à la rotation du certificat.`
      );
    }
    if (new Set(pins.map(normalizePin)).size !== pins.length) {
      // Two identical pins look like a backup and are not one.
      problems.push(`${host} : empreintes en double — répéter une empreinte n'est pas une sauvegarde.`);
    }
    for (const pin of pins) {
      if (!PIN_PATTERN.test(normalizePin(pin))) {
        problems.push(`${host} : empreinte mal formée (${String(pin).slice(0, 16)}…).`);
      }
    }
  }

  return { ready: problems.length === 0, problems };
}
