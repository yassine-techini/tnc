import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import * as jose from 'jose';
import {
  parseServiceAccount,
  buildAssertion,
  getAccessToken,
  messagingEndpoint,
  buildMessage,
  type ServiceAccount,
  type TokenCache,
} from './fcm-oauth';

let account: ServiceAccount;
let publicKey: Awaited<ReturnType<typeof jose.generateKeyPair>>['publicKey'];

beforeAll(async () => {
  const pair = await jose.generateKeyPair('RS256', { extractable: true });
  const pkcs8 = await jose.exportPKCS8(pair.privateKey);
  publicKey = pair.publicKey;
  account = {
    project_id: 'tnc-demo',
    client_email: 'push@tnc-demo.iam.gserviceaccount.com',
    // Service account JSON escapes newlines — the real-world shape.
    private_key: pkcs8.replace(/\n/g, '\\n'),
    private_key_id: 'key-1',
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** In-memory stand-in for the KV namespace. */
function memoryCache(): TokenCache & { store: Map<string, string>; puts: number } {
  const store = new Map<string, string>();
  return {
    store,
    puts: 0,
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
      this.puts++;
    },
  };
}

describe('parseServiceAccount', () => {
  it('accepts a well-formed service account', () => {
    expect(parseServiceAccount(JSON.stringify(account))?.project_id).toBe('tnc-demo');
  });

  it('fails closed on anything unusable', () => {
    expect(parseServiceAccount(undefined)).toBeNull();
    expect(parseServiceAccount('')).toBeNull();
    expect(parseServiceAccount('not json')).toBeNull();
    // A legacy server key is not a service account — this is exactly what an
    // operator migrating from the dead endpoint is likely to paste in.
    expect(parseServiceAccount('"AAAA:legacy-server-key"')).toBeNull();
    expect(parseServiceAccount(JSON.stringify({ project_id: 'x' }))).toBeNull();
  });
});

describe('buildAssertion', () => {
  it('produces a JWT Google can validate against the service account key', async () => {
    const assertion = await buildAssertion(account, 1_700_000_000);
    const { payload, protectedHeader } = await jose.jwtVerify(assertion, publicKey, {
      audience: 'https://oauth2.googleapis.com/token',
      issuer: account.client_email,
      // Evaluate at the same instant the assertion was minted, otherwise the
      // fixed timestamp reads as long expired against the real clock.
      currentDate: new Date(1_700_000_000 * 1000),
    });

    expect(protectedHeader).toMatchObject({ alg: 'RS256', kid: 'key-1' });
    expect(payload).toMatchObject({
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      sub: account.client_email,
      iat: 1_700_000_000,
      exp: 1_700_000_000 + 3600,
    });
  });

  it('restores the newlines the JSON escaped, or the key cannot be imported', async () => {
    // The private_key above carries literal \n sequences; if they were not
    // unescaped, importPKCS8 would throw and push would silently stop working.
    await expect(buildAssertion(account, 1_700_000_000)).resolves.toBeTypeOf('string');
  });
});

describe('getAccessToken', () => {
  it('exchanges the assertion and caches the token', async () => {
    const cache = memoryCache();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'ya29.token', expires_in: 3600 }), { status: 200 })
    );

    const token = await getAccessToken(account, cache, 1_700_000_000);
    expect(token).toBe('ya29.token');
    expect(fetchMock).toHaveBeenCalledOnce();

    // A second call must reuse the cached token, not mint another.
    const again = await getAccessToken(account, cache, 1_700_000_000);
    expect(again).toBe('ya29.token');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('caches for less than the token lifetime so no send uses a dead token', async () => {
    const cache = memoryCache();
    const puts: Array<{ ttl?: number }> = [];
    cache.put = async (_k, _v, opts) => {
      puts.push({ ttl: opts?.expirationTtl });
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 })
    );

    await getAccessToken(account, cache, 1_700_000_000);
    expect(puts[0].ttl).toBeLessThan(3600);
    expect(puts[0].ttl).toBeGreaterThan(0);
  });

  it('returns null when Google refuses the assertion', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('invalid_grant', { status: 400 }));
    expect(await getAccessToken(account, null, 1_700_000_000)).toBeNull();
  });

  it('returns null on a malformed private key rather than throwing', async () => {
    const broken = { ...account, private_key: 'not-a-pem' };
    expect(await getAccessToken(broken, null, 1_700_000_000)).toBeNull();
  });
});

describe('message shape', () => {
  it('targets the v1 endpoint for the project', () => {
    expect(messagingEndpoint('tnc-demo')).toBe(
      'https://fcm.googleapis.com/v1/projects/tnc-demo/messages:send'
    );
  });

  it('uses the v1 field names, not the legacy ones', () => {
    const body = buildMessage({ token: 'device-1', title: 'T', body: 'B' }) as {
      message: Record<string, unknown>;
    };
    // Legacy used `to`; v1 uses `token` nested under `message`.
    expect(body.message).toMatchObject({ token: 'device-1', notification: { title: 'T', body: 'B' } });
    expect(body.message).not.toHaveProperty('to');
  });

  it('stringifies data values, which v1 rejects otherwise', () => {
    const body = buildMessage({
      token: 'device-1',
      title: 'T',
      body: 'B',
      data: { amount: 42 as unknown as string, ref: 'CONS-1' },
    }) as { message: { data: Record<string, string> } };
    expect(body.message.data).toEqual({ amount: '42', ref: 'CONS-1' });
  });

  it('omits data entirely when there is none', () => {
    const body = buildMessage({ token: 'device-1', title: 'T', body: 'B' }) as {
      message: Record<string, unknown>;
    };
    expect(body.message).not.toHaveProperty('data');
  });
});
