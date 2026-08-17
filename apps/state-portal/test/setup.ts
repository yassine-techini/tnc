import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom refuse la navigation ("Not implemented: navigation"). Le portail
// redirige vers /login a l'expiration de session, ce qui EST un comportement a
// tester : on remplace window.location par un objet inspectable plutot que de
// laisser jsdom crier dans la sortie.
Object.defineProperty(window, 'location', {
  writable: true,
  value: { href: '/', assign: vi.fn(), replace: vi.fn() },
});

// Recharts mesure son conteneur ; jsdom rend tout en 0 x 0, donc les graphiques
// ne dessinent rien. Les tests d'ecran portent sur les chiffres, pas sur les
// courbes — mais sans ce stub ResponsiveContainer emet un avertissement a
// chaque rendu et noie la sortie.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as never);
