/**
 * Support — ce qui a échoué et ce qui est dû.
 *
 * Deux listes que personne ne pouvait consulter jusqu'ici :
 *
 *  - Les répartitions de lot **incomplètes**. Une jambe financière a échoué ;
 *    le producteur le voit sur son écran s'il regarde, la plateforme n'avait
 *    aucun moyen de l'apprendre.
 *  - Les **arriérés de frais de garde**. Aucun recouvrement n'est automatisé
 *    (ADR 005), donc le minimum est de savoir qui doit quoi.
 *
 * Les deux affichent explicitement leur filtre : une liste vide doit se lire
 * « rien à traiter », jamais « la page est cassée ».
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi, type AdminDisposition, type StorageFeeDebtor } from '../lib/api';

const g = (n: number) => `${(Math.round(n * 1000) / 1000).toFixed(3)} g`;
const xof = (n: number) => `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA`;

const statusColor: Record<string, string> = {
  PARTIAL: 'text-amber-400 bg-amber-500/10',
  FAILED: 'text-red-400 bg-red-500/10',
  PENDING: 'text-slate-400 bg-slate-500/10',
  EXECUTED: 'text-emerald-400 bg-emerald-500/10',
};

export default function Support() {
  const [status, setStatus] = useState<string>('');

  const { data: dispositions, isLoading: loadingDispositions } = useQuery({
    queryKey: ['admin-dispositions', status],
    queryFn: () => adminApi.getDispositions(status || undefined),
  });

  const { data: fees, isLoading: loadingFees } = useQuery({
    queryKey: ['admin-storage-fees'],
    queryFn: () => adminApi.getOutstandingStorageFees(),
  });

  const items = dispositions?.data?.items || [];
  const debtors = fees?.data?.items || [];

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Répartitions de lot</h2>
            <p className="text-sm text-slate-400">
              {/* Le filtre est dit : une liste vide ne veut pas dire « aucune
                  répartition », mais « aucune à traiter ». */}
              Filtre : {dispositions?.data?.filter || '—'}
            </p>
          </div>
          <select
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">À traiter (défaut)</option>
            <option value="PARTIAL">Partiellement exécutées</option>
            <option value="FAILED">Échouées</option>
            <option value="EXECUTED">Abouties</option>
          </select>
        </div>

        {loadingDispositions ? (
          <p className="text-slate-500 text-sm">Chargement…</p>
        ) : items.length === 0 ? (
          <p className="text-slate-500 text-sm py-6">Aucune répartition à traiter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 text-left">
                  <th className="pb-2">Lot</th>
                  <th className="pb-2">Vendu</th>
                  <th className="pb-2">Loué</th>
                  <th className="pb-2">Gardé</th>
                  <th className="pb-2">État</th>
                  <th className="pb-2">Motif</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {items.map((d: AdminDisposition) => (
                  <tr key={d.id} className="border-t border-slate-800 align-top">
                    <td className="py-2">
                      <span className="font-mono">{d.reference ?? '—'}</span>
                      {/* Une répartition dont le lot a disparu reste visible :
                          le cas le plus anormal ne doit pas être le seul caché. */}
                      {!d.reference && (
                        <span className="block text-xs text-amber-400">lot introuvable</span>
                      )}
                    </td>
                    <td className="py-2">
                      {g(d.sell_g)}
                      {d.sell_status === 'FAILED' && (
                        <span className="block text-xs text-red-400">échec</span>
                      )}
                    </td>
                    <td className="py-2">
                      {g(d.lease_g)}
                      {d.lease_status === 'FAILED' && (
                        <span className="block text-xs text-red-400">échec</span>
                      )}
                    </td>
                    <td className="py-2">{g(d.store_g)}</td>
                    <td className="py-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${statusColor[d.status] || ''}`}>
                        {d.status}
                      </span>
                    </td>
                    <td className="py-2 text-xs text-slate-400 max-w-xs">
                      {d.failure_reason || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Frais de garde dus</h2>
          {fees?.data && (
            <p className="text-sm text-slate-400">
              Total : <span className="text-slate-200">{xof(fees.data.totalXof)}</span>
            </p>
          )}
        </div>

        {/* Verbatim de l'API : la distinction que cette page existe pour rendre
            visible. */}
        {fees?.data?.notice && (
          <p className="text-sm text-amber-200/90 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
            {fees.data.notice}
          </p>
        )}

        {loadingFees ? (
          <p className="text-slate-500 text-sm">Chargement…</p>
        ) : debtors.length === 0 ? (
          <p className="text-slate-500 text-sm py-6">Aucun arriéré.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 text-left">
                  <th className="pb-2">Détenteur</th>
                  <th className="pb-2">Jours</th>
                  <th className="pb-2">Depuis</th>
                  <th className="pb-2 text-right">Dû</th>
                  <th className="pb-2 text-right">Solde espèces</th>
                  <th className="pb-2">Lecture</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {debtors.map((d: StorageFeeDebtor) => {
                  // Un arriéré sur un compte approvisionné n'est pas un
                  // débiteur : c'est le prélèvement qui n'a pas tourné.
                  const jobStalled = (d.cash_balance ?? 0) >= d.total_xof;
                  return (
                    <tr key={d.user_id} className="border-t border-slate-800">
                      <td className="py-2 font-mono text-xs">{d.user_id.slice(0, 8)}</td>
                      <td className="py-2">{d.days_outstanding}</td>
                      <td className="py-2 text-slate-400">{d.oldest}</td>
                      <td className="py-2 text-right text-amber-400">{xof(d.total_xof)}</td>
                      <td className="py-2 text-right text-slate-400">
                        {d.cash_balance != null ? xof(d.cash_balance) : '—'}
                      </td>
                      <td className="py-2 text-xs">
                        {jobStalled ? (
                          <span className="text-red-400">prélèvement en panne</span>
                        ) : (
                          <span className="text-slate-500">solde insuffisant</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
