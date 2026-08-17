import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReconciliationTransaction } from '@tnc-trading/shared/contracts';
import { useState } from 'react';
import { adminApi } from '../lib/api';
import { useAdminStore } from '../stores/auth';

/**
 * Réconciliation — lue depuis le serveur, plus recalculée dans le navigateur.
 *
 * Cet écran additionnait les mille premières transactions côté client et
 * affichait `isBalanced: true` — une CONSTANTE. La bannière verte « comptes
 * équilibrés » était donc affichée quoi qu'il arrive, et la branche rouge était
 * inatteignable. Six endpoints faisaient autorité sur la question ; aucun n'était
 * appelé.
 *
 * Tout ce qui s'affiche ici vient désormais de `/admin/reconciliation/*`, sous
 * contrat partagé.
 */

const SEUILS = [15, 30, 60, 180, 1440] as const;

const ACTIONS = [
  { cle: 'complete' as const, libelle: 'Marquer complétée', ton: 'btn-primary' },
  { cle: 'fail' as const, libelle: 'Marquer échouée', ton: 'btn-secondary' },
  { cle: 'cancel' as const, libelle: 'Annuler', ton: 'btn-secondary' },
];

function xof(montant: number): string {
  return `${Math.round(montant).toLocaleString('fr-FR')} XOF`;
}

/** Un chiffre absent n'est pas zéro — même règle que sur le portail État. */
function nombre(valeur: number | undefined): string {
  return typeof valeur === 'number' && Number.isFinite(valeur)
    ? valeur.toLocaleString('fr-FR')
    : '—';
}

