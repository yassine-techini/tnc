import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  ReconciliationReportData,
  StuckTransactionsData,
  WalletDiscrepanciesData,
} from '@tnc-trading/shared/contracts';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Reconciliation from '../../src/pages/Reconciliation';
import { useAdminStore } from '../../src/stores/auth';

vi.mock('../../src/lib/api', () => ({
  adminApi: {
    getReconciliationReport: vi.fn(),
    getWalletDiscrepancies: vi.fn(),
    getStuckTransactions: vi.fn(),
    reconcileTransaction: vi.fn(),
    // Le magasin de session enregistre ce rappel au chargement du module.
    setAuthErrorCallback: vi.fn(),
  },
}));

const { adminApi } = await import('../../src/lib/api');

/**
 * L'ecran de reconciliation.
 *
 * Avant : il additionnait les mille premieres transactions dans le navigateur et
 * affichait `isBalanced: true` — une CONSTANTE. La banniere verte « comptes
 * equilibres » etait donc affichee quoi qu'il arrive. Ces tests verrouillent
 * l'inverse : ce qui s'affiche vient du serveur, et un serveur muet ne se lit
 * jamais comme un constat d'equilibre.
 */

const enveloppe = (data: unknown) => ({ success: true, data, requestId: 'req' });

const RAPPORT: ReconciliationReportData = {
  reportDate: '2026-08-17',
  periodStart: '2026-08-10T00:00:00.000Z',
  periodEnd: '2026-08-17T00:00:00.000Z',
  summary: {
    totalTransactions: 412,
    completedTransactions: 400,
    failedTransactions: 5,
    pendingTransactions: 4,
    processingTransactions: 2,
    cancelledTransactions: 1,
  },
  volumeByType: [{ type: 'BUY', count: 300, totalAmount: 15_000_000, completedAmount: 14_800_000 }],
  stuckTransactions: [],
  discrepancies: [],
};

const SANS_ECART: WalletDiscrepanciesData = { items: [], total: 0, hasDiscrepancies: false };

const AVEC_ECART: WalletDiscrepanciesData = {
  items: [
    { walletId: 'wal_7', expectedBalance: 1_200_000, actualBalance: 1_250_000, difference: 50_000 },
  ],
  total: 1,
  hasDiscrepancies: true,
};

const BLOQUEE: StuckTransactionsData = {
  items: [
    {
      id: 'txn_bloquee',
      user_id: 'usr_1',
      wallet_id: 'wal_1',
      type: 'DEPOSIT',
      status: 'PROCESSING',
      token_amount: null,
      cash_amount: 250_000,
      price_per_gram: null,
      fees: 0,
      payment_method: 'orange_money',
      payment_reference: 'OM-123',
      external_reference: null,
      failure_reason: null,
      created_at: '2026-08-17T05:00:00.000Z',
      completed_at: null,
    },
  ],
  total: 1,
  thresholdMinutes: 60,
};

const AUCUNE_BLOQUEE: StuckTransactionsData = { items: [], total: 0, thresholdMinutes: 60 };

function afficher() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<Reconciliation />, { wrapper });
}

/** Connecte un administrateur avec, ou sans, le droit de corriger. */
function connecter(peutCorriger: boolean) {
  useAdminStore.getState().login(
    { id: 'adm_1', email: 'admin@tnc.bf', role: 'SUPER_ADMIN' } as never,
    { reconciliation: peutCorriger ? ['view', 'update'] : ['view'] } as never
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  connecter(true);
  vi.mocked(adminApi.getReconciliationReport).mockResolvedValue(enveloppe(RAPPORT) as never);
  vi.mocked(adminApi.getWalletDiscrepancies).mockResolvedValue(enveloppe(SANS_ECART) as never);
  vi.mocked(adminApi.getStuckTransactions).mockResolvedValue(enveloppe(AUCUNE_BLOQUEE) as never);
  vi.mocked(adminApi.reconcileTransaction).mockResolvedValue(enveloppe({}) as never);
});

