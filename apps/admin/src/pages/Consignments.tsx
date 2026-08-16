import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminStore } from '../stores/auth';
import { adminApi } from '../lib/api';

function AdminAuthPhoto({ consignmentId, idx }: { consignmentId: string; idx: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let obj: string | null = null;
    let alive = true;
    adminApi.fetchConsignmentPhoto(consignmentId, idx).then((u) => { if (alive) { obj = u; setUrl(u); } }).catch(() => {});
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); };
  }, [consignmentId, idx]);
  return url
    ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="" className="w-20 h-20 object-cover rounded-lg border border-slate-700" /></a>
    : <div className="w-20 h-20 rounded-lg bg-slate-800 animate-pulse" />;
}

function AdminPhotoStrip({ consignmentId, photosJson }: { consignmentId: string; photosJson: string | null }) {
  let count = 0;
  try { count = photosJson ? (JSON.parse(photosJson) as string[]).length : 0; } catch { count = 0; }
  if (count === 0) return null;
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">Photos ({count})</h3>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: count }).map((_, i) => <AdminAuthPhoto key={i} consignmentId={consignmentId} idx={i} />)}
      </div>
    </div>
  );
}

const statusBadge: Record<string, string> = {
  SUBMITTED: 'badge-warning',
  FORWARDER_VALIDATED: 'badge-info',
  IN_TRANSIT: 'badge-info',
  ARRIVED_DUBAI: 'badge-info',
  AUDIT_VALIDATED: 'badge-success',
  REJECTED: 'badge-error',
};

const statusLabels: Record<string, string> = {
  SUBMITTED: 'Soumis',
  FORWARDER_VALIDATED: 'Validé transitaire',
  IN_TRANSIT: 'En transit',
  ARRIVED_DUBAI: 'Arrivé à Dubaï',
  AUDIT_VALIDATED: 'Audit validé',
  REJECTED: 'Rejeté',
};

const goldTypeLabels: Record<string, string> = { nuggets: 'Pépites', powder: 'Poudre', bar: 'Barre' };

const FILTERS = ['', 'SUBMITTED', 'FORWARDER_VALIDATED', 'IN_TRANSIT', 'ARRIVED_DUBAI', 'AUDIT_VALIDATED', 'REJECTED'];

export default function Consignments() {
  const { isAuthenticated, hasPermission } = useAdminStore();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const canUpdate = hasPermission('consignments', 'update');
  const canApprove = hasPermission('consignments', 'approve');
  const canReject = hasPermission('consignments', 'reject');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-consignments', statusFilter],
    queryFn: () => adminApi.getConsignments(statusFilter || undefined),
    enabled: isAuthenticated,
  });

  const items = data?.data?.items || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Lots d'or (Export)</h1>
          <p className="text-sm text-slate-500 mt-1">Producteur → transitaire → validation d'audit à Dubaï</p>
        </div>
        <select className="input w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {FILTERS.map((f) => (
            <option key={f || 'all'} value={f}>{f ? statusLabels[f] : 'Tous les statuts'}</option>
          ))}
        </select>
      </div>

      <div className="card overflow-hidden p-0">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500">Chargement…</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-slate-500">Aucun lot</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-800/60">
              <tr>
                <th className="px-4 py-3">Référence</th>
                <th className="px-4 py-3">Poids déclaré</th>
                <th className="px-4 py-3">Pureté</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3">Créé le</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {items.map((c) => (
                <tr key={c.id} className="hover:bg-slate-800/30">
                  <td className="px-4 py-3 font-mono text-slate-300">{c.reference}</td>
                  <td className="px-4 py-3 text-slate-300">{c.weight_declared_g.toLocaleString('fr-FR')} g</td>
                  <td className="px-4 py-3 text-slate-400">{(c.purity_declared * 100).toFixed(1)}%</td>
                  <td className="px-4 py-3 text-slate-400">{goldTypeLabels[c.gold_type]}</td>
                  <td className="px-4 py-3"><span className={`badge ${statusBadge[c.status]}`}>{statusLabels[c.status]}</span></td>
                  <td className="px-4 py-3 text-slate-500">{new Date(c.created_at).toLocaleDateString('fr-FR')}</td>
                  <td className="px-4 py-3 text-right">
                    <button className="text-gold-500 hover:underline text-xs" onClick={() => setSelectedId(c.id)}>Détails</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedId && (
        <ConsignmentDetail
          id={selectedId}
          onClose={() => setSelectedId(null)}
          canUpdate={canUpdate}
          canApprove={canApprove}
          canReject={canReject}
          onChanged={() => queryClient.invalidateQueries({ queryKey: ['admin-consignments'] })}
        />
      )}
    </div>
  );
}