export default function Reconciliation() {
  const { isAuthenticated, hasPermission } = useAdminStore();
  const queryClient = useQueryClient();
  const [seuil, setSeuil] = useState<number>(60);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [motif, setMotif] = useState('');
  const [erreur, setErreur] = useState('');

  const peutAgir = hasPermission('reconciliation', 'update');

  const rapport = useQuery({
    queryKey: ['reconciliation-report'],
    queryFn: () => adminApi.getReconciliationReport(),
    enabled: isAuthenticated,
  });

  const ecarts = useQuery({
    queryKey: ['reconciliation-discrepancies'],
    queryFn: () => adminApi.getWalletDiscrepancies(),
    enabled: isAuthenticated,
  });

  const bloquees = useQuery({
    queryKey: ['reconciliation-stuck', seuil],
    queryFn: () => adminApi.getStuckTransactions(seuil),
    enabled: isAuthenticated,
  });

  const resoudre = useMutation({
    mutationFn: (params: { id: string; action: 'complete' | 'fail' | 'cancel' }) =>
      adminApi.reconcileTransaction(params.id, params.action, {
        reason: motif || undefined,
      }),
    onSuccess: () => {
      setEnCours(null);
      setMotif('');
      queryClient.invalidateQueries({ queryKey: ['reconciliation-stuck'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliation-report'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliation-discrepancies'] });
    },
    onError: (e: Error) => setErreur(e.message),
  });

  const donneesRapport = rapport.data?.data;
  const donneesEcarts = ecarts.data?.data;
  const donneesBloquees = bloquees.data?.data;

  // L'état d'équilibre vient du serveur. Quand il n'a pas pu être chargé, on ne
  // sait pas — et on le dit, plutôt que d'afficher un vert rassurant.
  const chargementEchoue = rapport.isError || ecarts.isError;
  const nbEcarts = donneesEcarts?.total;
  const equilibre = donneesEcarts?.hasDiscrepancies === false;

  const exporterRapport = () => {
    if (!donneesRapport) return;
    // Le rapport exporté est celui du serveur, pas une addition faite ici.
    const blob = new Blob([JSON.stringify(donneesRapport, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const lien = document.createElement('a');
    lien.href = url;
    lien.download = `reconciliation_${donneesRapport.reportDate}.json`;
    document.body.appendChild(lien);
    lien.click();
    document.body.removeChild(lien);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Réconciliation</h1>
          <p className="text-sm text-slate-500 mt-1">
            Écarts de solde, transactions bloquées et rapport de période — tels que le serveur les
            établit
          </p>
        </div>
        <button
          className="btn-secondary text-sm"
          onClick={exporterRapport}
          disabled={!donneesRapport}
        >
          Exporter le rapport
        </button>
      </div>

      {erreur && (
        <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-300 flex items-center justify-between gap-3">
          <span>{erreur}</span>
          <button className="underline text-xs" onClick={() => setErreur('')}>
            Fermer
          </button>
        </div>
      )}

      {/* Bannière d'état — ni verte par défaut, ni muette en cas de panne. */}
      <div
        className={`p-4 rounded-xl border ${
          chargementEchoue
            ? 'bg-slate-500/10 border-slate-500/25'
            : equilibre
              ? 'bg-emerald-500/10 border-emerald-500/25'
              : 'bg-red-500/10 border-red-500/25'
        }`}
      >
        {chargementEchoue ? (
          <p className="text-sm text-slate-300">
            <span className="font-semibold">État inconnu.</span> Le rapport de réconciliation n'a
            pas pu être chargé — ce n'est pas un constat d'équilibre.
          </p>
        ) : rapport.isLoading || ecarts.isLoading ? (
          <p className="text-sm text-slate-400">Vérification en cours…</p>
        ) : equilibre ? (
          <p className="text-sm text-emerald-300">
            <span className="font-semibold">Comptes équilibrés.</span> Aucun écart entre les soldes
            de portefeuille et la somme de leurs mouvements.
          </p>
        ) : (
          <p className="text-sm text-red-300">
            <span className="font-semibold">{nombre(nbEcarts)} écart(s) de solde.</span> Un
            portefeuille détient un montant que ses mouvements ne justifient pas.
          </p>
        )}
      </div>

      {/* Synthèse de période, telle que le serveur la calcule */}
      <section className="card">
        <h2 className="text-sm font-semibold text-slate-300 mb-4">
          Période{' '}
          {donneesRapport
            ? `du ${donneesRapport.periodStart.slice(0, 10)} au ${donneesRapport.periodEnd.slice(0, 10)}`
            : ''}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            ['Total', donneesRapport?.summary.totalTransactions],
            ['Complétées', donneesRapport?.summary.completedTransactions],
            ['En cours', donneesRapport?.summary.processingTransactions],
            ['En attente', donneesRapport?.summary.pendingTransactions],
            ['Échouées', donneesRapport?.summary.failedTransactions],
            ['Annulées', donneesRapport?.summary.cancelledTransactions],
          ].map(([libelle, valeur]) => (
            <div key={libelle as string}>
              <p className="text-[11px] uppercase tracking-wider text-slate-500">{libelle}</p>
              <p className="text-xl font-semibold text-white mt-1 tabular-nums">
                {nombre(valeur as number | undefined)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Volumes par type */}
      {donneesRapport && donneesRapport.volumeByType.length > 0 && (
        <section className="card overflow-x-auto">
          <h2 className="text-sm font-semibold text-slate-300 mb-4">Volume par type</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                <th className="text-left pb-2">Type</th>
                <th className="text-right pb-2">Nombre</th>
                <th className="text-right pb-2">Montant total</th>
                <th className="text-right pb-2">Dont complété</th>
              </tr>
            </thead>
            <tbody>
              {donneesRapport.volumeByType.map((ligne) => (
                <tr key={ligne.type} className="border-t border-slate-800">
                  <td className="py-2 text-slate-300">{ligne.type}</td>
                  <td className="py-2 text-right tabular-nums">{nombre(ligne.count)}</td>
                  <td className="py-2 text-right tabular-nums">{xof(ligne.totalAmount)}</td>
                  <td className="py-2 text-right tabular-nums text-emerald-400">
                    {xof(ligne.completedAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Écarts de solde */}
      {donneesEcarts && donneesEcarts.items.length > 0 && (
        <section className="card overflow-x-auto">
          <h2 className="text-sm font-semibold text-red-400 mb-4">
            Écarts de solde ({donneesEcarts.total})
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                <th className="text-left pb-2">Portefeuille</th>
                <th className="text-right pb-2">Attendu</th>
                <th className="text-right pb-2">Constaté</th>
                <th className="text-right pb-2">Écart</th>
              </tr>
            </thead>
            <tbody>
              {donneesEcarts.items.map((e) => (
                <tr key={e.walletId} className="border-t border-slate-800">
                  <td className="py-2 font-mono text-xs text-slate-400">{e.walletId}</td>
                  <td className="py-2 text-right tabular-nums">{xof(e.expectedBalance)}</td>
                  <td className="py-2 text-right tabular-nums">{xof(e.actualBalance)}</td>
                  <td
                    className={`py-2 text-right tabular-nums font-semibold ${
                      e.difference > 0 ? 'text-amber-400' : 'text-red-400'
                    }`}
                  >
                    {e.difference > 0 ? '+' : ''}
                    {xof(e.difference)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Transactions bloquées, avec les actions que l'API sait exécuter */}
      <section className="card">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <h2 className="text-sm font-semibold text-slate-300">
            Transactions bloquées ({nombre(donneesBloquees?.total)})
          </h2>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500" htmlFor="seuil">
              Bloquées depuis plus de
            </label>
            <select
              id="seuil"
              className="input text-sm py-1"
              value={seuil}
              onChange={(e) => setSeuil(Number(e.target.value))}
            >
              {SEUILS.map((s) => (
                <option key={s} value={s}>
                  {s >= 60 ? `${s / 60} h` : `${s} min`}
                </option>
              ))}
            </select>
          </div>
        </div>

        {bloquees.isLoading ? (
          <p className="text-sm text-slate-500">Chargement…</p>
        ) : donneesBloquees && donneesBloquees.items.length === 0 ? (
          <p className="text-sm text-slate-500">
            Aucune transaction bloquée au-delà de ce seuil.
          </p>
        ) : (
          <ul className="space-y-3">
            {donneesBloquees?.items.map((t: ReconciliationTransaction) => (
              <li key={t.id} className="p-3 rounded-lg bg-slate-900/50 border border-slate-800">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm text-white">
                      {t.type} · <span className="text-slate-400">{t.status}</span>
                    </p>
                    <p className="font-mono text-[11px] text-slate-500 mt-0.5">{t.id}</p>
                    <p className="text-xs text-slate-400 mt-1 tabular-nums">
                      {xof(t.cash_amount)}
                      {t.token_amount ? ` · ${t.token_amount} g` : ''} · créée le{' '}
                      {t.created_at.slice(0, 16).replace('T', ' ')}
                    </p>
                    {t.failure_reason && (
                      <p className="text-xs text-red-400 mt-1">{t.failure_reason}</p>
                    )}
                  </div>

                  {peutAgir && (
                    <button
                      className="btn-secondary text-xs"
                      onClick={() => setEnCours(enCours === t.id ? null : t.id)}
                    >
                      {enCours === t.id ? 'Fermer' : 'Résoudre'}
                    </button>
                  )}
                </div>

                {enCours === t.id && peutAgir && (
                  <div className="mt-3 pt-3 border-t border-slate-800 space-y-2">
                    <input
                      className="input w-full text-sm"
                      placeholder="Motif (consigné dans la piste d'audit)"
                      value={motif}
                      onChange={(e) => setMotif(e.target.value)}
                    />
                    <div className="flex gap-2 flex-wrap">
                      {ACTIONS.map((a) => (
                        <button
                          key={a.cle}
                          className={`${a.ton} text-xs`}
                          disabled={resoudre.isPending}
                          onClick={() => resoudre.mutate({ id: t.id, action: a.cle })}
                        >
                          {a.libelle}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {!peutAgir && donneesBloquees && donneesBloquees.items.length > 0 && (
          <p className="text-xs text-slate-500 mt-3">
            Votre rôle permet de consulter la réconciliation, pas de la corriger.
          </p>
        )}
      </section>
    </div>
  );
}
