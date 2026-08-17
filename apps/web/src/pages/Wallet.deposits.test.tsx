import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PendingDepositsData } from '@tnc-trading/shared/contracts';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Wallet from './Wallet';
import { useAuthStore } from '../stores/auth';

vi.mock('../lib/api', () => {
  const api = {
    getWallet: vi.fn(),
    getTransactions: vi.fn(),
    getPrice: vi.fn(),
    getPendingDeposits: vi.fn(),
    cancelDeposit: vi.fn(),
    deposit: vi.fn(),
    withdraw: vi.fn(),
    getProfile: vi.fn(),
    setAuthErrorCallback: vi.fn(),
  };
  return { api, default: api };
});

const { api } = await import('../lib/api');

/**
 * Depots en cours.
 *
 * Les trois routes du cycle de vie d'un depot etaient servies et appelees par
 * personne : un depot mobile-money bloque chez l'operateur restait invisible et
 * non annulable. Ces tests verrouillent les deux comportements.
 */

const enveloppe = (data: unknown) => ({ success: true, data, requestId: 'req' });

const EN_ATTENTE: PendingDepositsData = {
  items: [
    {
      id: 'dep_1',
      amount: 250_000,
      status: 'PENDING',
      paymentMethod: 'orange_money',
      paymentReference: 'OM-99123',
      createdAt: '2026-08-17T09:00:00.000Z',
      updatedAt: '2026-08-17T09:00:00.000Z',
    },
  ],
  total: 1,
};

const EN_TRAITEMENT: PendingDepositsData = {
  items: [{ ...EN_ATTENTE.items[0], id: 'dep_2', status: 'PROCESSING' }],
  total: 1,
};

const AUCUN: PendingDepositsData = { items: [], total: 0 };

function afficher() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<Wallet />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: 'usr_1', email: 'client@example.bf', kycLevel: 'VERIFIED' },
  } as never);
  vi.mocked(api.getWallet).mockResolvedValue(
    enveloppe({ tokenBalance: 10, cashBalance: 500_000, averageBuyPrice: 52_000 }) as never
  );
  vi.mocked(api.getTransactions).mockResolvedValue(enveloppe({ items: [], total: 0 }) as never);
  vi.mocked(api.getPrice).mockResolvedValue(
    enveloppe({ buyPrice: 53_000, sellPrice: 52_000, priceXof: 52_500 }) as never
  );
  vi.mocked(api.getProfile).mockResolvedValue(enveloppe({ kycLevel: 'VERIFIED' }) as never);
  vi.mocked(api.getPendingDeposits).mockResolvedValue(enveloppe(AUCUN) as never);
  vi.mocked(api.cancelDeposit).mockResolvedValue(enveloppe({ transactionId: 'dep_1' }) as never);
});

describe('Un depot en cours est visible', () => {
  it('affiche le montant et le moyen de paiement', async () => {
    vi.mocked(api.getPendingDeposits).mockResolvedValue(enveloppe(EN_ATTENTE) as never);

    afficher();

    expect(await screen.findByText(/Dépôt en cours/)).toBeInTheDocument();
    expect(screen.getByText(/orange_money/)).toBeInTheDocument();
    expect(screen.getByText('OM-99123')).toBeInTheDocument();
  });

  it("n'affiche rien quand aucun depot n'est en cours", async () => {
    afficher();

    await screen.findByText('Actions');
    expect(screen.queryByText(/Dépôt en cours/)).not.toBeInTheDocument();
  });
});

describe('Annulation', () => {
  it('annule un depot en attente', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getPendingDeposits).mockResolvedValue(enveloppe(EN_ATTENTE) as never);

    afficher();
    await user.click(await screen.findByRole('button', { name: 'Annuler' }));

    await waitFor(() => expect(api.cancelDeposit).toHaveBeenCalledWith('dep_1'));
  });

  it("ne propose pas d'annuler un depot deja en traitement", async () => {
    vi.mocked(api.getPendingDeposits).mockResolvedValue(enveloppe(EN_TRAITEMENT) as never);

    afficher();

    // L'API refuse l'annulation hors PENDING : afficher le bouton promettrait
    // quelque chose qu'elle ne fera pas.
    await screen.findByText(/en cours de traitement/);
    expect(screen.queryByRole('button', { name: 'Annuler' })).not.toBeInTheDocument();
  });
});