function ConsignmentDetail({ id, onClose, canUpdate, canApprove, canReject, onChanged }: {
  id: string; onClose: () => void; canUpdate: boolean; canApprove: boolean; canReject: boolean; onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [rejectReason, setRejectReason] = useState('');
  const [refinedWeight, setRefinedWeight] = useState('');
  const [refineryLot, setRefineryLot] = useState('');
  const [lbma, setLbma] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-consignment', id],
    queryFn: () => adminApi.getConsignment(id),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-consignment', id] });
    onChanged();
  };

  const mut = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => { setError(null); refresh(); },
    onError: (e: Error) => setError(e.message),
  });

  const c = data?.data?.consignment;
  const events = data?.data?.events || [];
  // Ce que le raffineur a fait du lot. Sans cela, le support ne peut pas
  // répondre à « ma location ne s'est pas ouverte » — l'appel que cette
  // fonctionnalité va justement générer.
  const disposition = data?.data?.disposition ?? null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-800 sticky top-0 bg-slate-900">
          <h2 className="text-lg font-semibold text-white">Lot {c?.reference ?? ''}</h2>
          <button className="text-slate-500 hover:text-white" onClick={onClose}>✕</button>
        </div>

        {isLoading || !c ? (
          <div className="p-8 text-center text-slate-500">Chargement…</div>
        ) : (
          <div className="p-5 space-y-5">
            <div className="flex items-center gap-3">
              <span className={`badge ${statusBadge[c.status]}`}>{statusLabels[c.status]}</span>
              <span className="text-slate-400 text-sm">{c.weight_declared_g.toLocaleString('fr-FR')} g · {(c.purity_declared * 100).toFixed(1)}% · {goldTypeLabels[c.gold_type]}</span>
            </div>

            {c.refined_weight_g != null && (
              <div className="text-sm text-emerald-400 space-y-0.5">
                <div>
                  Raffiné : {c.refined_weight_g.toLocaleString('fr-FR')} g alloué au stock{c.refinery_lot ? ` · lot ${c.refinery_lot}` : ''}
                </div>
                {c.producer_tokens_credited != null && (
                  <div>
                    Payé au producteur : {c.producer_tokens_credited.toLocaleString('fr-FR')} g en tokens
                    {c.producer_tokens_credited < c.refined_weight_g && (
                      <span className="text-slate-400">
                        {' '}· {(c.refined_weight_g - c.producer_tokens_credited).toLocaleString('fr-FR')} g conservés en stock libre
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
            {c.rejection_reason && <div className="text-sm text-red-400">Rejet : {c.rejection_reason}</div>}

            <AdminPhotoStrip consignmentId={c.id} photosJson={c.photos} />

            <div className="space-y-2">
              <h3 className="text-xs uppercase tracking-wider text-slate-500">Répartition du lot</h3>
              {disposition ? (
                <div className="rounded-lg bg-slate-800/60 p-3 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Vendu</span>
                    <span>
                      {disposition.sell_g.toFixed(3)} g
                      {disposition.sell_status === 'FAILED' && (
                        <span className="text-red-400 ml-2">échec</span>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">En location</span>
                    <span>
                      {disposition.lease_g.toFixed(3)} g
                      {disposition.lease_status === 'FAILED' && (
                        <span className="text-red-400 ml-2">échec</span>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Gardé à Dubaï</span>
                    <span>{disposition.store_g.toFixed(3)} g</span>
                  </div>
                  {disposition.status !== 'EXECUTED' && (
                    <p className="text-xs text-amber-300 pt-2 border-t border-slate-700">
                      {disposition.status}
                      {disposition.failure_reason ? ` — ${disposition.failure_reason}` : ''}. Les
                      opérations réussies ont bien eu lieu.
                    </p>
                  )}
                </div>
              ) : (
                // Distinguer « pas encore réparti » de « tout en stockage » : ce
                // n'est pas la même situation pour le producteur.
                <p className="text-sm text-slate-500">Lot non encore réparti.</p>
              )}
            </div>

            {/* Event timeline */}
            <div>
              <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">Historique</h3>
              <ol className="space-y-2">
                {events.map((ev) => (
                  <li key={ev.id} className="flex items-start gap-3 text-sm">
                    <span className="w-2 h-2 rounded-full bg-gold-500 mt-1.5 flex-shrink-0" />
                    <div>
                      <span className="text-slate-300">{statusLabels[ev.to_status] || ev.to_status}</span>
                      <span className="text-slate-600 text-xs"> · {new Date(ev.created_at).toLocaleString('fr-FR')}{ev.actor_role ? ` · ${ev.actor_role}` : ''}</span>
                      {ev.note && <p className="text-slate-500 text-xs">{ev.note}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {error && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>}

            {/* Actions by status */}
            <div className="space-y-3 border-t border-slate-800 pt-4">
              {c.status === 'SUBMITTED' && canUpdate && (
                <button className="btn-primary w-full" disabled={mut.isPending} onClick={() => mut.mutate(() => adminApi.forwarderValidateConsignment(c.id))}>
                  Valider l'opération (transitaire)
                </button>
              )}
              {c.status === 'FORWARDER_VALIDATED' && canUpdate && (
                <button className="btn-primary w-full" disabled={mut.isPending} onClick={() => mut.mutate(() => adminApi.startConsignmentTransit(c.id))}>
                  Démarrer le transport
                </button>
              )}
              {c.status === 'IN_TRANSIT' && canUpdate && (
                <button className="btn-primary w-full" disabled={mut.isPending} onClick={() => mut.mutate(() => adminApi.arriveConsignmentDubai(c.id))}>
                  Marquer arrivé à Dubaï
                </button>
              )}
              {c.status === 'ARRIVED_DUBAI' && canApprove && (
                <div className="space-y-2 bg-slate-800/40 rounded-xl p-3">
                  <p className="text-xs text-slate-400">Validation d'audit — alloue le poids raffiné au stock</p>
                  <input className="input" type="number" step="0.001" placeholder="Poids raffiné (g)" value={refinedWeight} onChange={(e) => setRefinedWeight(e.target.value)} />
                  <input className="input" placeholder="N° lot raffinage (optionnel)" value={refineryLot} onChange={(e) => setRefineryLot(e.target.value)} />
                  <input className="input" placeholder="Certificat LBMA (optionnel)" value={lbma} onChange={(e) => setLbma(e.target.value)} />
                  <button
                    className="btn-primary w-full"
                    disabled={mut.isPending || !(Number(refinedWeight) > 0)}
                    onClick={() => mut.mutate(() => adminApi.auditValidateConsignment(c.id, { refinedWeightG: Number(refinedWeight), refineryLot: refineryLot || undefined, lbmaCertificate: lbma || undefined }))}
                  >
                    Valider l'audit &amp; allouer {Number(refinedWeight) > 0 ? `${Number(refinedWeight).toLocaleString('fr-FR')} g` : ''}
                  </button>
                </div>
              )}

              {['SUBMITTED', 'FORWARDER_VALIDATED', 'IN_TRANSIT', 'ARRIVED_DUBAI'].includes(c.status) && canReject && (
                <div className="space-y-2">
                  <input className="input" placeholder="Motif de rejet" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                  <button className="btn-secondary w-full text-red-400" disabled={mut.isPending || !rejectReason.trim()} onClick={() => mut.mutate(() => adminApi.rejectConsignment(c.id, rejectReason.trim()))}>
                    Rejeter le lot
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
