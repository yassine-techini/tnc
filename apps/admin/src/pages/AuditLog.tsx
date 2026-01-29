import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../lib/api';
import { useAdminStore } from '../stores/auth';

const actionLabels: Record<string, string> = {
  KYC_APPROVE: 'KYC Approuvé',
  KYC_REJECT: 'KYC Rejeté',
  KYC_BULK_APPROVE: 'KYC Approuvé (masse)',
  USER_SUSPENDED: 'Utilisateur suspendu',
  USER_UNSUSPENDED: 'Utilisateur réactivé',
  STOCK_ADJUST: 'Ajustement stock',
  WITHDRAWAL_APPROVE: 'Retrait approuvé',
  WITHDRAWAL_REJECT: 'Retrait rejeté',
  ADMIN_CREATE: 'Admin créé',
  ADMIN_UPDATE: 'Admin modifié',
  ADMIN_DELETE: 'Admin désactivé',
  PERMISSION_UPDATE: 'Permissions modifiées',
  INTEGRATION_UPDATE: 'Intégration modifiée',
  ADMIN_LOGIN: 'Connexion admin',
};

const entityTypeLabels: Record<string, string> = {
  user: 'Utilisateur',
  kyc: 'KYC',
  stock: 'Stock',
  transaction: 'Transaction',
  admin: 'Admin',
  integration: 'Intégration',
};

export default function AuditLog() {
  const { isAuthenticated } = useAdminStore();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    action: '',
    entityType: '',
    adminId: '',
    startDate: '',
    endDate: '',
  });
  const [detailModal, setDetailModal] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', page, filters],
    queryFn: () => adminApi.getAuditLogs({
      page,
      limit: 30,
      ...(filters.action && { action: filters.action }),
      ...(filters.entityType && { entityType: filters.entityType }),
      ...(filters.adminId && { adminId: filters.adminId }),
      ...(filters.startDate && { startDate: filters.startDate }),
      ...(filters.endDate && { endDate: filters.endDate }),
    }),
    enabled: isAuthenticated,
  });

  const logs = data?.data?.items || [];
  const total = data?.data?.total || 0;
  const totalPages = Math.ceil(total / 30);

  const resetFilters = () => {
    setFilters({ action: '', entityType: '', adminId: '', startDate: '', endDate: '' });
    setPage(1);
  };

  const exportCsv = () => {
    if (logs.length === 0) return;
    const headers = ['Date', 'Admin', 'Action', 'Type', 'Entité', 'IP'];
    const rows = logs.map((l) => [
      l.created_at,
      l.admin_email || l.admin_id || '',
      l.action,
      l.entity_type,
      l.entity_id,
      l.ip_address || '',
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatJson = (str: string | null) => {
    if (!str) return null;
    try {
      return JSON.stringify(JSON.parse(str), null, 2);
    } catch {
      return str;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Journal d'audit</h1>
          <p className="text-sm text-slate-500 mt-0.5">{total} entrée{total !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={exportCsv}
          disabled={logs.length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm font-medium transition-all disabled:opacity-50"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800/60 p-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <select
            value={filters.action}
            onChange={(e) => { setFilters({ ...filters, action: e.target.value }); setPage(1); }}
            className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-gold-500 outline-none"
          >
            <option value="">Toutes actions</option>
            {Object.entries(actionLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select
            value={filters.entityType}
            onChange={(e) => { setFilters({ ...filters, entityType: e.target.value }); setPage(1); }}
            className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-gold-500 outline-none"
          >
            <option value="">Tous modules</option>
            {Object.entries(entityTypeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => { setFilters({ ...filters, startDate: e.target.value }); setPage(1); }}
            className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-gold-500 outline-none"
            placeholder="Date début"
          />
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => { setFilters({ ...filters, endDate: e.target.value }); setPage(1); }}
            className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-gold-500 outline-none"
            placeholder="Date fin"
          />
          <button
            onClick={resetFilters}
            className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 text-xs font-medium transition-all"
          >
            Réinitialiser
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800/60 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16 text-slate-500">Aucune entrée d'audit</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800/60">
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">Date</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">Admin</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">Action</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">Module</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">Entité</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">IP</th>
                <th className="text-right text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="px-6 py-3 text-xs text-slate-500 whitespace-nowrap">
                    {new Date(log.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-6 py-3">
                    <p className="text-xs font-medium text-slate-900 dark:text-white">{log.admin_name || log.admin_email || '—'}</p>
                    {log.admin_email && log.admin_name && <p className="text-[10px] text-slate-500">{log.admin_email}</p>}
                  </td>
                  <td className="px-6 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300">
                      {actionLabels[log.action] || log.action}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-xs text-slate-500">
                    {entityTypeLabels[log.entity_type] || log.entity_type}
                  </td>
                  <td className="px-6 py-3 text-xs text-slate-500 font-mono truncate max-w-[120px]" title={log.entity_id}>
                    {log.entity_id ? log.entity_id.substring(0, 8) + '...' : '—'}
                  </td>
                  <td className="px-6 py-3 text-xs text-slate-500 font-mono">
                    {log.ip_address || '—'}
                  </td>
                  <td className="px-6 py-3 text-right">
                    {(log.old_value || log.new_value) && (
                      <button
                        onClick={() => setDetailModal(log)}
                        className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-all"
                        title="Détails"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 dark:border-slate-800/60">
            <p className="text-xs text-slate-500">Page {page} / {totalPages}</p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 disabled:opacity-50 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
              >
                Précédent
              </button>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 disabled:opacity-50 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
              >
                Suivant
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {detailModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800/60 shadow-2xl w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Détails de l'action</h2>
              <button onClick={() => setDetailModal(null)} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-xs text-slate-500 mb-1">Action</p>
                <p className="text-sm font-medium text-slate-900 dark:text-white">{actionLabels[detailModal.action] || detailModal.action}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Admin</p>
                <p className="text-sm text-slate-900 dark:text-white">{detailModal.admin_name || detailModal.admin_email || detailModal.admin_id}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Date</p>
                <p className="text-sm text-slate-900 dark:text-white">{new Date(detailModal.created_at).toLocaleString('fr-FR')}</p>
              </div>

              {detailModal.old_value && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">Ancienne valeur</p>
                  <pre className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 overflow-x-auto font-mono whitespace-pre-wrap">
                    {formatJson(detailModal.old_value)}
                  </pre>
                </div>
              )}

              {detailModal.new_value && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">Nouvelle valeur</p>
                  <pre className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 overflow-x-auto font-mono whitespace-pre-wrap">
                    {formatJson(detailModal.new_value)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
