/**
 * Country configuration.
 *
 * The seeds are read from the real migration file, not re-declared here: a test
 * asserting against its own copy of the data proves nothing about what ships.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CountryConfigService,
  enabledPaymentMethods,
  isServiceable,
  FALLBACK_COUNTRY,
} from '../../src/services/country-config.service';
import { createTestD1, type TestD1 } from '../helpers/real-d1';

const asD1 = (db: TestD1) => db as unknown as D1Database;

const MIGRATION = readFileSync(
  path.join(__dirname, '../../migrations/0031_country_config.sql'),
  'utf8'
);

describe('CountryConfigService (real D1, real seed)', () => {
  let db: TestD1;
  let svc: CountryConfigService;

  beforeEach(() => {
    db = createTestD1();
    db.exec(MIGRATION);
    svc = new CountryConfigService(asD1(db));
  });

  it('serves Burkina Faso as configured today', async () => {
    const bf = await svc.get('BF');
    expect(bf).toMatchObject({
      code: 'BF',
      currency: 'XOF',
      currencySymbol: 'FCFA',
      currencyDecimals: 0, // XOF has no minor unit; centimes would be a fiction
      phonePrefix: '+226',
      certificatePrefix: 'BF',
      enabled: true,
    });
    expect(bf!.idDocumentTypes).toContain('CNIB');
  });

  it('describes Uganda with its own currency, documents and providers', async () => {
    const ug = await svc.get('UG');
    expect(ug).toMatchObject({
      code: 'UG',
      currency: 'UGX',
      currencySymbol: 'USh',
      phonePrefix: '+256',
      certificatePrefix: 'UG',
      locale: 'en-UG',
    });
    // Ugandan documents, not a translated CNIB.
    expect(ug!.idDocumentTypes).toEqual([
      'NATIONAL_ID',
      'PASSPORT',
      'DRIVING_PERMIT',
      'REFUGEE_ID',
    ]);
    expect(ug!.paymentMethods.map((m) => m.id)).toEqual(['mtn_momo', 'airtel_money', 'bank']);
  });

  it('does not pretend Uganda can take a payment', async () => {
    const ug = (await svc.get('UG'))!;
    // No adapter exists for MTN MoMo or Airtel Money. Saying so here is what
    // stops the gap being discovered during a demo.
    expect(enabledPaymentMethods(ug)).toHaveLength(0);
    expect(isServiceable(ug)).toBe(false);
  });

  it('treats a country as serviceable only if it can actually be paid', async () => {
    const bf = (await svc.get('BF'))!;
    expect(isServiceable(bf)).toBe(true);

    // Flipping the flag by hand must not open a country with no working
    // provider — the check is deliberately stricter than the column.
    db.sqlite.prepare("UPDATE country_config SET enabled = 1 WHERE code = 'UG'").run();
    expect(isServiceable((await svc.get('UG'))!)).toBe(false);
  });

  it('ships the UEMOA countries disabled — a shared currency is not a licence', async () => {
    for (const code of ['CI', 'ML', 'SN']) {
      const row = await svc.get(code);
      expect(row, code).not.toBeNull();
      expect(row!.currency).toBe('XOF');
      expect(row!.enabled, code).toBe(false);
    }
  });

  it('gives every country its own certificate prefix', async () => {
    const all = await svc.list();
    const prefixes = all.map((c) => c.certificatePrefix);
    // Two countries sharing a prefix would make verification codes ambiguous.
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('is case- and whitespace-insensitive on the code', async () => {
    expect((await svc.get('bf'))?.code).toBe('BF');
    expect((await svc.get('  ug  '))?.code).toBe('UG');
  });

  it('returns null for a country that is not configured', async () => {
    expect(await svc.get('ZZ')).toBeNull();
  });

  it('falls back to the default country rather than to a blank configuration', async () => {
    // `default_country` is seeded by the migration itself — asserting on it
    // here is asserting on what ships.
    // A blank config would leave a certificate with no prefix and a form with
    // no dialling code.
    const unknown = await svc.forUser('ZZ');
    expect(unknown.code).toBe('BF');
    expect(await svc.forUser(null)).toMatchObject({ code: 'BF' });
    expect((await svc.forUser('UG')).code).toBe('UG');
  });

  it('still answers when the table itself is empty', async () => {
    db.sqlite.prepare('DELETE FROM country_config').run();
    expect(await svc.forUser('BF')).toEqual(FALLBACK_COUNTRY);
  });

  it('survives a malformed JSON column instead of failing the request', async () => {
    db.sqlite
      .prepare("UPDATE country_config SET payment_methods = 'not json' WHERE code = 'BF'")
      .run();

    const bf = await svc.get('BF');
    expect(bf!.paymentMethods).toEqual([]);
    // And the consequence is refusing to serve, not serving with no checks.
    expect(isServiceable(bf!)).toBe(false);
  });

  it('lists enabled countries first, and only them when asked', async () => {
    expect((await svc.list(true)).map((c) => c.code)).toEqual(['BF']);
    expect((await svc.list())[0].code).toBe('BF');
    expect((await svc.list()).length).toBe(5);
  });
});
