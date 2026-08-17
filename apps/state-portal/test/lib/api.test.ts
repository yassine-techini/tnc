import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stateApi } from '../../src/lib/api';

/**
 * Le portail s'authentifie par cookie httpOnly : le navigateur porte la session,
 * pas le JavaScript. Toute la logique sensible tient donc dans `request()` —
 * quand rafraichir, combien de fois, et que faire quand ca echoue.
 */

const ok = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, data, requestId: 'req_test' }),
});

const unauthorized = () => ({
  ok: false,
  status: 401,
  json: async () => ({
    success: false,
    error: { code: 'AUTH_REQUIRED', message: 'Non authentifie' },
    requestId: 'req_test',
  }),
});

const failure = (code: string, message: string) => ({
  ok: false,
  status: 400,
  json: async () => ({ success: false, error: { code, message }, requestId: 'req_test' }),
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as never;
  stateApi.setAuthErrorCallback(null as never);
});

describe('StateApiClient — transport', () => {
  it('envoie les cookies sur chaque appel', async () => {
    fetchMock.mockResolvedValueOnce(ok({ totalAllocated: 1000 }));

    await stateApi.getStock();

    const [, init] = fetchMock.mock.calls[0];
    // Sans `credentials: 'include'`, le cookie de session ne part pas et
    // l'utilisateur est deconnecte a chaque rechargement.
    expect(init.credentials).toBe('include');
  });

  it('remonte le message de l API plutot qu une erreur generique', async () => {
    fetchMock.mockResolvedValueOnce(failure('STATE_FORBIDDEN', 'Portail reserve a l Etat'));

    await expect(stateApi.getStock()).rejects.toThrow('Portail reserve a l Etat');
  });
});

describe('StateApiClient — expiration de session', () => {
  it('rafraichit puis rejoue la requete apres un 401', async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true }) })
      .mockResolvedValueOnce(ok({ totalAllocated: 4200 }));

    const result = await stateApi.getStock();

    expect(result.data).toEqual({ totalAllocated: 4200 });
    expect(fetchMock.mock.calls[1][0]).toContain('/api/v1/auth/refresh');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('ne rafraichit qu une seule fois pour des requetes simultanees', async () => {
    // Le vol unique existe pour ca : trois ecrans qui chargent ensemble ne
    // doivent pas declencher trois rotations de jeton concurrentes, dont deux
    // se retrouveraient a presenter un jeton deja tourne.
    let releaseRefresh: (v: unknown) => void = () => {};
    const refreshPending = new Promise((resolve) => {
      releaseRefresh = resolve;
    });

    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/auth/refresh')) {
        return refreshPending.then(() => ({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        }));
      }
      if (fetchMock.mock.calls.filter((c) => !String(c[0]).includes('/auth/refresh')).length <= 3) {
        return Promise.resolve(unauthorized());
      }
      return Promise.resolve(ok({ totalAllocated: 1 }));
    });

    const inFlight = Promise.all([
      stateApi.getStock(),
      stateApi.getDashboard(),
      stateApi.getProofOfReserve(),
    ]);
    await Promise.resolve();
    releaseRefresh(null);
    await inFlight;

    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });

  it('previent l application et abandonne quand le rafraichissement echoue', async () => {
    const onAuthError = vi.fn();
    stateApi.setAuthErrorCallback(onAuthError);

    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ success: false }) });

    await expect(stateApi.getStock()).rejects.toThrow(/[Ss]ession expir/);
    expect(onAuthError).toHaveBeenCalledTimes(1);
  });

  it('ne boucle pas quand la requete rejouee est elle aussi refusee', async () => {
    const onAuthError = vi.fn();
    stateApi.setAuthErrorCallback(onAuthError);

    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true }) })
      .mockResolvedValueOnce(unauthorized());

    // Un 401 sur la requete rejouee ne doit PAS relancer un rafraichissement :
    // sans le drapeau `_isRetry`, ce cas boucle jusqu'a epuisement de la pile.
    await expect(stateApi.getStock()).rejects.toThrow();
    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });
});

describe('StateApiClient — connexion a deux facteurs', () => {
  it('signale l enrolement requis sans lever d exception', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        success: false,
        error: { code: '2FA_SETUP_REQUIRED', message: 'Enrolement requis' },
        data: { setupToken: 'stk_abc' },
      }),
    });

    const result = await stateApi.stateLogin('etat@bf.gov', 'motdepasse');

    // L'ecran doit pouvoir enchainer sur l'enrolement ; une exception le
    // renverrait sur le formulaire avec un message d'erreur rouge a la place.
    expect(result.success).toBe(false);
    expect(result).toMatchObject({ requires2FASetup: true, setupToken: 'stk_abc' });
  });

  it('signale le code requis sans lever d exception', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({
        success: false,
        error: { code: '2FA_REQUIRED', message: 'Code requis' },
      }),
    });

    const result = await stateApi.stateLogin('etat@bf.gov', 'motdepasse');

    expect(result).toMatchObject({ success: false, requires2FA: true });
  });

  it('leve une exception sur un identifiant invalide', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({
        success: false,
        error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Email ou mot de passe incorrect' },
      }),
    });

    await expect(stateApi.stateLogin('etat@bf.gov', 'faux')).rejects.toThrow(
      'Email ou mot de passe incorrect'
    );
  });
});
