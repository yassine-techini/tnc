import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Login from '../../src/pages/Login';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../../src/lib/api', () => ({
  stateApi: {
    stateLogin: vi.fn(),
    state2FASetup: vi.fn(),
    state2FAVerify: vi.fn(),
    setAuthErrorCallback: vi.fn(),
  },
}));

const { stateApi } = await import('../../src/lib/api');

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

const renderScreen = () => render(<Login />, { wrapper });

const submitCredentials = async () => {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText('agent@finances.gov.bf'), 'agent@finances.gov.bf');
  await user.type(screen.getByPlaceholderText('********'), 'MotDePasse!');
  await user.click(screen.getByRole('button', { name: /connexion|se connecter/i }));
  return user;
};

beforeEach(() => {
  navigate.mockClear();
});

describe('Connexion Etat — second facteur', () => {
  it('demande le code quand la 2FA est deja configuree', async () => {
    vi.mocked(stateApi.stateLogin).mockResolvedValue({
      success: false,
      requires2FA: true,
      error: { code: '2FA_REQUIRED', message: 'Code requis' },
    } as never);

    renderScreen();
    await submitCredentials();

    expect(await screen.findByPlaceholderText('000000')).toBeInTheDocument();
  });

  it("montre la cle secrete lors de l'enrolement", async () => {
    vi.mocked(stateApi.stateLogin).mockResolvedValue({
      success: false,
      requires2FASetup: true,
      setupToken: 'stk_1',
      error: { code: '2FA_SETUP_REQUIRED', message: 'Enrolement requis' },
    } as never);
    vi.mocked(stateApi.state2FASetup).mockResolvedValue({
      success: true,
      data: {
        secret: 'JBSWY3DPEHPK3PXP',
        uri: 'otpauth://totp/TNC:agent@finances.gov.bf?secret=JBSWY3DPEHPK3PXP&issuer=TNC',
        issuer: 'TNC',
        message: 'ok',
      },
      requestId: 'req',
    } as never);

    renderScreen();
    await submitCredentials();

    // Sur l'app web, tout ce bloc etait masque derriere un champ inexistant :
    // la cle n'apparaissait jamais et la 2FA etait impossible a activer.
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
  });

  it("n'envoie la graine TOTP a aucun service tiers", async () => {
    vi.mocked(stateApi.stateLogin).mockResolvedValue({
      success: false,
      requires2FASetup: true,
      setupToken: 'stk_1',
      error: { code: '2FA_SETUP_REQUIRED', message: 'Enrolement requis' },
    } as never);
    vi.mocked(stateApi.state2FASetup).mockResolvedValue({
      success: true,
      data: {
        secret: 'JBSWY3DPEHPK3PXP',
        uri: 'otpauth://totp/TNC:agent@finances.gov.bf?secret=JBSWY3DPEHPK3PXP&issuer=TNC',
        issuer: 'TNC',
        message: 'ok',
      },
      requestId: 'req',
    } as never);

    const { container } = renderScreen();
    await submitCredentials();
    await screen.findByText('JBSWY3DPEHPK3PXP');

    // L'ecran faisait dessiner le QR par api.qrserver.com, ce qui revenait a
    // confier le second facteur d'un compte de l'Etat a un tiers. Le lien
    // otpauth:// reste local ; aucune ressource distante ne doit porter la cle.
    const remoteRefs = [...container.querySelectorAll('img, iframe, script')].map(
      (el) => el.getAttribute('src') ?? ''
    );
    expect(remoteRefs.filter((src) => src.startsWith('http'))).toHaveLength(0);
    expect(container.innerHTML).not.toContain('qrserver');

    const lien = screen.getByRole('link', { name: /application d'authentification/i });
    expect(lien).toHaveAttribute('href', expect.stringContaining('otpauth://'));
  });
});

describe('Connexion Etat — echecs', () => {
  it("affiche le message de l'API et ne navigue pas", async () => {
    vi.mocked(stateApi.stateLogin).mockRejectedValue(
      new Error('Email ou mot de passe incorrect')
    );

    renderScreen();
    await submitCredentials();

    expect(await screen.findByText('Email ou mot de passe incorrect')).toBeInTheDocument();
    await waitFor(() => expect(navigate).not.toHaveBeenCalled());
  });
});
