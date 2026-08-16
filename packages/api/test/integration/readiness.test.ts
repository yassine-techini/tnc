/**
 * Configuration readiness.
 *
 * Two properties matter more than the rest and are pinned here: the report never
 * carries a secret value, and a readiness check never calls a payment gateway.
 * A diagnostic that leaks the keys it audits, or that charges a merchant account
 * as a side effect, would be worse than having none.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ReadinessService } from '../../src/services/readiness.service';
import { createTestD1, type TestD1 } from '../helpers/real-d1';

const SECRET = 'sk_live_THIS_MUST_NEVER_APPEAR_IN_THE_REPORT';

function makeEnv(db: TestD1, overrides: Record<string, unknown> = {}) {
  return {
    DB: db as unknown as D1Database,
    CACHE: {
      get: async () => null,
      put: async () => undefined,
      delete: async () => undefined,
    } as unknown as KVNamespace,
    ...overrides,
  };
}

describe('ReadinessService', () => {
  let db: TestD1;

  beforeEach(() => {
    // `config` now comes from the shared harness schema.
    db = createTestD1();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never returns a secret value, only its presence', async () => {
    const env = makeEnv(db, {
      GOLD_API_KEY: SECRET,
      ENCRYPTION_KEY: SECRET,
      RESEND_API_KEY: SECRET,
      ATTESTATION_SIGNING_JWK: SECRET,
      STRIPE_SECRET_KEY: SECRET,
    });

    const report = await new ReadinessService(env).report(false);
    const serialized = JSON.stringify(report);

    expect(serialized).not.toContain(SECRET);
    // And the keys that were present are reported as such.
    expect(report.checks.find((c) => c.key === 'gold_api')?.state).toBe('ok');
    expect(report.checks.find((c) => c.key === 'encryption_key')?.state).toBe('ok');
  });

  it('reports a missing key with the feature it disables', async () => {
    const report = await new ReadinessService(makeEnv(db)).report(false);

    const fcm = report.checks.find((c) => c.key === 'fcm');
    expect(fcm).toMatchObject({ state: 'missing' });
    expect(fcm!.impact).toMatch(/push/i);

    const encryption = report.checks.find((c) => c.key === 'encryption_key');
    expect(encryption!.impact).toMatch(/document/i);
  });

  it('resolves a key from the config table as well as from a secret', async () => {
    db.sqlite.prepare("INSERT INTO config (key, value) VALUES ('gold_api_key', 'from-config')").run();

    // Config only, no env secret: still satisfied — that is how every service
    // in this codebase resolves its keys.
    const report = await new ReadinessService(makeEnv(db)).report(false);
    expect(report.checks.find((c) => c.key === 'gold_api')?.state).toBe('ok');
  });

  it('flags a partially configured provider rather than calling it complete', async () => {
    // Twilio needs three values; two is not "configured".
    const env = makeEnv(db, { TWILIO_ACCOUNT_SID: 'a', TWILIO_AUTH_TOKEN: 'b' });
    const report = await new ReadinessService(env).report(false);

    const sms = report.checks.find((c) => c.key === 'sms');
    expect(sms).toMatchObject({ state: 'partial' });
    expect(sms!.detail).toContain('2/3');
  });

  it('treats a single email provider as partial — no fallback left', async () => {
    const report = await new ReadinessService(makeEnv(db, { RESEND_API_KEY: 'x' })).report(false);
    expect(report.checks.find((c) => c.key === 'email')?.state).toBe('partial');
  });

  it('NEVER probes a payment gateway, even when probing is requested', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    const env = makeEnv(db, {
      STRIPE_SECRET_KEY: 'sk',
      STRIPE_WEBHOOK_SECRET: 'wh',
      ORANGE_MONEY_API_KEY: 'k',
      ORANGE_MONEY_MERCHANT_ID: 'm',
      CINETPAY_API_KEY: 'k',
      CINETPAY_SITE_ID: 's',
    });
    await new ReadinessService(env).report(true);

    // Whatever else was probed, nothing hit a payment provider.
    const called = fetchMock.mock.calls.map(([url]) => String(url));
    for (const url of called) {
      expect(url).not.toMatch(/stripe|orange|moov|cinetpay/i);
    }
    // And the providers are still declared probe-free.
    const report = await new ReadinessService(env).report(true);
    for (const key of ['stripe', 'orange_money', 'moov_money', 'cinetpay']) {
      expect(report.checks.find((c) => c.key === key)?.probeable).toBe(false);
    }
  });

  it('does not probe at all unless asked', async () => {
    // Mocked, not merely spied: a bare spy CALLS THROUGH, so a regression that
    // starts probing would hit the real network instead of failing the
    // assertion — which is how this suite once failed on a flaky connection.
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('no network call expected here'));
    await new ReadinessService(makeEnv(db, { GOLD_API_KEY: 'k' })).report(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks a probe failure distinctly from a missing key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 401 }));
    const report = await new ReadinessService(makeEnv(db, { GOLD_API_KEY: 'wrong' })).report(true);

    // The key is present but does not work — that is not the same problem as
    // an absent key, and the operator needs to tell them apart.
    expect(report.checks.find((c) => c.key === 'gold_api')?.state).toBe('probe_failed');
  });

  it('infers attestation publishing from evidence, not from configuration alone', async () => {
    const withoutAttestation = await new ReadinessService(makeEnv(db)).report(false);
    expect(withoutAttestation.checks.find((c) => c.key === 'attestation_cron')?.state).toBe('missing');

    db.sqlite
      .prepare(
        `INSERT INTO reserve_attestations (id, sequence, digest, payload)
         VALUES ('a1', 1, 'deadbeef', '{}')`
      )
      .run();

    const withAttestation = await new ReadinessService(makeEnv(db)).report(false);
    const cron = withAttestation.checks.find((c) => c.key === 'attestation_cron');
    expect(cron?.state).toBe('ok');
    expect(cron?.detail).toContain('#1');
  });

  it('reports the IP allowlists as the only network guard', async () => {
    const report = await new ReadinessService(makeEnv(db)).report(false);
    const admin = report.checks.find((c) => c.key === 'admin_ip_allowlist');
    expect(admin?.state).toBe('missing');
    expect(admin?.detail).toMatch(/Cloudflare Access/);

    db.sqlite
      .prepare("INSERT INTO config (key, value) VALUES ('admin_ip_allowlist', '41.202.0.0/16')")
      .run();
    const after = await new ReadinessService(makeEnv(db)).report(false);
    expect(after.checks.find((c) => c.key === 'admin_ip_allowlist')?.state).toBe('ok');
  });

  it('summarises so a pre-demo script can gate on it', async () => {
    const report = await new ReadinessService(makeEnv(db, { GOLD_API_KEY: 'k' })).report(false);
    expect(report.summary.total).toBe(report.checks.length);
    // notProbed compris : sans lui, un script qui additionne les compteurs
    // sous-compterait silencieusement les verifications sans objet.
    expect(
      report.summary.ok +
        report.summary.missing +
        report.summary.partial +
        report.summary.failed +
        report.summary.notProbed
    ).toBe(report.checks.length);
  });

  describe('couverture des fonctionnalités récentes', () => {
    const keys = async (db: TestD1, env: Record<string, unknown> = {}) =>
      (await new ReadinessService(makeEnv(db, env)).report(false)).checks;

    const find = (checks: Awaited<ReturnType<typeof keys>>, key: string) =>
      checks.find((c) => c.key === key);

    it('couvre les fonctionnalités livrées après la phase 1', async () => {
      // Le script de démo dit d'ouvrir ce rapport EN PREMIER. Un rapport qui
      // ignore la moitié du produit donne une confiance injustifiée.
      const checks = await keys(db);
      for (const key of [
        'anchor_credentials',
        'anchor_activity',
        'lease_accrual_cron',
        'lease_settlement_cron',
        'storage_fee_cron',
        'country_config',
        'price_freshness',
      ]) {
        expect(find(checks, key), key).toBeDefined();
      }
    });

    it("dit qu'un ancrage absent ne casse pas la vérification", async () => {
      const check = find(await keys(db), 'anchor_credentials');
      expect(check?.state).toBe('missing');
      // L'ancrage est une confirmation supplémentaire, jamais une condition.
      expect(check?.impact).toContain('fonctionne malgré tout');
    });

    it('signale une configuration d’ancrage à moitié faite', async () => {
      const check = find(await keys(db, { ANCHOR_RPC_URL: 'https://rpc.example' }), 'anchor_credentials');
      expect(check?.state).toBe('partial');
      expect(check?.detail).toContain('clé absente');
    });

    it('ne crie pas au loup quand il n’y a rien à faire', async () => {
      // Aucune position, aucun or gardé : les jobs n'ont rien à calculer. Un
      // rapport qui alerterait ici apprendrait à être ignoré.
      const checks = await keys(db);
      expect(find(checks, 'lease_accrual_cron')?.state).toBe('not_probed');
      expect(find(checks, 'storage_fee_cron')?.state).toBe('not_probed');
    });

    it('détecte un job de rendement à l’arrêt', async () => {
      db.sqlite
        .prepare(
          `INSERT INTO lease_positions (id, user_id, wallet_id, principal_g, annual_rate, status)
           VALUES ('p1', 'u1', 'w1', 100, 0.06, 'ACTIVE')`
        )
        .run();

      const check = find(await keys(db), 'lease_accrual_cron');
      // Une position ouverte sans calcul d'hier : le job ne tourne pas.
      expect(check?.state).toBe('missing');
      expect(check?.detail).toContain('aucun calcul');
    });

    it('détecte une sortie échue non réglée', async () => {
      db.sqlite
        .prepare(
          `INSERT INTO lease_exit_orders (id, position_id, user_id, principal_g, settles_on, status)
           VALUES ('e1', 'p1', 'u1', 100, '2020-01-01', 'PENDING')`
        )
        .run();

      const check = find(await keys(db), 'lease_settlement_cron');
      expect(check?.state).toBe('missing');
      // C'est de l'or qu'un détenteur attend : le libellé doit le dire.
      expect(check?.detail).toContain("l'or n'est pas revenu");
    });

    it('exige un pays réellement payable, pas seulement activé', async () => {
      db.sqlite
        .prepare(
          `INSERT INTO country_config
             (code, name, currency, currency_symbol, phone_prefix, certificate_prefix,
              id_document_types, payment_methods, enabled)
           VALUES ('UG', 'Uganda', 'UGX', 'USh', '+256', 'UG', '[]',
                   '[{"id":"mtn_momo","label":"MTN","implemented":false}]', 1)`
        )
        .run();

      const check = find(await keys(db), 'country_config');
      // Activé mais sans adaptateur : un détenteur s'inscrirait sans pouvoir déposer.
      expect(check?.state).toBe('missing');
      expect(check?.detail).toContain('aucun avec un moyen de paiement');
    });

    it('accepte un pays dont un moyen de paiement est branché', async () => {
      db.sqlite
        .prepare(
          `INSERT INTO country_config
             (code, name, currency, currency_symbol, phone_prefix, certificate_prefix,
              id_document_types, payment_methods, enabled)
           VALUES ('BF', 'Burkina Faso', 'XOF', 'FCFA', '+226', 'BF', '[]',
                   '[{"id":"orange_money","label":"Orange","implemented":true}]', 1)`
        )
        .run();

      expect(find(await keys(db), 'country_config')?.state).toBe('ok');
    });

    it('distingue une clé de prix présente d’un prix réellement à jour', async () => {
      // La clé GoldAPI peut être valide et le rafraîchisseur à l'arrêt : achat
      // et vente échouent alors avec une clé pourtant bonne.
      const stale = await keys(db, { GOLD_API_KEY: 'k' });
      expect(find(stale, 'gold_api')?.state).toBe('ok');
      expect(find(stale, 'price_freshness')?.state).toBe('missing');

      db.sqlite
        .prepare(
          `INSERT INTO gold_prices (id, price_usd, price_xof, exchange_rate, buy_price, sell_price, source, timestamp)
           VALUES ('p1', 85, 53000, 615, 54000, 52000, 'test', datetime('now'))`
        )
        .run();

      expect(find(await keys(db), 'price_freshness')?.state).toBe('ok');
    });

    it('considère un prix vieux d’une heure comme périmé', async () => {
      db.sqlite
        .prepare(
          `INSERT INTO gold_prices (id, price_usd, price_xof, exchange_rate, buy_price, sell_price, source, timestamp)
           VALUES ('p1', 85, 53000, 615, 54000, 52000, 'test', datetime('now', '-3 hours'))`
        )
        .run();

      expect(find(await keys(db), 'price_freshness')?.state).toBe('missing');
    });
  });
});
