/**
 * IP allowlist for the privileged portals.
 *
 * Cloudflare Access is not used on this deployment, so nothing sits in front of
 * the back-office and the government portal: application auth (Argon2id +
 * mandatory TOTP + lockout + portal-bound tokens) is the ONLY layer. An
 * allowlist restores a network layer in front of it, which is what a back-office
 * with a known set of operators can realistically enforce.
 *
 * Deliberately off when the list is empty. Enforcing an empty list would lock
 * out every operator including the one who would fix it, and with no Zero-Trust
 * console to fall back on there would be no way back in.
 */

export interface ParsedEntry {
  /** Normalised address bytes. */
  bytes: Uint8Array;
  /** Prefix length in bits. */
  prefix: number;
}

/** Parse "a.b.c.d", "a.b.c.d/n", or a plain IPv6 address. Returns null if unusable. */
export function parseEntry(raw: string): ParsedEntry | null {
  const entry = raw.trim();
  if (!entry) return null;

  const slash = entry.lastIndexOf('/');
  const addressPart = slash === -1 ? entry : entry.slice(0, slash);
  const prefixPart = slash === -1 ? null : entry.slice(slash + 1);

  const bytes = parseAddress(addressPart);
  if (!bytes) return null;

  const maxPrefix = bytes.length * 8;
  let prefix = maxPrefix;
  if (prefixPart !== null) {
    if (!/^\d{1,3}$/.test(prefixPart)) return null;
    prefix = Number(prefixPart);
    if (prefix > maxPrefix) return null;
  }

  return { bytes, prefix };
}

/** IPv4 dotted-quad or IPv6 (including compressed and IPv4-mapped forms). */
function parseAddress(address: string): Uint8Array | null {
  if (address.includes(':')) return parseIPv6(address);
  return parseIPv4(address);
}

function parseIPv4(address: string): Uint8Array | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const part = parts[i];
    // Only plain decimal octets. Leading zeros are rejected on purpose: "010"
    // is 8 to an octal-aware parser and 10 to this one, and an allowlist entry
    // that two tools read differently is a hole.
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes[i] = value;
  }
  return bytes;
}

function parseIPv6(address: string): Uint8Array | null {
  // An IPv4-mapped tail ("::ffff:1.2.3.4") is compared as IPv4, which is how
  // Cloudflare reports such clients.
  const lastColon = address.lastIndexOf(':');
  const tail = address.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    const head = address.slice(0, lastColon + 1);
    // Only the mapped/compatible forms collapse to IPv4.
    if (/^::(ffff:)?$/i.test(head)) return v4;
    return null;
  }

  const halves = address.split('::');
  if (halves.length > 2) return null;

  const toGroups = (s: string): number[] | null => {
    if (!s) return [];
    const groups: number[] = [];
    for (const g of s.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      groups.push(parseInt(g, 16));
    }
    return groups;
  };

  const head = toGroups(halves[0]);
  const tailGroups = halves.length === 2 ? toGroups(halves[1]) : [];
  if (!head || !tailGroups) return null;

  let groups: number[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tailGroups.length;
    if (missing < 0) return null;
    groups = [...head, ...new Array(missing).fill(0), ...tailGroups];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    bytes[i * 2] = groups[i] >> 8;
    bytes[i * 2 + 1] = groups[i] & 0xff;
  }
  return bytes;
}

/** Whether an address falls inside a parsed entry. */
export function matches(entry: ParsedEntry, address: Uint8Array): boolean {
  // An IPv4 rule never matches an IPv6 client, and vice versa.
  if (entry.bytes.length !== address.length) return false;

  const fullBytes = entry.prefix >> 3;
  for (let i = 0; i < fullBytes; i++) {
    if (entry.bytes[i] !== address[i]) return false;
  }

  const remainingBits = entry.prefix & 7;
  if (remainingBits === 0) return true;

  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (entry.bytes[fullBytes] & mask) === (address[fullBytes] & mask);
}

/**
 * Whether `clientIp` is allowed by `list` (comma or whitespace separated).
 *
 * An empty or fully unparseable list means the allowlist is OFF and everything
 * is allowed — see the note at the top. A list with at least one usable entry is
 * enforced, and unparseable entries in it are ignored rather than silently
 * widening the rule.
 */
export function isAllowed(list: string | null | undefined, clientIp: string | null | undefined): boolean {
  const entries = (list || '')
    .split(/[\s,]+/)
    .map(parseEntry)
    .filter((e): e is ParsedEntry => e !== null);

  if (entries.length === 0) return true; // allowlist disabled

  const address = clientIp ? parseAddress(clientIp.trim()) : null;
  // The list is active but the caller's address is unknown or malformed: refuse.
  // Guessing here would defeat the point of having a list at all.
  if (!address) return false;

  return entries.some((entry) => matches(entry, address));
}

/** Whether a list would actually be enforced (has at least one usable entry). */
export function isEnforced(list: string | null | undefined): boolean {
  return (list || '')
    .split(/[\s,]+/)
    .some((raw) => parseEntry(raw) !== null);
}
