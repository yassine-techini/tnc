import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NotificationsData } from '@tnc-trading/shared/contracts';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Notifications from './Notifications';

vi.mock('../lib/api', () => ({
  default: {
    getNotifications: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
  },
}));

const api = (await import('../lib/api')).default;

/**
 * La boite de reception n'a jamais ete affichee nulle part : la route existait,
 * la table se remplissait, aucun client ne lisait. Ces tests figent les deux
 * choses qui comptent — que ce qui s'affiche vienne bien de la reponse, et
 * qu'une panne ne ressemble pas a une boite vide.
 */

const enveloppe = (data: NotificationsData) => ({ success: true, data, requestId: 'req' });

/** SQLite ecrit `datetime('now')` en UTC, SANS marqueur de fuseau. */
const ilYAMinutes = (n: number) =>
  new Date(Date.now() - n * 60_000).toISOString().replace('T', ' ').slice(0, 19);

const BOITE: NotificationsData = {
  items: [
    {
      id: 'ntf_1',
      type: 'TRANSACTION_COMPLETED',
      title: 'Achat confirme',
      body: "Vous avez achete 2,000 g d'or.",
      data: null,
      read: false,
      createdAt: ilYAMinutes(5),
    },
    {
      id: 'ntf_2',
      type: 'PRICE_ALERT',
      title: 'Alerte de prix atteinte',
      body: "L'or a depasse 54 000 XOF/g.",
      data: null,
      read: true,
      createdAt: ilYAMinutes(200),
    },
  ],
  total: 2,
  unread: 1,
  page: 1,
  limit: 20,
};

function afficher() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<Notifications />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getNotifications).mockResolvedValue(enveloppe(BOITE) as never);
  vi.mocked(api.markNotificationRead).mockResolvedValue({ success: true } as never);
  vi.mocked(api.markAllNotificationsRead).mockResolvedValue({ success: true } as never);
});

describe('Boite de reception — ce qui vient de la reponse', () => {
  it('affiche le titre et le corps de chaque notification', async () => {
    afficher();

    expect(await screen.findByText('Achat confirme')).toBeInTheDocument();
    expect(screen.getByText("Vous avez achete 2,000 g d'or.")).toBeInTheDocument();
    expect(screen.getByText('Alerte de prix atteinte')).toBeInTheDocument();
  });

  it('annonce le nombre de non-lues', async () => {
    afficher();

    expect(await screen.findByText('1 non lue sur 2')).toBeInTheDocument();
  });

  it('distingue visuellement une non-lue', async () => {
    afficher();

    await screen.findByText('Achat confirme');

    // Une seule des deux porte la pastille : sans elle, l'ecran ne dirait pas
    // ce qui reste a lire.
    expect(screen.getAllByLabelText('Non lue')).toHaveLength(1);
  });
});

describe('Boite de reception — horodatage', () => {
  it('lit les dates comme de l UTC', async () => {
    afficher();

    // SQLite ecrit « 2026-08-17 09:00:00 » sans « Z ». Interprete comme heure
    // locale, un evenement d'il y a cinq minutes s'afficherait decale d'un
    // fuseau entier — au Burkina, « il y a 1 h » pour quelque chose de present.
    expect(await screen.findByText('Il y a 5 minutes')).toBeInTheDocument();
  });

  it('passe aux heures au-dela de soixante minutes', async () => {
    afficher();

    expect(await screen.findByText('Il y a 3 heures')).toBeInTheDocument();
  });
});

describe('Boite de reception — marquer comme lu', () => {
  it('marque une non-lue au clic', async () => {
    const user = userEvent.setup();
    afficher();

    await user.click(await screen.findByText('Achat confirme'));

    await waitFor(() => expect(api.markNotificationRead).toHaveBeenCalledWith('ntf_1'));
  });

  it('ne renvoie rien pour une notification deja lue', async () => {
    const user = userEvent.setup();
    afficher();

    await user.click(await screen.findByText('Alerte de prix atteinte'));

    // Un appel inutile a chaque clic remplirait le journal d'ecritures sans effet.
    expect(api.markNotificationRead).not.toHaveBeenCalled();
  });

  it('propose de tout marquer seulement s il reste des non-lues', async () => {
    const user = userEvent.setup();
    afficher();

    await user.click(await screen.findByRole('button', { name: /tout marquer comme lu/i }));

    await waitFor(() => expect(api.markAllNotificationsRead).toHaveBeenCalled());
  });

  it('cache le bouton quand tout est lu', async () => {
    vi.mocked(api.getNotifications).mockResolvedValue(
      enveloppe({ ...BOITE, unread: 0 }) as never
    );

    afficher();

    await screen.findByText('Achat confirme');
    expect(screen.queryByRole('button', { name: /tout marquer comme lu/i })).not.toBeInTheDocument();
  });
});

describe('Boite de reception — une panne n est pas une boite vide', () => {
  it('dit que le chargement a echoue', async () => {
    vi.mocked(api.getNotifications).mockRejectedValue(new Error('API indisponible'));

    afficher();

    // « Aucune notification » serait une affirmation fausse : l'utilisateur en a
    // peut-etre, on ne le sait simplement pas.
    expect(await screen.findByText(/n'ont pas pu être chargées/)).toBeInTheDocument();
    expect(screen.queryByText('Aucune notification pour le moment.')).not.toBeInTheDocument();
  });

  it('affiche la boite vide quand elle est reellement vide', async () => {
    vi.mocked(api.getNotifications).mockResolvedValue(
      enveloppe({ items: [], total: 0, unread: 0, page: 1, limit: 20 }) as never
    );

    afficher();

    expect(await screen.findByText('Aucune notification pour le moment.')).toBeInTheDocument();
  });
});

describe('Boite de reception — pagination', () => {
  it('ne montre aucune pagination sur une seule page', async () => {
    afficher();

    await screen.findByText('Achat confirme');
    expect(screen.queryByRole('button', { name: 'Suivant' })).not.toBeInTheDocument();
  });

  it('demande la page suivante au serveur', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getNotifications).mockResolvedValue(enveloppe({ ...BOITE, total: 45 }) as never);

    afficher();
    await user.click(await screen.findByRole('button', { name: 'Suivant' }));

    // Pagination cote serveur : decouper une liste deja tronquee a vingt
    // elements ne montrerait jamais la vingt-et-unieme.
    await waitFor(() => expect(api.getNotifications).toHaveBeenCalledWith(2, 20));
  });
});
