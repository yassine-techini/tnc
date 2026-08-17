/**
 * Public, unauthenticated verification surface (ADR 002, phase 1).
 *
 * The point of an attestation is that a third party — the State, a citizen, an
 * external auditor — can check it without an account and without trusting us.
 * Everything here is read-only and contains no personal data: reserve totals and
 * lot references only.
 */
import { Hono } from 'hono';
import type { PublicCountriesData } from '@tnc-trading/shared/contracts';
import type { AppEnv } from '../types/env';
import { AttestationService } from '../services/attestation.service';
import { verifyAttestationSignature } from '../lib/attestation-signing';
import { ConfigService } from '../services/config.service';
import { CHAINS } from '../lib/anchoring';
import {
  CountryConfigService,
  enabledPaymentMethods,
  isServiceable,
} from '../services/country-config.service';

const publicRoutes = new Hono<AppEnv>();

/** The public key a verifier needs. Empty until one is published. */
publicRoutes.get('/reserve/key', async (c) => {
  const requestId = crypto.randomUUID();
  const cfg = new ConfigService(c.env.DB, c.env.CACHE);
  const jwk = await cfg.get('attestation_public_jwk', '');
  if (!jwk) {
    return c.json({
      success: false,
      error: { code: 'NOT_CONFIGURED', message: 'Aucune clé de vérification publiée' },
      requestId,
    }, 404);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jwk);
  } catch {
    return c.json({
      success: false,
      error: { code: 'NOT_CONFIGURED', message: 'Clé de vérification illisible' },
      requestId,
    }, 500);
  }
  return c.json({ success: true, data: { alg: 'ES256', jwk: parsed }, requestId });
});

/** Latest attestations, newest first. */
publicRoutes.get('/reserve/attestations', async (c) => {
  const requestId = crypto.randomUUID();
  const page = Math.max(1, Math.floor(Number(c.req.query('page')) || 1));
  const limit = Math.min(50, Math.max(1, Math.floor(Number(c.req.query('limit')) || 20)));

  const service = new AttestationService(c.env.DB);
  const { items, total } = await service.list(limit, (page - 1) * limit);

  return c.json({
    success: true,
    data: {
      items: items.map(summarize),
      meta: { page, limit, total },
    },
    requestId,
  });
});

publicRoutes.get('/reserve/attestations/latest', async (c) => {
  const requestId = crypto.randomUUID();
  const service = new AttestationService(c.env.DB);
  const latest = await service.getLatest();
  if (!latest) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Aucune attestation publiée' },
      requestId,
    }, 404);
  }
  return c.json({ success: true, data: full(latest), requestId });
});

/**
 * One attestation, with the checks recomputed server-side as a convenience.
 * A verifier should still redo them from `payload` and the published key —
 * that is the whole point.
 */
publicRoutes.get('/reserve/attestations/:digest', async (c) => {
  const requestId = crypto.randomUUID();
  const digest = c.req.param('digest').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    return c.json({
      success: false,
      error: { code: 'INVALID_DIGEST', message: 'Empreinte invalide' },
      requestId,
    }, 400);
  }

  const service = new AttestationService(c.env.DB);
  const result = await service.verify(digest);
  if (!result.found || !result.attestation) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Attestation inconnue' },
      requestId,
    }, 404);
  }

  const cfg = new ConfigService(c.env.DB, c.env.CACHE);
  const publicJwk = await cfg.get('attestation_public_jwk', '');
  const signatureValid =
    publicJwk && result.attestation.signature
      ? await verifyAttestationSignature(result.attestation.signature, digest, publicJwk)
      : false;

  return c.json({
    success: true,
    data: {
      ...full(result.attestation),
      verification: {
        digestMatches: result.digestMatches,
        chainLinkValid: result.chainLinkValid,
        signatureValid,
        anchored: result.anchored,
      },
    },
    requestId,
  });
});

interface AttestationLike {
  sequence: number;
  digest: string;
  previous_digest: string | null;
  payload: string;
  signature: string | null;
  signing_key_id: string | null;
  anchor_chain: string | null;
  anchor_tx_hash: string | null;
  anchored_at: string | null;
  created_at: string;
}

function summarize(a: AttestationLike) {
  return {
    sequence: a.sequence,
    digest: a.digest,
    previousDigest: a.previous_digest,
    anchorChain: a.anchor_chain,
    anchorTxHash: a.anchor_tx_hash,
    anchoredAt: a.anchored_at,
    // Public explorer link, so a verifier can read the digest straight from the
    // transaction's calldata without trusting this API.
    anchorUrl: anchorUrl(a.anchor_chain, a.anchor_tx_hash),
    createdAt: a.created_at,
  };
}

function anchorUrl(chain: string | null, txHash: string | null): string | null {
  if (!chain || !txHash) return null;
  const spec = CHAINS[chain];
  return spec ? `${spec.explorer}${txHash}` : null;
}

function full(a: AttestationLike) {
  return {
    ...summarize(a),
    // The exact bytes that were hashed — a verifier recomputes SHA-256 over this.
    payload: a.payload,
    signature: a.signature,
    signingKeyId: a.signing_key_id,
  };
}

/**
 * Countries the platform is configured for.
 *
 * Public because the registration form needs it before anyone has an account:
 * the dialling code, the accepted identity documents and the payment providers
 * all depend on the country being chosen.
 *
 * `serviceable` is the flag that matters, and it is stricter than `enabled`: a
 * country with no working payment adapter is listed but cannot be signed up
 * for, because a holder who could open an account and then not put money in
 * would have been misled by the list itself.
 */
publicRoutes.get('/countries', async (c) => {
  const requestId = crypto.randomUUID();
  const countries = await new CountryConfigService(c.env.DB).list();

  return c.json({
    success: true,
    data: {
      countries: countries.map((country) => ({
        code: country.code,
        name: country.name,
        currency: country.currency,
        currencySymbol: country.currencySymbol,
        currencyDecimals: country.currencyDecimals,
        phonePrefix: country.phonePrefix,
        idDocumentTypes: country.idDocumentTypes,
        locale: country.locale,
        // Only providers that can actually take a payment. Listing the others
        // as available is how a demo discovers the gap in front of a client.
        paymentMethods: enabledPaymentMethods(country).map((m) => ({
          id: m.id,
          label: m.label,
        })),
        plannedPaymentMethods: country.paymentMethods
          .filter((m) => !m.implemented)
          .map((m) => ({ id: m.id, label: m.label })),
        enabled: country.enabled,
        serviceable: isServiceable(country),
      })),
    } satisfies PublicCountriesData,
    requestId,
  });
});

export const publicVerificationRoutes = publicRoutes;
