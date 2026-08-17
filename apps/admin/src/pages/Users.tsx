import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAdminStore } from '../stores/auth';
import { adminApi } from '../lib/api';

const kycLevelBadge: Record<string, string> = {
  BASIC: 'badge-warning',
  STANDARD: 'badge-info',
  VERIFIED: 'badge-success',
};

const kycStatusBadge: Record<string, string> = {
  PENDING: 'badge-warning',
  SUBMITTED: 'badge-info',
  APPROVED: 'badge-success',
  REJECTED: 'badge-error',
};

const kycLevelLabels: Record<string, string> = {
  BASIC: 'Basique',
  STANDARD: 'Standard',
  VERIFIED: 'Vérifié',
};

const kycStatusLabels: Record<string, string> = {
  PENDING: 'En attente',
  SUBMITTED: 'Soumis',
  APPROVED: 'Approuvé',
  REJECTED: 'Rejeté',
};

interface User {
  id: string;
  email: string;
  phone: string;
  country: string;
  kycLevel: string;
  kycStatus: string;
  createdAt: string;
}

export default function Users() {
  const { isAuthenticated } = useAdminStore();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [kycLevelFilter, setKycLevelFilter] = useState('');
  const [kycStatusFilter, setKycStatusFilter] = useState('');

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setPage(1); // Reset to first page on search
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-users', page, debouncedSearch],
    queryFn: () => adminApi.getUsers(page, 50, debouncedSearch || undefined),
    enabled: isAuthenticated,
  });

  /**
   * Comptes suspendus.
   *
   * La route existait et n'etait affichee nulle part : un compte suspendu ne se
   * retrouvait qu'en le cherchant nommement, ce qui suppose de savoir qu'il
   * l'est.
   */
  const { data: suspendus } = useQuery({
    queryKey: ['admin-suspended-users'],
    queryFn: () => adminApi.getSuspendedUsers(),
    enabled: isAuthenticated,
  });

  const comptesSuspendus = suspendus?.data?.items ?? [];

  const allUsers: User[] = data?.data?.items || [];

  // Client-side filtering for KYC level and status
  const filteredUsers = useMemo(() => {
    return allUsers.filter((user) => {
      if (kycLevelFilter && user.kycLevel !== kycLevelFilter) return false;
      if (kycStatusFilter && user.kycStatus !== kycStatusFilter) return false;
      return true;
    });
  }, [allUsers, kycLevelFilter, kycStatusFilter]);

  // Statistics
  const stats = useMemo(() => {
    return {
      total: allUsers.length,
      byLevel: {
        BASIC: allUsers.filter((u) => u.kycLevel === 'BASIC').length,
        STANDARD: allUsers.filter((u) => u.kycLevel === 'STANDARD').length,
        VERIFIED: allUsers.filter((u) => u.kycLevel === 'VERIFIED').length,
      },
      byStatus: {
        PENDING: allUsers.filter((u) => u.kycStatus === 'PENDING').length,
        SUBMITTED: allUsers.filter((u) => u.kycStatus === 'SUBMITTED').length,
        APPROVED: allUsers.filter((u) => u.kycStatus === 'APPROVED').length,
        REJECTED: allUsers.filter((u) => u.kycStatus === 'REJECTED').length,
      },
    };
  }, [allUsers]);

  // Export to CSV
  const exportToCSV = () => {
    const headers = ['Email', 'Téléphone', 'Pays', 'Niveau KYC', 'Statut KYC', 'Date inscription'];
    const rows = filteredUsers.map((user) => [
      user.email,
      user.phone,
      user.country,
      kycLevelLabels[user.kycLevel] || user.kycLevel,
      kycStatusLabels[user.kycStatus] || user.kycStatus,
      new Date(user.createdAt).toLocaleDateString('fr-FR'),
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `utilisateurs_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const clearFilters = () => {
    setSearchInput('');
    setKycLevelFilter('');
    setKycStatusFilter('');
  };

  const hasFilters = searchInput || kycLevelFilter || kycStatusFilter;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Utilisateurs</h1>
          <p className="text-slate-500 mt-1 text-sm">Gestion des comptes utilisateurs</p>
        </div>
        <button
          onClick={exportToCSV}
          disabled={filteredUsers.length === 0}
          className="btn-secondary flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Exporter CSV
        </button>
      </div>

      {/* Comptes suspendus — mis en tete parce qu'ils appellent une decision */}
      {comptesSuspendus.length > 0 && (
        <div className="card border-amber-500/25">
          <h2 className="text-sm font-semibold text-amber-300 mb-1">
            {suspendus?.data?.total ?? comptesSuspendus.length} compte(s) suspendu(s)
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            Ces comptes ne peuvent ni acheter, ni vendre, ni retirer.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="text-left pb-2">Compte</th>
                  <th className="text-left pb-2">Depuis</th>
                  <th className="text-left pb-2">Jusqu&apos;au</th>
                  <th className="text-left pb-2">Motif</th>
                </tr>
              </thead>
              <tbody>
                {comptesSuspendus.map((u) => (
                  <tr key={u.id} className="border-t border-slate-800">
                    <td className="py-2">
                      <p className="text-slate-200">{u.email}</p>
                      <p className="text-[11px] text-slate-500">{u.phone}</p>
                    </td>
                    <td className="py-2 text-slate-400">
                      {u.suspended_at ? u.suspended_at.slice(0, 10) : '—'}
                    </td>
                    <td className="py-2 text-slate-400">
                      {/* Pas de date de fin = suspension sans terme. « — » le dit ;
                          une date inventee laisserait croire a une levee automatique. */}
                      {u.suspended_until ? u.suspended_until.slice(0, 10) : 'sans terme'}
                    </td>
                    <td className="py-2 text-slate-400">{u.suspension_reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="stat-icon bg-blue-500/15 rounded-xl">
              <span className="text-lg">👥</span>
            </div>
            <div>
              <p className="stat-label">Total</p>
              <p className="text-xl font-bold">{data?.data?.total || 0}</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="stat-icon bg-emerald-500/15 rounded-xl">
              <span className="text-lg">✓</span>
            </div>
            <div>
              <p className="stat-label">KYC Vérifiés</p>
              <p className="text-xl font-bold text-emerald-400">{stats.byLevel.VERIFIED}</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="stat-icon bg-amber-500/15 rounded-xl">
              <span className="text-lg">⏳</span>
            </div>
            <div>
              <p className="stat-label">KYC en attente</p>
              <p className="text-xl font-bold text-amber-400">{stats.byStatus.SUBMITTED}</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="stat-icon bg-slate-500/15 rounded-xl">
              <span className="text-lg">📊</span>
            </div>
            <div>
              <p className="stat-label">Répartition</p>
              <div className="flex gap-1.5 mt-1">
                <span className="badge badge-warning text-[10px]">B:{stats.byLevel.BASIC}</span>
                <span className="badge badge-info text-[10px]">S:{stats.byLevel.STANDARD}</span>
                <span className="badge badge-success text-[10px]">V:{stats.byLevel.VERIFIED}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap gap-4">
          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Recherche</label>
            <div className="relative">
              <input
                type="text"
                className="input w-full pl-10"
                placeholder="Email ou téléphone..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              <svg
                className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {searchInput && isLoading && (
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
          </div>

          {/* KYC Level filter */}
          <div className="min-w-[150px]">
            <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Niveau KYC</label>
            <select
              className="input w-full"
              value={kycLevelFilter}
              onChange={(e) => setKycLevelFilter(e.target.value)}
            >
              <option value="">Tous</option>
              <option value="BASIC">Basique</option>
              <option value="STANDARD">Standard</option>
              <option value="VERIFIED">Vérifié</option>
            </select>
          </div>

          {/* KYC Status filter */}
          <div className="min-w-[150px]">
            <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Statut KYC</label>
            <select
              className="input w-full"
              value={kycStatusFilter}
              onChange={(e) => setKycStatusFilter(e.target.value)}
            >
              <option value="">Tous</option>
              <option value="PENDING">En attente</option>
              <option value="SUBMITTED">Soumis</option>
              <option value="APPROVED">Approuvé</option>
              <option value="REJECTED">Rejeté</option>
            </select>
          </div>

          {/* Clear filters */}
          {hasFilters && (
            <div className="flex items-end">
              <button
                onClick={clearFilters}
                className="btn-ghost text-xs text-gold-400 hover:text-gold-300"
              >
                <svg className="w-4 h-4 mr-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Effacer filtres
              </button>
            </div>
          )}
        </div>

        {hasFilters && (
          <div className="mt-4 pt-3 border-t border-slate-800/60 text-xs text-slate-500">
            {filteredUsers.length} résultat(s) {allUsers.length > filteredUsers.length && `sur ${allUsers.length}`}
          </div>
        )}
      </div>

      {/* Users Table */}
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800/60 bg-slate-900/40">
              <th className="table-header">Email</th>
              <th className="table-header">Téléphone</th>
              <th className="table-header hidden sm:table-cell">Pays</th>
              <th className="table-header">Niveau KYC</th>
              <th className="table-header">Statut KYC</th>
              <th className="table-header hidden md:table-cell">Inscription</th>
              <th className="table-header">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="table-cell text-center">
                  <div className="flex items-center justify-center gap-2 py-8">
                    <div className="w-5 h-5 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-slate-400 text-sm">Chargement...</span>
                  </div>
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={7} className="table-cell text-center">
                  <div className="py-8 space-y-3">
                    <div className="w-12 h-12 rounded-xl bg-red-500/15 flex items-center justify-center mx-auto">
                      <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                      </svg>
                    </div>
                    <p className="text-red-400 text-sm">{error instanceof Error ? error.message : 'Impossible de charger les utilisateurs'}</p>
                    <button onClick={() => refetch()} className="btn-ghost text-sm text-gold-500 hover:text-gold-400">
                      Reessayer
                    </button>
                  </div>
                </td>
              </tr>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={7} className="table-cell text-center">
                  <div className="py-8 text-slate-500 text-sm">
                    {hasFilters ? 'Aucun utilisateur ne correspond aux filtres' : 'Aucun utilisateur trouvé'}
                  </div>
                </td>
              </tr>
            ) : (
              filteredUsers.map((user) => (
                <tr key={user.id} className="table-row">
                  <td className="table-cell">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-slate-300">
                          {user.email?.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <span className="font-medium text-white">{user.email}</span>
                    </div>
                  </td>
                  <td className="table-cell text-slate-400">{user.phone}</td>
                  <td className="table-cell hidden sm:table-cell">
                    <span className="flex items-center gap-1.5">
                      {user.country === 'BF' && '🇧🇫'}
                      <span className="text-slate-400">{user.country}</span>
                    </span>
                  </td>
                  <td className="table-cell">
                    <span className={`badge ${kycLevelBadge[user.kycLevel]}`}>
                      {kycLevelLabels[user.kycLevel] || user.kycLevel}
                    </span>
                  </td>
                  <td className="table-cell">
                    <span className={`badge ${kycStatusBadge[user.kycStatus]}`}>
                      {kycStatusLabels[user.kycStatus] || user.kycStatus}
                    </span>
                  </td>
                  <td className="table-cell hidden md:table-cell">
                    <div className="text-slate-400 text-xs">
                      <div>{new Date(user.createdAt).toLocaleDateString('fr-FR')}</div>
                      <div className="text-slate-600">{new Date(user.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  </td>
                  <td className="table-cell">
                    <Link
                      to={`/users/${user.id}`}
                      className="inline-flex items-center gap-1 text-gold-500 hover:text-gold-400 text-xs font-medium transition-colors"
                    >
                      Details
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data?.data && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Page {page} — {data.data.total} utilisateur(s) au total
          </p>
          <div className="flex gap-2">
            <button
              className="btn-secondary text-xs"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <svg className="w-4 h-4 mr-1 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Precedent
            </button>
            <button
              className="btn-secondary text-xs"
              disabled={!data.data.hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              Suivant
              <svg className="w-4 h-4 ml-1 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
