/**
 * Ce que `/auth/2fa/setup` renvoie réellement.
 *
 * Les clients web et mobile déclaraient `qrCodeUrl`, que la route n'a jamais
 * envoyé. Côté web, tout le bloc d'activation était conditionné à ce champ
 * absent — ni QR, ni clé secrète : **l'activation 2FA était inutilisable**, et
 * TypeScript ne pouvait rien dire puisque le mensonge était dans le paramètre
 * de type du client.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const AUTH = readFileSync(new URL('../../src/routes/auth.ts', import.meta.url), 'utf8');

/** Le bloc `data: { … }` qui suit le marqueur donné. */
function payloadAfter(marker: string): string {
  const start = AUTH.indexOf(marker);
  expect(start, marker).toBeGreaterThan(-1);
  const dataAt = AUTH.indexOf('data: {', start);
  return AUTH.slice(dataAt, AUTH.indexOf('requestId', dataAt));
}

describe('/auth/2fa/setup', () => {
  const payload = () => payloadAfter("auth.post('/2fa/setup'");

  it('renvoie la clé et l’URI otpauth', () => {
    const p = payload();
    expect(p).toContain('secret');
    expect(p).toContain('uri');
  });

  it('ne renvoie aucune image de QR — et c’est délibéré', () => {
    // La générer via le service externe utilisé pour les certificats
    // enverrait la GRAINE TOTP de chaque utilisateur à un tiers. Un code de
    // vérification de certificat est public ; un secret 2FA ne l'est pas.
    expect(payload()).not.toContain('qrCodeUrl');
    expect(AUTH).not.toContain('qrserver');
  });

  it('construit une URI otpauth, pas une URL d’image', () => {
    expect(AUTH).toContain('generateTotpUri');
  });
});
