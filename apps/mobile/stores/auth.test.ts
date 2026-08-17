import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Le magasin de session porte les jetons d'acces sur un appareil qui peut etre
 * perdu, vole ou racine. Ce qui est verifie ici : ou les jetons sont ecrits,
 * quand la session est consideree comme morte, et ce qui se passe au reveil de
 * l'application.
 */

const secureStore = {
  getItemAsync: vi.fn<(name: string) => Promise<string | null>>(),
  setItemAsync: vi.fn<(name: string, value: string) => Promise<void>>(),
  deleteItemAsync: vi.fn<(name: string) => Promise<void>>(),
};
const push = {
  registerForPush: vi.fn<() => Promise<void>>(),
  unregisterForPush: vi.fn<() => Promise<void>>(),
};

vi.mock('expo-secure-store', () => secureStore);
vi.mock('../lib/push-registration', () => push);

const USER = {
  id: 'usr_1',
  email: 'client@example.bf',
  phone: '+22670000000',
  country: 'BF',
  kycLevel: 'VERIFIED' as const,
  kycStatus: 'APPROVED' as const,
  emailVerified: true,
  phoneVerified: true,
  twoFactorEnabled: true,
};
const TOKENS = { accessToken: 'at_1', refreshToken: 'rt_1', expiresIn: 900 };

/** Recharge le module pour rejouer la rehydratation avec un contenu donne. */
async function loadStore(persisted?: unknown) {
  secureStore.getItemAsync.mockResolvedValue(
    persisted === undefined ? null : JSON.stringify({ state: persisted, version: 0 })
  );
  vi.resetModules();
  const module = await import('./auth');
  await module.useAuthStore.persist.rehydrate();
  return module.useAuthStore;
}

beforeEach(() => {
  vi.clearAllMocks();
  secureStore.setItemAsync.mockResolvedValue(undefined);
  secureStore.deleteItemAsync.mockResolvedValue(undefined);
  push.registerForPush.mockResolvedValue(undefined);
  push.unregisterForPush.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Session mobile — ou vivent les jetons', () => {
  it('ecrit la session dans le stockage securise du systeme', async () => {
    const useAuthStore = await loadStore();

    useAuthStore.getState().login(USER, TOKENS);
    await vi.waitFor(() => expect(secureStore.setItemAsync).toHaveBeenCalled());

    // Le trousseau iOS / Keystore Android, pas AsyncStorage : sur un appareil
    // debride, un jeton en clair se lit sans effort.
    const [name, value] = secureStore.setItemAsync.mock.calls.at(-1) as [string, string];
    expect(name).toBe('tnc-mobile-auth');
    expect(value).toContain('at_1');
  });
});

describe('Session mobile — expiration', () => {
  it('considere une session sans echeance comme expiree', async () => {
    const useAuthStore = await loadStore();

    // Echec ferme : en l'absence d'echeance connue, on ne suppose pas valide.
    expect(useAuthStore.getState().isTokenExpired()).toBe(true);
  });

  it('respecte la duree de vie annoncee par le serveur', async () => {
    vi.useFakeTimers();
    const useAuthStore = await loadStore();

    useAuthStore.getState().login(USER, TOKENS);
    expect(useAuthStore.getState().isTokenExpired()).toBe(false);

    vi.advanceTimersByTime(901 * 1000);
    expect(useAuthStore.getState().isTokenExpired()).toBe(true);
  });
});

describe('Session mobile — reveil de l application', () => {
  it('ferme la session quand le jeton a expire pendant la mise en veille', async () => {
    const useAuthStore = await loadStore({
      user: USER,
      tokens: TOKENS,
      isAuthenticated: true,
      tokenExpiresAt: Date.now() - 1000,
      lastActivityAt: Date.now(),
      loginAt: Date.now(),
    });

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().tokens).toBeNull();
  });

  it('ferme la session apres trente minutes sans activite', async () => {
    const useAuthStore = await loadStore({
      user: USER,
      tokens: TOKENS,
      isAuthenticated: true,
      tokenExpiresAt: Date.now() + 3_600_000,
      lastActivityAt: Date.now() - 31 * 60 * 1000,
      loginAt: Date.now() - 60 * 60 * 1000,
    });

    // Le jeton est encore valide cote serveur : c'est l'inactivite qui ferme,
    // pour qu'un telephone pose sur une table ne reste pas ouvert.
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('garde la session d une application simplement mise en arriere-plan', async () => {
    const useAuthStore = await loadStore({
      user: USER,
      tokens: TOKENS,
      isAuthenticated: true,
      tokenExpiresAt: Date.now() + 3_600_000,
      lastActivityAt: Date.now() - 2 * 60 * 1000,
      loginAt: Date.now() - 10 * 60 * 1000,
    });

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().isLoading).toBe(false);
  });
});

describe('Session mobile — notifications', () => {
  it('laisse ouvrir la session meme si l enregistrement push echoue', async () => {
    push.registerForPush.mockRejectedValue(new Error('permission refusee'));
    const useAuthStore = await loadStore();

    useAuthStore.getState().login(USER, TOKENS);

    // Un appareil sans notifications doit rester utilisable : refuser la
    // connexion pour ca reviendrait a bloquer un client sur un detail.
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('desenregistre l appareil avant d effacer le jeton', async () => {
    const useAuthStore = await loadStore();
    useAuthStore.getState().login(USER, TOKENS);

    let tokenPresentPendantAppel: boolean | null = null;
    push.unregisterForPush.mockImplementation(async () => {
      tokenPresentPendantAppel = useAuthStore.getState().tokens !== null;
    });

    useAuthStore.getState().logout();

    // L'appel a besoin du jeton d'acces. Efface avant, il partirait sans
    // authentification et l'appareil continuerait de recevoir les
    // notifications du client precedent.
    expect(tokenPresentPendantAppel).toBe(true);
    expect(useAuthStore.getState().tokens).toBeNull();
  });
});
