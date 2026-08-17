import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationView } from '@tnc-trading/shared/contracts';
import { useState } from 'react';
import { formatRelativeTime } from '@tnc-trading/shared';
import api from '../lib/api';

/**
 * Boîte de réception.
 *
 * `GET /users/me/notifications` existait depuis le début, la table se
 * remplissait, et aucun client ne la lisait : une notification manquée était
 * perdue pour de bon. L'écran mobile a été fait en premier ; celui-ci lit la
 * même route, sous le même contrat partagé.
 */

const PAR_PAGE = 20;

/** Icône et teinte par type, avec un repli explicite pour l'inconnu. */
function apparence(type: string): { chemin: string; teinte: string } {
  const t = (type || '').toUpperCase();
  if (t.includes('TRANSACTION') || t.includes('BUY') || t.includes('SELL')) {
    return { chemin: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4', teinte: 'text-blue-400 bg-blue-500/10' };
  }
  if (t.includes('PRICE') || t.includes('ALERT')) {
    return { chemin: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6', teinte: 'text-gold-400 bg-gold-500/10' };
  }
  if (t.includes('KYC')) {
    return { chemin: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z', teinte: 'text-emerald-400 bg-emerald-500/10' };
  }
  if (t.includes('SECURITY') || t.includes('LOGIN')) {
    return { chemin: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z', teinte: 'text-red-400 bg-red-500/10' };
  }
  if (t.includes('WITHDRAW') || t.includes('DEPOSIT')) {
    return { chemin: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z', teinte: 'text-emerald-400 bg-emerald-500/10' };
  }
  return { chemin: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9', teinte: 'text-slate-400 bg-slate-500/10' };
}


export default function Notifications() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [erreur, setErreur] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['notifications', page],
    queryFn: () => api.getNotifications(page, PAR_PAGE),
  });

  const items = data?.data?.items ?? [];
  const total = data?.data?.total ?? 0;
  const nonLues = data?.data?.unread ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAR_PAGE));

  const invalider = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const marquerLu = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: invalider,
    onError: (e: Error) => setErreur(e.message),
  });

  const toutMarquer = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: invalider,
    onError: (e: Error) => setErreur(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Notifications</h1>
          <p className="text-sm text-slate-500 mt-1">
            {isError
              ? 'Historique indisponible'
              : nonLues > 0
                ? `${nonLues} non lue${nonLues > 1 ? 's' : ''} sur ${total}`
                : `${total} notification${total > 1 ? 's' : ''}`}
          </p>
        </div>

        {nonLues > 0 && (
          <button
            className="btn-secondary text-sm"
            onClick={() => toutMarquer.mutate()}
            disabled={toutMarquer.isPending}
          >
            Tout marquer comme lu
          </button>
        )}
      </div>

      {/* Une panne de chargement ne doit pas ressembler a une boite vide. */}
      {isError && (
        <div className="p-4 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-300">
          Vos notifications n'ont pas pu être chargées. Cette page est vide parce que la
          requête a échoué, pas parce que vous n'avez rien reçu.
        </div>
      )}

      {erreur && (
        <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-300 flex items-center justify-between gap-3">
          <span>{erreur}</span>
          <button className="underline text-xs" onClick={() => setErreur('')}>
            Fermer
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card h-20 animate-pulse bg-slate-800/40" />
          ))}
        </div>
      ) : items.length === 0 && !isError ? (
        <div className="card text-center py-12">
          <p className="text-slate-400">Aucune notification pour le moment.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((notification: NotificationView) => {
            const { chemin, teinte } = apparence(notification.type);
            return (
              <li key={notification.id}>
                <button
                  type="button"
                  onClick={() => !notification.read && marquerLu.mutate(notification.id)}
                  className={`card w-full text-left flex items-start gap-4 transition-colors ${
                    notification.read ? '' : 'border-gold-500/40'
                  }`}
                >
                  <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${teinte}`}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={chemin} />
                    </svg>
                  </span>

                  <span className="flex-1 min-w-0">
                    <span className="block font-medium text-slate-900 dark:text-white truncate">
                      {notification.title}
                    </span>
                    <span className="block text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                      {notification.body}
                    </span>
                    <span className="block text-xs text-slate-500 mt-1">
                      {formatRelativeTime(notification.createdAt)}
                    </span>
                  </span>

                  {/* La pastille ne disparaît qu'une fois le serveur d'accord :
                      la retirer localement afficherait un état qui n'existe pas. */}
                  {!notification.read && (
                    <span className="w-2 h-2 rounded-full bg-gold-500 shrink-0 mt-2" aria-label="Non lue" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            className="btn-secondary text-sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Précédent
          </button>
          <span className="text-sm text-slate-500">
            Page {page} sur {pages}
          </span>
          <button
            className="btn-secondary text-sm"
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page >= pages}
          >
            Suivant
          </button>
        </div>
      )}
    </div>
  );
}
