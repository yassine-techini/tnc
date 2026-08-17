import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { StateDashboardData } from '@tnc-trading/shared/contracts';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from '../../src/pages/Dashboard';
import { useStateStore } from '../../src/stores/auth';

vi.mock('../../src/lib/api', () => ({
  stateApi: {
    getDashboard: vi.fn(),
    getPrice: vi.fn(),
    getPriceHistory: vi.fn(),
    getTransactionStats: vi.fn(),
    setAuthErrorCallback: vi.fn(),
  },
}));

const { stateApi } = await import('../../src/lib/api');

const STATS: StateDashboardData = {
  totalUsers: 8421,
  totalTokens: 9800,
  totalVolume: 512_000_000,
  goldAllocated: 12500,
  goldOnLoan: 1500,
  goldVaulted: 11000,
  fullyVaulted: false,
  coverageRatio: 1.02,
  monthlyVolume: 64_000_000,
  lastUpdate: '2026-08-17T08:00:00.000Z',
};

const envelope = (data: unknown) => ({ success: true, data, requestId: 'req' });

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<Dashboard />, { wrapper });
}

beforeEach(() => {
  vi.mocked(stateApi.getPrice).mockResolvedValue(envelope({ priceXof: 53000 }) as never);
  vi.mocked(stateApi.getPriceHistory).mockResolvedValue(envelope({ items: [] }) as never);
  vi.mocked(stateApi.getTransactionStats).mockResolvedValue(envelope({ items: [] }) as never);
  useStateStore.getState().login({ id: 'u1', email: 'agent@bf.gov', ministry: 'Finances' });
});

describe('Tableau de bord Etat — la reserve', () => {
  it('affiche les grammes alloues et les tokens emis de la reponse', async () => {
    vi.mocked(stateApi.getDashboard).mockResolvedValue(envelope(STATS) as never);

    renderScreen();

    // Le client declarait totalAllocated / tokensIssued / coverage : trois noms
    // qu'aucune reponse n'a jamais contenus. Ce tableau affichait donc 0 g.
    expect(await screen.findAllByText(/12500/)).not.toHaveLength(0);
    expect(await screen.findAllByText(/9800/)).not.toHaveLength(0);
  });

  it('affiche le taux de couverture reel', async () => {
    vi.mocked(stateApi.getDashboard).mockResolvedValue(envelope(STATS) as never);

    renderScreen();

    expect(await screen.findByText('102.0%')).toBeInTheDocument();
  });

  it('signale une couverture insuffisante', async () => {
    vi.mocked(stateApi.getDashboard).mockResolvedValue(
      envelope({ ...STATS, coverageRatio: 0.93 }) as never
    );

    renderScreen();

    expect(await screen.findByText('93.0%')).toBeInTheDocument();
    expect(await screen.findAllByText('⚠️')).not.toHaveLength(0);
  });
});

describe('Tableau de bord Etat — divulgation du pret', () => {
  it("annonce l'or prete et ce qui reste en coffre", async () => {
    vi.mocked(stateApi.getDashboard).mockResolvedValue(envelope(STATS) as never);

    renderScreen();

    expect(await screen.findByText(/prêtés/)).toBeInTheDocument();
    expect(await screen.findByText(/Effectivement en coffre/)).toBeInTheDocument();
  });

  it('se tait quand toute la reserve est en coffre', async () => {
    vi.mocked(stateApi.getDashboard).mockResolvedValue(
      envelope({ ...STATS, goldOnLoan: 0, goldVaulted: 12500, fullyVaulted: true }) as never
    );

    renderScreen();

    await screen.findAllByText(/12500/);
    expect(screen.queryByText(/prêtés/)).not.toBeInTheDocument();
  });
});

describe('Tableau de bord Etat — une panne ne ressemble pas a une reserve vide', () => {
  it('avertit explicitement quand les chiffres ne sont pas chargeables', async () => {
    vi.mocked(stateApi.getDashboard).mockRejectedValue(new Error('API indisponible'));

    renderScreen();

    expect(await screen.findByText(/n'est pas un état réel de la réserve/)).toBeInTheDocument();
  });

  it('affiche un tiret plutot qu un zero', async () => {
    vi.mocked(stateApi.getDashboard).mockRejectedValue(new Error('API indisponible'));

    renderScreen();

    // Montrer « 0 g » a un ministere, c'est affirmer que la reserve est vide.
    expect(await screen.findAllByText(/—/)).not.toHaveLength(0);
    expect(screen.queryByText(/^0 g$/)).not.toBeInTheDocument();
  });
});
