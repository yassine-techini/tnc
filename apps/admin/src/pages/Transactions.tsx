import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAdminStore } from '../stores/auth';
import { adminApi } from '../lib/api';

const typeLabels: Record<string, string> = {
  BUY: 'Achat',
  SELL: 'Vente',
  DEPOSIT: 'Dépôt',
  WITHDRAWAL: 'Retrait',
  FEE: 'Frais',
};

const typeIcon: Record<string, { bg: string; color: string; arrow: string }> = {
  BUY: { bg: 'bg-emerald-500/15', color: 'text-emerald-400', arrow: '↗' },
  SELL: { bg: 'bg-red-500/15', color: 'text-red-400', arrow: '↙' },
  DEPOSIT: { bg: 'bg-blue-500/15', color: 'text-blue-400', arrow: '↓' },
  WITHDRAWAL: { bg: 'bg-amber-500/15', color: 'text-amber-400', arrow: '↑' },
  FEE: { bg: 'bg-slate-500/15', color: 'text-slate-400', arrow: '•' },
};

const statusLabels: Record<string, string> = {
  PENDING: 'En attente',
  PROCESSING: 'En cours',
  COMPLETED: 'Complété',
  FAILED: 'Échoué',
  CANCELLED: 'Annulé',
};

const statusBadge: Record<string, string> = {
  PENDING: 'badge-warning',
  PROCESSING: 'badge-info',
  COMPLETED: 'badge-success',
  FAILED: 'badge-error',
  CANCELLED: 'badge-error',
};

interface Transaction {
  id: string;
  userId: string;
  userEmail: string;
  type: string;
  status: string;
  tokenAmount: number | null;
  cashAmount: number;
  fees: number;
  createdAt: string;
}

