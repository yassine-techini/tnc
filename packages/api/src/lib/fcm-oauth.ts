/**
 * FCM HTTP v1 authentication.
 *
 * The legacy endpoint this codebase used — `fcm.googleapis.com/fcm/send` with an
 * `Authorization: key=<server key>` header — was **shut down by Google in June
 * 2024**. Push notifications have not worked since; this is not a deprecation to
 * plan for, it is a dead call.
 *
 * HTTP v1 authenticates with a short-lived OAuth2 access token, obtained by
 * signing a JWT assertion with the service account's private key. Tokens last an
 * hour, so they are cached in KV rather than minted per notification.
 */
import * as jose from 'jose';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
/** Refresh a little before expiry so an in-flight send never uses a dead token. */
const EXPIRY_SKEW_SECONDS = 300;

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  private_key_id?: string;
}

/**
 * Parse and validate a service account JSON. Returns null rather than throwing:
 * an unusable credential must disable push, not break the caller.
 */
export function parseServiceAccount(raw?: string): ServiceAccount | null {
  if (!raw) return null;
  let parsed: Partial<ServiceAccount>;
  try {
    parsed = JSON.parse(raw) as Partial<ServiceAccount>;
  } catch {
    console.error('FCM service account is not valid JSON — push disabled');
    return null;
  }
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    console.error('FCM service account is missing project_id, client_email or private_key — push disabled');
    return null;
  }
  return parsed as ServiceAccount;
}

/**
 * Build the signed JWT assertion Google exchanges for an access token.
 * `now` is injected so the assertion is testable without freezing the clock.
 */
export async function buildAssertion(account: ServiceAccount, now: number): Promise<string> {
  // Service account keys are PKCS#8 PEM. The JSON escapes newlines, so they must
  // be restored before the key can be imported.
  const pem = account.private_key.replace(/\\n/g, '\n');
  const key = await jose.importPKCS8(pem, 'RS256');

  return new jose.SignJWT({ scope: FCM_SCOPE })
    .setProtectedHeader({ alg: 'RS256', kid: account.private_key_id })
    .setIssuer(account.client_email)
    .setSubject(account.client_email)
    .setAudience(TOKEN_ENDPOINT)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
}

export interface TokenCache {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/**
 * Obtain an access token for FCM, reusing the cached one while it is still
 * valid. Returns null when the credential is unusable or Google refuses it —
 * push then fails closed instead of pretending to have sent something.
 */
export async function getAccessToken(
  account: ServiceAccount,
  cache: TokenCache | null,
  now: number = Math.floor(Date.now() / 1000)
): Promise<string | null> {
  const cacheKey = `fcm_access_token:${account.client_email}`;

  if (cache) {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  }

  let assertion: string;
  try {
    assertion = await buildAssertion(account, now);
  } catch {
    console.error('FCM service account private key could not be imported — push disabled');
    return null;
  }

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    console.error(`FCM token exchange failed: ${response.status}`);
    return null;
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    console.error('FCM token exchange returned no access_token');
    return null;
  }

  if (cache) {
    const ttl = Math.max(60, (data.expires_in ?? 3600) - EXPIRY_SKEW_SECONDS);
    await cache.put(cacheKey, data.access_token, { expirationTtl: ttl });
  }

  return data.access_token;
}

/** HTTP v1 send endpoint for this project. */
export function messagingEndpoint(projectId: string): string {
  return `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
}

/**
 * HTTP v1 message body. The shape changed from legacy: `to` became `token`, and
 * every `data` value must be a string — a number here is rejected by the API.
 */
export function buildMessage(options: {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}): Record<string, unknown> {
  const message: Record<string, unknown> = {
    token: options.token,
    notification: { title: options.title, body: options.body },
  };
  if (options.data) {
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(options.data)) data[k] = String(v);
    message.data = data;
  }
  return { message };
}
