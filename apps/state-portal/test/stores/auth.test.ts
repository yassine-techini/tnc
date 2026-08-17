import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startInactivityMonitor,
  stopInactivityMonitor,
  touchActivity,
  useStateStore,
} from '../../src/stores/auth';

const AGENT = { id: 'usr_etat_1', email: 'inspecteur@finances.gov.bf', ministry: 'Finances' };

beforeEach(() => {
  localStorage.clear();
  useStateStore.getState().logout();
});

afterEach(() => {
  stopInactivityMonitor();
  vi.useRealTimers();
});

describe('Magasin de session — etat', () => {
  it('ouvre et ferme la session', () => {
    useStateStore.getState().login(AGENT);
    expect(useStateStore.getState().isAuthenticated).toBe(true);
    expect(useStateStore.getState().user).toEqual(AGENT);

    useStateStore.getState().logout();
    expect(useStateStore.getState().isAuthenticated).toBe(false);
    expect(useStateStore.getState().user).toBeNull();
  });
});

describe('Magasin de session — ce qui est ecrit sur le disque', () => {
  it('ne persiste aucun jeton', () => {
    // La session vit dans un cookie httpOnly, hors de portee du JavaScript.
    // Si un jeton atterrissait dans le stockage local, il redeviendrait lisible
    // par n'importe quel script de la page — c'est tout l'inverse du choix fait.
    useStateStore.getState().login(AGENT);

    const persisted = localStorage.getItem('tnc-state-auth') ?? '';

    expect(persisted).not.toMatch(/token/i);
    expect(persisted).not.toMatch(/accessToken|refreshToken|Bearer/);
  });

  it('ne persiste que l identite affichee', () => {
    useStateStore.getState().login(AGENT);

    const persisted = JSON.parse(localStorage.getItem('tnc-state-auth') as string);

    expect(Object.keys(persisted.state).sort()).toEqual(['isAuthenticated', 'user']);
  });
});

describe('Magasin de session — veille d inactivite', () => {
  it('ferme la session apres trente minutes sans activite', () => {
    vi.useFakeTimers();
    useStateStore.getState().login(AGENT);
    startInactivityMonitor();
    touchActivity();

    vi.advanceTimersByTime(31 * 60 * 1000);

    expect(useStateStore.getState().isAuthenticated).toBe(false);
    expect(window.location.href).toContain('reason=timeout');
  });

  it('laisse la session ouverte tant que l agent travaille', () => {
    vi.useFakeTimers();
    useStateStore.getState().login(AGENT);
    startInactivityMonitor();

    // Vingt-cinq minutes, une frappe, puis vingt-cinq de plus : cinquante
    // minutes au total mais jamais trente d'affilee. Deconnecter ici
    // interromprait un agent en train de lire un rapport.
    vi.advanceTimersByTime(25 * 60 * 1000);
    document.dispatchEvent(new KeyboardEvent('keydown'));
    vi.advanceTimersByTime(25 * 60 * 1000);

    expect(useStateStore.getState().isAuthenticated).toBe(true);
  });

  it('ne ferme pas une session deja fermee', () => {
    vi.useFakeTimers();
    window.location.href = '/';
    startInactivityMonitor();
    touchActivity();

    vi.advanceTimersByTime(31 * 60 * 1000);

    // Personne n'est connecte : rediriger vers /login?reason=timeout ferait
    // croire a une expiration a quelqu'un qui n'a jamais ouvert de session.
    expect(window.location.href).toBe('/');
  });

  it('ne demarre qu une seule veille', () => {
    vi.useFakeTimers();
    const setInterval = vi.spyOn(globalThis, 'setInterval');

    startInactivityMonitor();
    startInactivityMonitor();
    startInactivityMonitor();

    expect(setInterval).toHaveBeenCalledTimes(1);
  });
});
