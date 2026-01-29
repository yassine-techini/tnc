import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminStore } from '../stores/auth';
import { adminApi } from '../lib/api';

const statusBadge: Record<string, string> = {
  PENDING: 'badge-warning',
  PROCESSING: 'badge-info',
  COMPLETED: 'badge-success',
  FAILED: 'badge-error',
  REJECTED: 'badge-error',
};

const statusLabels: Record<string, string> = {
  PENDING: 'En attente',
  PROCESSING: 'En traitement',
  COMPLETED: 'Complété',
  FAILED: 'Échoué',
  REJECTED: 'Rejeté',
};

export default function Withdrawals() {
  const { isAuthenticated } = useAdminStore();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-withdrawals', statusFilter],
    queryFn: () => adminApi.getWithdrawals(statusFilter || undefined),
    enabled: isAuthenticated,
  });

  const processMutation = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: 'approve' | 'reject'; reason?: string }) => adminApi.processWithdrawal(id, action, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-withdrawals'] });
      setSelectedWithdrawal(null);
      setRejectReason('');
    },
  });

  const withdrawals = data?.data?.items || [];
  const pendingCount = withdrawals.filter((w: any) => w.status === 'PENDING').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Retraits</h1>
          <p className="text-sm text-slate-500 mt-1">Gestion des demandes de retrait</p>
        </div>
        <div className="flex items-center gap-3">
          {statusFilter === 'PENDING' && pendingCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-xl">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-xs font-medium text-amber-400">{pendingCount} en attente</span>
            </div>
          )}
          <select
            className="input w-auto"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Tous</option>
            <option value="PENDING">En attente</option>
            <option value="PROCESSING">En traitement</option>
            <option value="COMPLETED">Complétés</option>
            <option value="REJECTED">Rejetés</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800/60">
              <th className="table-header">ID</th>
              <th className="table-header">Utilisateur</th>
              <th className="table-header">Montant</th>
              <th className="table-header hidden sm:table-cell">Méthode</th>
              <th className="table-header hidden md:table-cell">Téléphone</th>
              <th className="table-header">Statut</th>
              <th className="table-header hidden lg:table-cell">Date</th>
              <th className="table-header">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="text-center py-12">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-slate-400">Chargement...</span>
                  </div>
                </td>
              </tr>
            ) : withdrawals.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                      <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <p className="text-sm text-slate-500">Aucune demande de retrait</p>
                  </div>
                </td>
              </tr>
            ) : (
              withdrawals.map((w: any) => (
                <tr key={w.id} className="table-row">
                  <td className="table-cell font-mono text-[11px] text-slate-500">{w.id.slice(0, 8)}...</td>
                  <td className="table-cell">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-slate-400">{w.userEmail?.charAt(0).toUpperCase()}</span>
                      </div>
                      <span className="text-sm truncate max-w-[140px]">{w.userEmail}</span>
                    </div>
                  </td>
                  <td className="table-cell">
                    <span className="font-semibold text-sm text-white">{w.amount.toLocaleString()}</span>
                    <span className="text-[10px] text-slate-500 ml-1">FCFA</span>
                  </td>
                  <td className="table-cell hidden sm:table-cell">
                    <span className="badge badge-info">{w.paymentMethod}</span>
                  </td>
                  <td className="table-cell hidden md:table-cell text-slate-400 text-sm">{w.phoneNumber}</td>
                  <td className="table-cell">
                    <span className={`badge ${statusBadge[w.status]}`}>
                      {statusLabels[w.status] || w.status}
                    </span>
                  </td>
                  <td className="table-cell hidden lg:table-cell text-slate-500">
                    <div className="text-xs">{new Date(w.createdAt).toLocaleDateString('fr-FR')}</div>
                    <div className="text-[10px] text-slate-600">{new Date(w.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
                  </td>
                  <td className="table-cell">
                    {w.status === 'PENDING' && (
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => processMutation.mutate({ id: w.id, action: 'approve' })}
                          disabled={processMutation.isPending}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 text-[11px] font-semibold hover:bg-emerald-500/25 transition-colors"
                        >
                          Approuver
                        </button>
                        <button
                          onClick={() => setSelectedWithdrawal(w.id)}
                          disabled={processMutation.isPending}
                          className="px-2.5 py-1.5 rounded-lg bg-red-500/15 text-red-400 text-[11px] font-semibold hover:bg-red-500/25 transition-colors"
                        >
                          Rejeter
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pending Alert */}
      {statusFilter === 'PENDING' && withdrawals.length > 0 && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-sm text-amber-400">{withdrawals.length} retrait(s) en attente</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Traitez les demandes de retrait dans les meilleurs délais.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {selectedWithdrawal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="card w-full max-w-md">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">Rejeter le retrait</h3>
                <p className="text-xs text-slate-500">Cette action est irréversible</p>
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
                Raison du rejet
              </label>
              <textarea
                className="input min-h-[100px]"
                placeholder="Raison du rejet..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </div>
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => { setSelectedWithdrawal(null); setRejectReason(''); }}
                className="btn-secondary flex-1"
              >
                Annuler
              </button>
              <button
                onClick={() =>
                  processMutation.mutate({
                    id: selectedWithdrawal,
                    action: 'reject',
                    reason: rejectReason,
                  })
                }
                disabled={!rejectReason || processMutation.isPending}
                className="btn-danger flex-1"
              >
                {processMutation.isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    En cours...
                  </span>
                ) : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
