/**
 * Frais de garde à Dubaï.
 *
 * Silencieux quand rien n'est dû — un raffineur qui n'a pas d'arriéré n'a pas
 * besoin d'un bandeau permanent. Visible dès qu'un frais reste impayé, parce
 * qu'une dette qu'on n'affiche pas est une mauvaise surprise différée.
 *
 * Le détail est jour par jour : le total se recalcule à partir des lignes au
 * lieu d'être cru sur parole, comme pour le rendement de location.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';
import { formatCurrency, formatGrams } from '../../lib/formatters';

export function StorageFees() {
  const [expanded, setExpanded] = useState(false);

  const { data } = useQuery({
    queryKey: ['storage-fees'],
    queryFn: () => api.getStorageFees(),
  });

  const fees = data?.data;
  if (!fees) return null;

  const hasDebt = fees.outstandingXof > 0;
  // Rien dû et aucun historique : ne rien afficher du tout.
  if (!hasDebt && fees.accruals.length === 0) return null;

  return (
    <div
      className={`card ${hasDebt ? 'border border-amber-500/30' : ''}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-white text-sm">Frais de garde</h3>
          {hasDebt ? (
            <p className="text-sm text-amber-300 mt-1">
              {formatCurrency(fees.outstandingXof)} en attente de prélèvement
              {fees.outstandingCount > 1 ? ` (${fees.outstandingCount} jours)` : ''}
            </p>
          ) : (
            <p className="text-sm text-slate-400 mt-1">À jour</p>
          )}
        </div>
        <button
          className="text-xs text-slate-400 hover:text-white whitespace-nowrap"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Masquer' : 'Détail'}
        </button>
      </div>

      {hasDebt && (
        // Verbatim de l'API : le raffineur doit savoir que rien n'est perdu et
        // que le prélèvement se fera tout seul.
        <p className="text-xs text-slate-400 mt-3">{fees.notice}</p>
      )}

      {expanded && (
        <div className="mt-4 overflow-x-auto">
          {fees.accruals.length === 0 ? (
            <p className="text-sm text-slate-500">Aucun frais enregistré.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 text-left">
                  <th className="pb-2">Jour</th>
                  <th className="pb-2">Or gardé</th>
                  <th className="pb-2 text-right">Frais</th>
                  <th className="pb-2 text-right">État</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {fees.accruals.map((a) => (
                  <tr key={a.accrual_date} className="border-t border-slate-800">
                    <td className="py-1.5">{a.accrual_date}</td>
                    <td className="py-1.5 text-slate-400">{formatGrams(a.stored_g)}</td>
                    <td className="py-1.5 text-right">{formatCurrency(a.amount_xof)}</td>
                    <td className="py-1.5 text-right">
                      <span className={a.status === 'PAID' ? 'text-slate-500' : 'text-amber-400'}>
                        {a.status === 'PAID' ? 'Prélevé' : 'Dû'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
