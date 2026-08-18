import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { AdminProofOfReserveData } from '@tnc-trading/shared/contracts';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProofOfReserve from '../../src/pages/ProofOfReserve';
import { useAdminStore } from '../../src/stores/auth';

vi.mock('../../src/lib/api', () => ({
  adminApi: {
    getProofOfReserve: vi.fn(),
    downloadProofOfReservePdf: vi.fn(),
    setAuthErrorCallback: vi.fn(),
  },
}));

const { adminApi } = await import('../../src/lib/api');

/**
 * L'ecran Preuve de Reserve.
 *
 * Avant : le client declarait LOCALEMENT une forme imbriquee — `goldStock`,
 * `tokenHolders`, `transactions`, `pricing`, `audit`, `verification` — et la
 * route en emettait une autre, plate. Aucune de ces six cles n'existait dans la
 * reponse, si bien que `report.goldStock.isCovered` levait une TypeError des que
 * la requete aboutissait.
 *
 * Ce n'etait donc pas un ecran qui affichait des zeros : il ne s'affichait pas.
 * Un test de rendu sur une reponse simulee ne l'aurait pas attrape s'il avait
 * simule la forme ESPEREE — d'ou le typage strict de la fixture par le contrat
 * partage, qui est la vraie garantie ici.
 */

const enveloppe = (data: unknown) => ({ success: true, data, requestId: 'req' });

const RAPPORT: AdminProofOfReserveData = {
  generatedAt: '2026-08-18T06:00:00.000Z',
  goldStock: {
    totalAllocated: 1000,
    tokensIssued: 900,
    availableStock: 100,
    goldVaulted: 600,
    goldOnLoan: 400,
    coverageRatio: 1.11,
    utilisationRate: 0.9,
    isCovered: true,
    fullyVaulted: false,
  },
  tokenHolders: {
    totalHolders: 842,
    averageHolding: 1.07,
    distribution: [{ range: 'small', count: 800, totalTokens: 500 }],
  },
  transactions: {
    last24h: { buys: 12, sells: 3, volumeXof: 4_000_000 },
    last7d: { buys: 80, sells: 21, volumeXof: 28_000_000 },
    last30d: { buys: 310, sells: 96, volumeXof: 120_000_000 },
  },
  pricing: {
    priceXof: 53_000,
    buyPrice: 54_060,
    sellPrice: 51_940,
    spreadBuy: 0.02,
    spreadSell: 0.02,
    source: 'GoldAPI',
    timestamp: '2026-08-18T05:55:00.000Z',
  },
  audit: {
    lastAuditDate: '2026-07-31',
    lastAuditResult: 'CONFORME',
    nextAuditDue: '2026-08-30T00:00:00.000Z',
  },
  attestation: {
    sequence: 42,
    digest: 'a1b2c3d4e5f6',
    signedAt: '2026-08-18T00:30:00.000Z',
    signed: true,
    anchorTxHash: null,
  },
};

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<ProofOfReserve />, { wrapper });
}

beforeEach(() => {
  useAdminStore.getState().login?.({ id: 'a1', email: 'admin@tnc.bf' } as never);
});

describe('Preuve de Reserve — le rapport s affiche', () => {
  it('rend le rapport sans lever', async () => {
    vi.mocked(adminApi.getProofOfReserve).mockResolvedValue(enveloppe(RAPPORT) as never);

    renderScreen();

    // Le seul fait d'arriver ici est le constat : la version precedente levait
    // une TypeError sur `report.goldStock` avant le premier rendu utile.
    // (Le formatage est fr-FR : « 1 000,000 g », espace insecable compris.)
    expect(await screen.findAllByText(/000/)).not.toHaveLength(0);
    expect(screen.getByText(/Preuve de R|Proof of Reserve/i)).toBeInTheDocument();
  });

  it('affiche les jetons emis, pas la somme des portefeuilles', async () => {
    vi.mocked(adminApi.getProofOfReserve).mockResolvedValue(enveloppe(RAPPORT) as never);

    renderScreen();

    // 900 g emis, dont 400 places en location : la somme des portefeuilles
    // vaudrait 500 (ADR 012).
    expect(await screen.findAllByText(/900/)).not.toHaveLength(0);
  });

  it('publie l empreinte de l attestation signee', async () => {
    vi.mocked(adminApi.getProofOfReserve).mockResolvedValue(enveloppe(RAPPORT) as never);

    renderScreen();

    // La page annoncait un « checksum » qu'aucune route ne produisait. Ce qui
    // est verifiable est l'attestation signee.
    expect(await screen.findByText('a1b2c3d4e5f6')).toBeInTheDocument();
  });
});

describe('Preuve de Reserve — ce qui manque se dit', () => {
  it("n invente pas de cours quand aucun n a ete releve", async () => {
    vi.mocked(adminApi.getProofOfReserve).mockResolvedValue(
      enveloppe({ ...RAPPORT, pricing: null }) as never
    );

    renderScreen();

    expect(await screen.findByText('Aucun cours relevé')).toBeInTheDocument();
    // Un tableau de prix a zero se lirait comme un marche a l'arret.
    expect(screen.queryByText("Détails des Prix")).not.toBeInTheDocument();
  });

  it("dit qu aucune attestation n a ete emise plutot que d afficher une empreinte vide", async () => {
    vi.mocked(adminApi.getProofOfReserve).mockResolvedValue(
      enveloppe({ ...RAPPORT, attestation: null }) as never
    );

    renderScreen();

    expect(await screen.findByText('Aucune émise')).toBeInTheDocument();
  });
});
