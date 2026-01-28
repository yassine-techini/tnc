import { useQuery } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { useAuthStore } from '../stores/auth';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';

const typeLabels: Record<string, string> = {
  BUY: 'Achat',
  SELL: 'Vente',
  DEPOSIT: 'Dépôt',
  WITHDRAWAL: 'Retrait',
  FEE: 'Frais',
};

const statusLabels: Record<string, string> = {
  PENDING: 'En attente',
  PROCESSING: 'En cours',
  COMPLETED: 'Complétée',
  FAILED: 'Échoué',
  CANCELLED: 'Annulé',
};

const statusBadges: Record<string, string> = {
  PENDING: 'badge-warning',
  PROCESSING: 'badge-info',
  COMPLETED: 'badge-success',
  FAILED: 'badge-error',
  CANCELLED: 'badge-error',
};

interface Transaction {
  id: string;
  type: 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL' | 'FEE';
  status: string;
  tokenAmount: number | null;
  cashAmount: number;
  pricePerGram: number | null;
  fees: number;
  paymentMethod: string | null;
  createdAt: string;
  completedAt: string | null;
}

export default function Transactions() {
  const { tokens } = useAuthStore();
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['transactions', page],
    queryFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return api.getTransactions(tokens.accessToken, page, limit);
    },
    enabled: !!tokens?.accessToken,
  });

  const allTransactions: Transaction[] = data?.data?.items || [];
  const total = data?.data?.total || 0;
  const hasMore = data?.data?.hasMore || false;

  // Filter transactions client-side
  const filteredTransactions = useMemo(() => {
    return allTransactions.filter((tx) => {
      // Type filter
      if (typeFilter !== 'all' && tx.type !== typeFilter) return false;

      // Status filter
      if (statusFilter !== 'all' && tx.status !== statusFilter) return false;

      // Date range filter
      if (dateFrom) {
        const txDate = new Date(tx.createdAt).setHours(0, 0, 0, 0);
        const fromDate = new Date(dateFrom).setHours(0, 0, 0, 0);
        if (txDate < fromDate) return false;
      }

      if (dateTo) {
        const txDate = new Date(tx.createdAt).setHours(23, 59, 59, 999);
        const toDate = new Date(dateTo).setHours(23, 59, 59, 999);
        if (txDate > toDate) return false;
      }

      return true;
    });
  }, [allTransactions, typeFilter, statusFilter, dateFrom, dateTo]);

  const clearFilters = () => {
    setTypeFilter('all');
    setStatusFilter('all');
    setDateFrom('');
    setDateTo('');
  };

  const hasFilters = typeFilter !== 'all' || statusFilter !== 'all' || dateFrom || dateTo;

  // Export to CSV
  const exportToCSV = () => {
    const headers = ['Date', 'Type', 'Statut', 'Montant Or (g)', 'Montant FCFA', 'Prix/g', 'Frais', 'Méthode'];

    const rows = filteredTransactions.map((tx) => [
      new Date(tx.createdAt).toLocaleDateString('fr-FR'),
      typeLabels[tx.type] || tx.type,
      statusLabels[tx.status] || tx.status,
      tx.tokenAmount?.toFixed(3) || '',
      tx.cashAmount.toString(),
      tx.pricePerGram?.toString() || '',
      tx.fees.toString(),
      tx.paymentMethod || '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `transactions_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Transactions</h1>
          <p className="text-sm text-slate-500 mt-1">Historique de vos opérations</p>
        </div>
        <Button
          variant="secondary"
          onClick={exportToCSV}
          disabled={filteredTransactions.length === 0}
          leftIcon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          }
        >
          Exporter CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap gap-4">
          {/* Type filter */}
          <div className="flex-1 min-w-[150px]">
            <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Type</label>
            <select
              className="input w-full"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="all">Tous</option>
              <option value="BUY">Achats</option>
              <option value="SELL">Ventes</option>
              <option value="DEPOSIT">Dépôts</option>
              <option value="WITHDRAWAL">Retraits</option>
            </select>
          </div>

          {/* Status filter */}
          <div className="flex-1 min-w-[150px]">
            <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Statut</label>
            <select
              className="input w-full"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Tous</option>
              <option value="COMPLETED">Complètes</option>
              <option value="PENDING">En attente</option>
              <option value="PROCESSING">En cours</option>
              <option value="FAILED">Échoués</option>
            </select>
          </div>

          {/* Date from */}
          <div className="flex-1 min-w-[150px]">
            <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Du</label>
            <input
              type="date"
              className="input w-full"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>

          {/* Date to */}
          <div className="flex-1 min-w-[150px]">
            <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Au</label>
            <input
              type="date"
              className="input w-full"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>

          {/* Clear filters */}
          {hasFilters && (
            <div className="flex items-end">
              <button
                onClick={clearFilters}
                className="text-sm text-gold-400 hover:text-gold-300"
              >
                Effacer les filtres
              </button>
            </div>
          )}
        </div>

        {/* Results count */}
        <div className="mt-4 text-sm text-slate-400">
          {filteredTransactions.length} transaction{filteredTransactions.length !== 1 ? 's' : ''}
          {hasFilters && ` (filtre sur ${total})`}
        </div>
      </div>

      {/* Transactions list */}
      <div className="card">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-slate-700 rounded animate-pulse"></div>
            ))}
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-12 h-12 rounded-xl bg-slate-800/60 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-sm text-slate-500">
              {hasFilters ? 'Aucune transaction ne correspond aux filtres' : 'Aucune transaction'}
            </p>
            {hasFilters && (
              <button onClick={clearFilters} className="mt-2 text-gold-400 text-sm">
                Effacer les filtres
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800/60">
                    <th className="table-header">Date</th>
                    <th className="table-header">Type</th>
                    <th className="table-header text-right">Montant</th>
                    <th className="table-header text-right">Prix/g</th>
                    <th className="table-header text-right">Frais</th>
                    <th className="table-header text-center">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map((tx) => (
                    <tr key={tx.id} className="table-row">
                      <td className="table-cell">
                        <div className="text-sm font-medium text-white">
                          {new Date(tx.createdAt).toLocaleDateString('fr-FR')}
                        </div>
                        <div className="text-[10px] text-slate-600">
                          {new Date(tx.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${
                            tx.type === 'BUY' || tx.type === 'DEPOSIT' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                          }`}>
                            {tx.type === 'BUY' || tx.type === 'DEPOSIT' ? '↓' : '↑'}
                          </div>
                          <span className="text-sm">{typeLabels[tx.type]}</span>
                        </div>
                      </td>
                      <td className="table-cell text-right">
                        <p className={`font-semibold text-sm ${
                          tx.type === 'BUY' || tx.type === 'DEPOSIT' ? 'text-emerald-400' : 'text-white'
                        }`}>
                          {tx.tokenAmount ? `${tx.tokenAmount.toFixed(3)} g` : ''}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {tx.cashAmount.toLocaleString()} FCFA
                        </p>
                      </td>
                      <td className="table-cell text-right text-sm text-slate-400">
                        {tx.pricePerGram ? `${tx.pricePerGram.toLocaleString()}` : '-'}
                      </td>
                      <td className="table-cell text-right text-sm text-slate-400">
                        {tx.fees > 0 ? `${tx.fees.toLocaleString()}` : '-'}
                      </td>
                      <td className="table-cell text-center">
                        <span className={`badge ${statusBadges[tx.status]}`}>
                          {statusLabels[tx.status] || tx.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {(page > 1 || hasMore) && (
              <div className="flex justify-between items-center mt-6 pt-4 border-t border-slate-800/60">
                <Button
                  variant="secondary"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Précédent
                </Button>
                <span className="text-sm text-slate-400">
                  Page {page}
                </span>
                <Button
                  variant="secondary"
                  onClick={() => setPage(p => p + 1)}
                  disabled={!hasMore}
                >
                  Suivant
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