export default function Transactions() {
  const { tokens } = useAdminStore();
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-transactions', page, typeFilter],
    queryFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return adminApi.getTransactions(tokens.accessToken, page, 100, typeFilter || undefined);
    },
    enabled: !!tokens?.accessToken,
  });

  const allTransactions: Transaction[] = data?.data?.items || [];

  const filteredTransactions = useMemo(() => {
    return allTransactions.filter((tx) => {
      if (statusFilter && tx.status !== statusFilter) return false;
      if (searchQuery && !tx.userEmail?.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
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
  }, [allTransactions, statusFilter, searchQuery, dateFrom, dateTo]);

  const stats = useMemo(() => {
    const completed = filteredTransactions.filter((tx) => tx.status === 'COMPLETED');
    return {
      total: filteredTransactions.length,
      totalVolume: completed.reduce((sum, tx) => sum + tx.cashAmount, 0),
      totalFees: completed.reduce((sum, tx) => sum + tx.fees, 0),
      byType: {
        BUY: completed.filter((tx) => tx.type === 'BUY').length,
        SELL: completed.filter((tx) => tx.type === 'SELL').length,
        DEPOSIT: completed.filter((tx) => tx.type === 'DEPOSIT').length,
        WITHDRAWAL: completed.filter((tx) => tx.type === 'WITHDRAWAL').length,
      },
    };
  }, [filteredTransactions]);

  const exportToCSV = () => {
    const headers = ['ID', 'Utilisateur', 'Type', 'Statut', 'Montant Or (g)', 'Montant FCFA', 'Frais FCFA', 'Date'];
    const rows = filteredTransactions.map((tx) => [
      tx.id,
      tx.userEmail,
      typeLabels[tx.type] || tx.type,
      statusLabels[tx.status] || tx.status,
      tx.tokenAmount?.toFixed(3) || '',
      tx.cashAmount.toString(),
      tx.fees.toString(),
      new Date(tx.createdAt).toISOString(),
    ]);
    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `transactions_admin_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const clearFilters = () => {
    setTypeFilter('');
    setStatusFilter('');
    setSearchQuery('');
    setDateFrom('');
    setDateTo('');
  };

  const hasFilters = typeFilter || statusFilter || searchQuery || dateFrom || dateTo;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Transactions</h1>
          <p className="text-sm text-slate-500 mt-1">Historique de toutes les transactions</p>
        </div>
        <button
          onClick={exportToCSV}
          disabled={filteredTransactions.length === 0}
          className="btn-secondary flex items-center gap-2 group"
        >
          <svg className="w-4 h-4 transition-transform group-hover:-translate-y-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Exporter CSV
        </button>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="stat-icon bg-slate-700/50">
              <svg className="w-5 h-5 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div>
              <p className="stat-label">Transactions</p>
              <p className="stat-value text-xl">{stats.total}</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-3">
            <div className="stat-icon bg-gold-500/15">
              <svg className="w-5 h-5 text-gold-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="stat-label">Volume total</p>
              <p className="stat-value text-xl text-gold-500">{stats.totalVolume.toLocaleString()}</p>
              <p className="text-[10px] text-slate-600">FCFA</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-3">
            <div className="stat-icon bg-emerald-500/15">
              <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <div>
              <p className="stat-label">Frais collectés</p>
              <p className="stat-value text-xl text-emerald-400">{stats.totalFees.toLocaleString()}</p>
              <p className="text-[10px] text-slate-600">FCFA</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-3">
            <div className="stat-icon bg-blue-500/15">
              <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
              </svg>
            </div>
            <div>
              <p className="stat-label">Répartition</p>
              <div className="flex flex-wrap gap-1 mt-1">
                <span className="badge badge-success text-[10px]">A:{stats.byType.BUY}</span>
                <span className="badge badge-info text-[10px]">V:{stats.byType.SELL}</span>
                <span className="badge badge-warning text-[10px]">D:{stats.byType.DEPOSIT}</span>
                <span className="badge badge-error text-[10px]">R:{stats.byType.WITHDRAWAL}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Recherche</label>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                className="input w-full pl-10"
                placeholder="Email utilisateur..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="min-w-[150px]">
            <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Type</label>
            <select className="input w-full" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">Tous</option>
              <option value="BUY">Achats</option>
              <option value="SELL">Ventes</option>
              <option value="DEPOSIT">Dépôts</option>
              <option value="WITHDRAWAL">Retraits</option>
            </select>
          </div>

          <div className="min-w-[150px]">
            <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Statut</label>
            <select className="input w-full" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Tous</option>
              <option value="COMPLETED">Complétées</option>
              <option value="PENDING">En attente</option>
              <option value="PROCESSING">En cours</option>
              <option value="FAILED">Échoués</option>
              <option value="CANCELLED">Annulés</option>
            </select>
          </div>

          <div className="min-w-[150px]">
            <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Du</label>
            <input type="date" className="input w-full" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>

          <div className="min-w-[150px]">
            <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Au</label>
            <input type="date" className="input w-full" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>

          {hasFilters && (
            <div className="flex items-end">
              <button
                onClick={clearFilters}
                className="flex items-center gap-1.5 text-sm text-gold-400 hover:text-gold-300 whitespace-nowrap transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Effacer filtres
              </button>
            </div>
          )}
        </div>

        {hasFilters && (
          <div className="mt-3 pt-3 border-t border-slate-800/60 text-xs text-slate-500">
            {filteredTransactions.length} résultat(s) {allTransactions.length > filteredTransactions.length && `sur ${allTransactions.length}`}
          </div>
        )}
      </div>

      {/* Transactions Table */}
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800/60">
              <th className="table-header">ID</th>
              <th className="table-header">Utilisateur</th>
              <th className="table-header">Type</th>
              <th className="table-header hidden sm:table-cell">Montant Or</th>
              <th className="table-header">Montant FCFA</th>
              <th className="table-header hidden md:table-cell">Frais</th>
              <th className="table-header">Statut</th>
              <th className="table-header hidden lg:table-cell">Date</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="table-cell text-center">
                  <div className="flex items-center justify-center gap-2 py-8">
                    <div className="w-5 h-5 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-slate-400">Chargement...</span>
                  </div>
                </td>
              </tr>
            ) : filteredTransactions.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-slate-800/60 flex items-center justify-center">
                      <svg className="w-6 h-6 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    </div>
                    <p className="text-sm text-slate-500">
                      {hasFilters ? 'Aucun résultat pour ces filtres' : 'Aucune transaction'}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredTransactions.slice(0, 50).map((tx) => {
                const ti = typeIcon[tx.type] || typeIcon.FEE;
                return (
                  <tr key={tx.id} className="table-row">
                    <td className="table-cell font-mono text-[11px] text-slate-500">{tx.id.slice(0, 8)}...</td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center flex-shrink-0">
                          <span className="text-[10px] font-bold text-slate-400">{tx.userEmail?.charAt(0).toUpperCase()}</span>
                        </div>
                        <span className="text-sm truncate max-w-[140px]">{tx.userEmail}</span>
                      </div>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <span className={`w-6 h-6 rounded-lg ${ti.bg} flex items-center justify-center text-xs font-bold ${ti.color}`}>
                          {ti.arrow}
                        </span>
                        <span className="text-xs font-medium">{typeLabels[tx.type]}</span>
                      </div>
                    </td>
                    <td className="table-cell hidden sm:table-cell">
                      <span className="text-gold-400 font-medium text-sm">
                        {tx.tokenAmount ? `${tx.tokenAmount.toFixed(3)} g` : '-'}
                      </span>
                    </td>
                    <td className="table-cell font-medium text-sm">{tx.cashAmount.toLocaleString()} <span className="text-[10px] text-slate-500">FCFA</span></td>
                    <td className="table-cell hidden md:table-cell text-slate-500 text-sm">{tx.fees.toLocaleString()}</td>
                    <td className="table-cell">
                      <span className={`badge ${statusBadge[tx.status]}`}>
                        {statusLabels[tx.status] || tx.status}
                      </span>
                    </td>
                    <td className="table-cell hidden lg:table-cell text-slate-500">
                      <div className="text-xs">{new Date(tx.createdAt).toLocaleDateString('fr-FR')}</div>
                      <div className="text-[10px] text-slate-600">{new Date(tx.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data?.data && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Page {page} &bull; {data.data.total} transaction(s) au total
          </p>
          <div className="flex gap-2">
            <button
              className="btn-secondary flex items-center gap-1.5"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Precedent
            </button>
            <button
              className="btn-secondary flex items-center gap-1.5"
              disabled={!data.data.hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              Suivant
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