describe('L equilibre vient du serveur', () => {
  it('annonce equilibre quand le serveur ne signale aucun ecart', async () => {
    afficher();

    expect(await screen.findByText(/Comptes équilibrés/)).toBeInTheDocument();
  });

  it('annonce le desequilibre quand le serveur signale un ecart', async () => {
    vi.mocked(adminApi.getWalletDiscrepancies).mockResolvedValue(enveloppe(AVEC_ECART) as never);

    afficher();

    // C'est le test qui compte : avant, `isBalanced` etait la constante `true`
    // et cette branche rouge etait litteralement inatteignable.
    expect(await screen.findByText(/1 écart\(s\) de solde/)).toBeInTheDocument();
    expect(screen.queryByText(/Comptes équilibrés/)).not.toBeInTheDocument();
  });

  it('dit « etat inconnu » quand le rapport ne peut pas etre charge', async () => {
    vi.mocked(adminApi.getWalletDiscrepancies).mockRejectedValue(new Error('API indisponible'));

    afficher();

    // Une panne ne doit pas se lire comme un constat d'equilibre : sur des
    // comptes adosses a de l'or, le vert rassurant est une affirmation.
    expect(await screen.findByText(/État inconnu/)).toBeInTheDocument();
    expect(screen.queryByText(/Comptes équilibrés/)).not.toBeInTheDocument();
  });
});

describe('Ce qui est affiche vient de la reponse', () => {
  it('reprend la synthese de periode du serveur', async () => {
    afficher();

    expect(await screen.findByText('412')).toBeInTheDocument();
    expect(screen.getByText('400')).toBeInTheDocument();
  });

  it('detaille chaque ecart de solde', async () => {
    vi.mocked(adminApi.getWalletDiscrepancies).mockResolvedValue(enveloppe(AVEC_ECART) as never);

    afficher();

    expect(await screen.findByText('wal_7')).toBeInTheDocument();
    expect(screen.getByText(/\+50\s?000 XOF/)).toBeInTheDocument();
  });

  it('affiche un tiret plutot qu un zero quand un chiffre manque', async () => {
    vi.mocked(adminApi.getReconciliationReport).mockRejectedValue(new Error('indisponible'));

    afficher();

    // « 0 transaction » se lirait comme une mesure. Le tiret dit qu'on ne sait pas.
    const tirets = await screen.findAllByText('—');
    expect(tirets.length).toBeGreaterThan(0);
  });
});

describe('Transactions bloquees', () => {
  it('demande au serveur le seuil choisi', async () => {
    const user = userEvent.setup();
    afficher();
    await screen.findByText(/Transactions bloquées/);

    await user.selectOptions(screen.getByLabelText(/Bloquées depuis plus de/), '1440');

    await waitFor(() => expect(adminApi.getStuckTransactions).toHaveBeenCalledWith(1440));
  });

  it('resout une transaction via l API', async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.getStuckTransactions).mockResolvedValue(enveloppe(BLOQUEE) as never);

    afficher();
    await user.click(await screen.findByRole('button', { name: 'Résoudre' }));
    await user.type(screen.getByPlaceholderText(/Motif/), 'Confirmé par l opérateur');
    await user.click(screen.getByRole('button', { name: 'Marquer complétée' }));

    // L'action existait cote API et n'etait atteignable par personne.
    await waitFor(() =>
      expect(adminApi.reconcileTransaction).toHaveBeenCalledWith('txn_bloquee', 'complete', {
        reason: 'Confirmé par l opérateur',
      })
    );
  });
});

describe('Droits', () => {
  it('cache les actions a un role en lecture seule', async () => {
    connecter(false);
    vi.mocked(adminApi.getStuckTransactions).mockResolvedValue(enveloppe(BLOQUEE) as never);

    afficher();

    await screen.findByText('txn_bloquee');
    expect(screen.queryByRole('button', { name: 'Résoudre' })).not.toBeInTheDocument();
    expect(screen.getByText(/pas de la corriger/)).toBeInTheDocument();
  });

  it('propose les actions a un role qui peut corriger', async () => {
    vi.mocked(adminApi.getStuckTransactions).mockResolvedValue(enveloppe(BLOQUEE) as never);

    afficher();

    expect(await screen.findByRole('button', { name: 'Résoudre' })).toBeInTheDocument();
  });
});
