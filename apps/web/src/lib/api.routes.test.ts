import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

/**
 * Chemins d'appel du client web.
 *
 * Ces tests existent a cause d'un defaut precis : `changePassword` appelait
 * `/api/v1/auth/change-password`, une route qui n'existe pas. Le compilateur ne
 * voit pas une chaine de caracteres ; seul un appel verifie le voit.
 */

const reponse = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, data, requestId: 'req' }),
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(reponse({}));
  globalThis.fetch = fetchMock as never;
});

/** Chemin demande, sans l'origine ni la chaine de requete. */
const cheminAppele = () => new URL(String(fetchMock.mock.calls[0][0]), 'http://x').pathname;
const corpsAppele = () => JSON.parse(String(fetchMock.mock.calls[0][1]?.body ?? '{}'));

describe('Changement de mot de passe', () => {
  it('vise la seule route qui existe', async () => {
    await api.changePassword('ancien', 'NouveauMotDePasse1!');

    // `/api/v1/auth/change-password` n'a jamais existe : l'appel partait en 404.
    expect(cheminAppele()).toBe('/api/v1/users/me/password');
  });

  it('envoie la confirmation exigee par la validation', async () => {
    await api.changePassword('ancien', 'NouveauMotDePasse1!');

    // Sans `confirmPassword`, le schema Zod refuse la requete : viser la bonne
    // route ne suffisait pas.
    expect(corpsAppele()).toEqual({
      currentPassword: 'ancien',
      newPassword: 'NouveauMotDePasse1!',
      confirmPassword: 'NouveauMotDePasse1!',
    });
  });
});

describe('Pays ouvrables', () => {
  it('interroge la route publique', async () => {
    await api.getPublicCountries();

    expect(cheminAppele()).toBe('/api/v1/public/countries');
  });
});

describe('Cycle de vie du depot', () => {
  it('liste les depots en cours', async () => {
    await api.getPendingDeposits();

    expect(cheminAppele()).toBe('/api/v1/wallet/deposits/pending');
  });

  it('annule un depot par son identifiant', async () => {
    await api.cancelDeposit('dep 1');

    // L'identifiant est encode : un espace ou un slash casserait le chemin.
    expect(cheminAppele()).toBe('/api/v1/wallet/deposit/dep%201/cancel');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
  });
});
