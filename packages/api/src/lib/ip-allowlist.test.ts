import { describe, it, expect } from 'vitest';
import { parseEntry, isAllowed, isEnforced } from './ip-allowlist';

describe('parseEntry', () => {
  it('accepts a bare address and treats it as a single host', () => {
    expect(parseEntry('41.202.10.5')).toMatchObject({ prefix: 32 });
    expect(parseEntry('2001:db8::1')).toMatchObject({ prefix: 128 });
  });

  it('accepts CIDR notation', () => {
    expect(parseEntry('41.202.0.0/16')).toMatchObject({ prefix: 16 });
    expect(parseEntry('2001:db8::/32')).toMatchObject({ prefix: 32 });
  });

  it('rejects malformed entries rather than guessing', () => {
    expect(parseEntry('')).toBeNull();
    expect(parseEntry('not-an-ip')).toBeNull();
    expect(parseEntry('41.202.10')).toBeNull();
    expect(parseEntry('41.202.10.5.6')).toBeNull();
    expect(parseEntry('256.1.1.1')).toBeNull();
    // A prefix wider than the address family is a typo, not a wildcard.
    expect(parseEntry('41.202.10.5/33')).toBeNull();
    expect(parseEntry('41.202.10.5/abc')).toBeNull();
  });

  it('rejects octet forms that could be read two ways', () => {
    // "010" is 8 in octal for some parsers and 10 for others — refuse it.
    expect(parseEntry('41.202.010.5')).toBeNull();
    expect(parseEntry('41.202.+1.5')).toBeNull();
  });
});

describe('isAllowed', () => {
  it('is disabled when the list is empty, so nobody is locked out by accident', () => {
    // With no Zero-Trust console to fall back on, an empty list must not mean
    // "deny everything".
    expect(isAllowed('', '41.202.10.5')).toBe(true);
    expect(isAllowed(null, '41.202.10.5')).toBe(true);
    expect(isAllowed('   ', '41.202.10.5')).toBe(true);
    expect(isEnforced('')).toBe(false);
  });

  it('allows an exact host and refuses its neighbour', () => {
    expect(isAllowed('41.202.10.5', '41.202.10.5')).toBe(true);
    expect(isAllowed('41.202.10.5', '41.202.10.6')).toBe(false);
  });

  it('honours CIDR boundaries exactly', () => {
    const list = '41.202.10.0/24';
    expect(isAllowed(list, '41.202.10.0')).toBe(true);
    expect(isAllowed(list, '41.202.10.255')).toBe(true);
    // One address either side of the block.
    expect(isAllowed(list, '41.202.9.255')).toBe(false);
    expect(isAllowed(list, '41.202.11.0')).toBe(false);
  });

  it('handles a prefix that is not a whole number of bytes', () => {
    // /28 covers .16 through .31 only.
    const list = '10.0.0.16/28';
    expect(isAllowed(list, '10.0.0.16')).toBe(true);
    expect(isAllowed(list, '10.0.0.31')).toBe(true);
    expect(isAllowed(list, '10.0.0.15')).toBe(false);
    expect(isAllowed(list, '10.0.0.32')).toBe(false);
  });

  it('treats /0 as everything, since that is what it means', () => {
    expect(isAllowed('0.0.0.0/0', '198.51.100.7')).toBe(true);
  });

  it('accepts several entries, comma or whitespace separated', () => {
    const list = '41.202.10.0/24, 197.215.0.0/16\n2001:db8::/32';
    expect(isAllowed(list, '41.202.10.9')).toBe(true);
    expect(isAllowed(list, '197.215.4.1')).toBe(true);
    expect(isAllowed(list, '2001:db8:1::5')).toBe(true);
    expect(isAllowed(list, '8.8.8.8')).toBe(false);
  });

  it('never lets an IPv4 rule match an IPv6 client, or the reverse', () => {
    expect(isAllowed('0.0.0.0/0', '2001:db8::1')).toBe(false);
    expect(isAllowed('::/0', '41.202.10.5')).toBe(false);
  });

  it('compares an IPv4-mapped IPv6 client as IPv4', () => {
    // Cloudflare reports some clients this way.
    expect(isAllowed('41.202.10.5', '::ffff:41.202.10.5')).toBe(true);
    expect(isAllowed('41.202.10.0/24', '::ffff:41.202.10.9')).toBe(true);
  });

  it('refuses an unknown or malformed client address while enforcing', () => {
    // If the list is on, an address we cannot read must not slip through —
    // otherwise stripping the header would bypass the allowlist entirely.
    expect(isAllowed('41.202.10.5', null)).toBe(false);
    expect(isAllowed('41.202.10.5', '')).toBe(false);
    expect(isAllowed('41.202.10.5', 'unknown')).toBe(false);
  });

  it('ignores unusable entries instead of widening the rule', () => {
    const list = 'not-an-ip, 41.202.10.5';
    expect(isEnforced(list)).toBe(true);
    expect(isAllowed(list, '41.202.10.5')).toBe(true);
    expect(isAllowed(list, '8.8.8.8')).toBe(false);
  });

  it('stays disabled when every entry is unusable', () => {
    // A list of pure typos must not lock the portal.
    expect(isEnforced('nonsense, also-nonsense')).toBe(false);
    expect(isAllowed('nonsense, also-nonsense', '8.8.8.8')).toBe(true);
  });
});
