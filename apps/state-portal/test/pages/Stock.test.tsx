import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { StateStockData } from '@tnc-trading/shared/contracts';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Stock from '../../src/pages/Stock';
import { useStateStore } from '../../src/stores/auth';

vi.mock('../../src/lib/api', () => ({
  stateApi: {
    getStock: vi.fn(),
    getPrice: vi.fn(),
    setAuthErrorCallback: vi.fn(),
  },
}));

const { stateApi } = await import('../../src/lib/api');

/**
 * Un chiffre affiche par ce portail est lu comme un chiffre officiel. Ces tests
 * verifient donc deux choses : qu'il vient bien de la reponse, et qu'une absence
 * de reponse ne se deguise pas en mesure.
 */

const STOCK: StateStockData = {
  totalAllocated: 12500,
  tokensIssued: 9800,
  availableStock: 2700,
  goldOnLoan: 1500,
  goldVaulted: 11000,
  fullyVaulted: false,
  lendingNotice: "1 500 g sont prêtés au titre du programme de location et ne sont pas en coffre.",
  coverageRatio: 1.02,
  lastAuditDate: '2026-07-31',
  lastAuditResult: 'CONFORME',
};

/** Les separateurs de milliers francais sont des espaces insecables etroites. */
const digits = (text: string) => text.replace(/[\s  ]/g, '');

/**
 * Un meme chiffre apparait plusieurs fois a l ecran (carte principale et
 * legende de couverture). On verifie qu il EST affiche, pas qu il l est une
 * seule fois — compter les occurrences testerait la mise en page.
 */
const findNumber = async (value: string) => {
  const found = await screen.findAllByText((_content, element) => {
    if (!element || element.children.length > 0) return false;
    return digits(element.textContent ?? '').includes(digits(value));
  });
  return found;
};

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<Stock />, { wrapper });
}

beforeEach(() => {
  vi.mocked(stateApi.getPrice).mockResolvedValue({
    success: true,
    data: { priceXof: 53000 },
    requestId: 'req',
  } as never);
  useStateStore.getState().login({ id: 'u1', email: 'agent@bf.gov', ministry: 'Finances' });
});

describe('Ecran Stock — les chiffres viennent de la reponse', () => {
  it('affiche la reserve allouee, les tokens emis et le disponible', async () => {
    vi.mocked(stateApi.getStock).mockResolvedValue({
      success: true,
      data: STOCK,
      requestId: 'req',
    } as never);

    renderScreen();

    // Le defaut d'origine : le client lisait des champs inexistants et cet
    // ecran affichait 0 g de reserve nationale en permanence.
    expect(await findNumber('12500')).not.toHaveLength(0);
    expect(await findNumber('9800')).not.toHaveLength(0);
    expect(await findNumber('2700')).not.toHaveLength(0);
  });

  it('affiche le taux de couverture reel', async () => {
    vi.mocked(stateApi.getStock).mockResolvedValue({
      success: true,
      data: { ...STOCK, coverageRatio: 0.87 },
      requestId: 'req',
    } as never);

    renderScreen();

    expect(await screen.findByText('87.0% couvert')).toBeInTheDocument();
  });
});

describe('Ecran Stock — divulgation du pret', () => {
  it("annonce l'or prete et ce qui reste en coffre", async () => {
    vi.mocked(stateApi.getStock).mockResolvedValue({
      success: true,
      data: STOCK,
      requestId: 'req',
    } as never);

    renderScreen();

    expect(await screen.findAllByText(/prêtés/)).not.toHaveLength(0);
    expect(await findNumber('1500')).not.toHaveLength(0);
    expect(await screen.findByText(/Effectivement en coffre/)).toBeInTheDocument();
  });

  it("reprend l'avertissement de l'API mot pour mot", async () => {
    vi.mocked(stateApi.getStock).mockResolvedValue({
      success: true,
      data: STOCK,
      requestId: 'req',
    } as never);

    renderScreen();

    // Reformuler un avertissement sur la reserve nationale, c'est en changer la
    // portee. Il s'affiche tel que l'API l'ecrit.
    expect(await screen.findByText(STOCK.lendingNotice)).toBeInTheDocument();
  });

  it('ne montre aucun avertissement quand tout est en coffre', async () => {
    vi.mocked(stateApi.getStock).mockResolvedValue({
      success: true,
      data: { ...STOCK, goldOnLoan: 0, goldVaulted: 12500, fullyVaulted: true },
      requestId: 'req',
    } as never);

    renderScreen();

    expect(await findNumber('12500')).not.toHaveLength(0);
    expect(screen.queryByText(/prêtés/)).not.toBeInTheDocument();
  });
});

describe('Ecran Stock — une absence n est pas un zero', () => {
  it('affiche un tiret quand la reponse ne peut pas etre chargee', async () => {
    vi.mocked(stateApi.getStock).mockRejectedValue(new Error('API indisponible'));

    renderScreen();

    // « 0 g » se lit comme une reserve vide : c'est une affirmation. « — » dit
    // qu'on ne sait pas, ce qui est la verite.
    const tirets = await screen.findAllByText(/^—\s*g$/);
    expect(tirets.length).toBeGreaterThan(0);
    expect(screen.queryByText(/^0 g$/)).not.toBeInTheDocument();
  });
});
