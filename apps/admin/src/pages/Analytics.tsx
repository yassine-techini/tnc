import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { useAdminStore } from '../stores/auth';
import { adminApi } from '../lib/api';

const levelColors: Record<string, string> = {
  debug: 'text-slate-400',
  info: 'text-blue-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
  fatal: 'text-red-600',
};

const severityBadge: Record<string, string> = {
  info: 'badge-info',
  warning: 'badge-warning',
  critical: 'badge-error',
};

export default function Analytics() {
  const { isAuthenticated } = useAdminStore();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'overview' | 'logs' | 'alerts'>('overview');
  const [logFilters, setLogFilters] = useState<{
    level?: string;
    category?: string;
    search?: string;
  }>({});
  const [alertFilter, setAlertFilter] = useState<{ severity?: string; resolved?: boolean }>({});

  // Dashboard data
  const { data: dashboardData } = useQuery({
    queryKey: ['analytics-dashboard'],
    queryFn: () => adminApi.getAnalyticsDashboard(),
    enabled: isAuthenticated,
    refetchInterval: 30000, // Refresh every 30s
  });

  // Real-time metrics
  const { data: realtimeData } = useQuery({
    queryKey: ['analytics-realtime'],
    queryFn: () => adminApi.getRealtimeMetrics(),
    enabled: isAuthenticated,
    refetchInterval: 5000, // Refresh every 5s
  });

  // Transaction analytics
  const { data: transactionData } = useQuery({
    queryKey: ['analytics-transactions'],
    queryFn: () => adminApi.getTransactionAnalytics('7d'),
    enabled: isAuthenticated && activeTab === 'overview',
  });

  // Logs
  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ['analytics-logs', logFilters],
    queryFn: () => adminApi.searchLogs({ ...logFilters, limit: 50 }),
    enabled: isAuthenticated && activeTab === 'logs',
  });

  // Log stats
  const { data: logStatsData } = useQuery({
    queryKey: ['analytics-log-stats'],
    queryFn: () => adminApi.getLogStats(),
    enabled: isAuthenticated && activeTab === 'logs',
  });

  // Alerts
  const { data: alertsData, isLoading: alertsLoading } = useQuery({
    queryKey: ['analytics-alerts', alertFilter],
    queryFn: () => adminApi.getAlerts({ ...alertFilter, limit: 50 }),
    enabled: isAuthenticated && activeTab === 'alerts',
  });

  // Alert rules
  const { data: rulesData } = useQuery({
    queryKey: ['analytics-alert-rules'],
    queryFn: () => adminApi.getAlertRules(),
    enabled: isAuthenticated && activeTab === 'alerts',
  });

  // Mutations
  const acknowledgeAlert = useMutation({
    mutationFn: (alertId: string) => adminApi.acknowledgeAlert(alertId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['analytics-alerts'] }),
  });

  const resolveAlert = useMutation({
    mutationFn: (alertId: string) => adminApi.resolveAlert(alertId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['analytics-alerts'] }),
  });

  const toggleRule = useMutation({
    mutationFn: ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) => adminApi.updateAlertRule(ruleId, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['analytics-alert-rules'] }),
  });

  const dashboard = dashboardData?.data;
  // La reponse est PLATE : il n y a jamais eu de cle `metrics`. La lire ici
  // rendait `realtime` toujours undefined, donc chaque carte temps reel
  // affichait 0 en permanence.
  const realtime = realtimeData?.data;
  const transactions = transactionData?.data?.results || [];
  const logs = logsData?.data?.logs || [];
  const logStats = logStatsData?.data;
  const alerts = alertsData?.data?.alerts || [];
  const rules = rulesData?.data?.rules || [];

  // Process transaction data for charts
  interface ChartData { date: string; BUY?: number; SELL?: number; DEPOSIT?: number; WITHDRAWAL?: number; total: number }
  const transactionsByDay = transactions.reduce<ChartData[]>((acc, tx) => {
    const existing = acc.find(d => d.date === tx.date);
    if (existing) {
      const txType = tx.type as keyof Omit<ChartData, 'date' | 'total'>;
      existing[txType] = (existing[txType] || 0) + tx.count;
      existing.total += tx.count;
    } else {
      const newEntry: ChartData = { date: tx.date, total: tx.count };
      const txType = tx.type as keyof Omit<ChartData, 'date' | 'total'>;
      newEntry[txType] = tx.count;
      acc.push(newEntry);
    }
    return acc;
  }, []);

  // Log level distribution for pie chart
  const logLevelData = logStats ? Object.entries(logStats.byLevel).map(([name, value]) => ({
    name, value, color: name === 'error' || name === 'fatal' ? '#EF4444' : name === 'warn' ? '#F59E0B' : '#3B82F6',
  })) : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Analytics & Monitoring</h1>
          <p className="text-slate-500 mt-1 text-sm">
            Metriques temps reel, logs et alertes
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-slate-600 uppercase tracking-wider font-medium">Derniere MAJ</p>
          <p className="text-sm text-slate-400 mt-0.5">
            {realtime ? new Date().toLocaleTimeString('fr-FR') : '-'}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-800 pb-2">
        {(['overview', 'logs', 'alerts'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === tab
                ? 'bg-gold-500/20 text-gold-500'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            {tab === 'overview' ? 'Vue d\'ensemble' : tab === 'logs' ? 'Logs' : 'Alertes'}
            {tab === 'alerts' && dashboard?.activeAlerts && dashboard.activeAlerts > 0 && (
              <span className="ml-2 px-1.5 py-0.5 text-xs bg-red-500 text-white rounded-full">
                {dashboard.activeAlerts}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Real-time metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Requetes (5min)', value: realtime?.requestsLast5Min || 0, icon: '🔄', color: 'bg-blue-500/15' },
              { label: 'Erreurs (5min)', value: realtime?.errorsLast5Min || 0, icon: '⚠️', color: 'bg-red-500/15', alert: (realtime?.errorsLast5Min || 0) > 0 },
              { label: 'Latence moy.', value: `${realtime?.avgLatencyLast5Min?.toFixed(0) || 0}ms`, icon: '⚡', color: 'bg-amber-500/15' },
              { label: 'Taux erreur', value: `${realtime?.errorRateLast5Min?.toFixed(1) || 0}%`, icon: '📊', color: 'bg-purple-500/15', alert: (realtime?.errorRateLast5Min || 0) > 5 },
            ].map((metric) => (
              <div key={metric.label} className={`card ${metric.alert ? 'border-red-500/30' : ''}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl ${metric.color} flex items-center justify-center`}>
                    <span className="text-lg">{metric.icon}</span>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500 uppercase tracking-wider">{metric.label}</p>
                    <p className={`text-xl font-bold ${metric.alert ? 'text-red-400' : 'text-white'}`}>
                      {metric.value}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Action items */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className={`card p-4 ${(dashboard?.pendingKyc || 0) > 5 ? 'border-amber-500/30 bg-amber-500/5' : ''}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">KYC en attente</p>
                  <p className="text-2xl font-bold text-white mt-1">{dashboard?.pendingKyc || 0}</p>
                </div>
                <span className="text-3xl">📋</span>
              </div>
            </div>
            <div className={`card p-4 ${(dashboard?.pendingWithdrawals || 0) > 0 ? 'border-red-500/30 bg-red-500/5' : ''}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">Retraits en attente</p>
                  <p className="text-2xl font-bold text-white mt-1">{dashboard?.pendingWithdrawals || 0}</p>
                </div>
                <span className="text-3xl">📤</span>
              </div>
            </div>
            <div className={`card p-4 ${(dashboard?.activeAlerts || 0) > 0 ? 'border-red-500/30 bg-red-500/5' : ''}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">Alertes actives</p>
                  <p className="text-2xl font-bold text-white mt-1">{dashboard?.activeAlerts || 0}</p>
                </div>
                <span className="text-3xl">🚨</span>
              </div>
            </div>
          </div>

          {/* Transaction chart */}
          <div className="card">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">
              Transactions (7 derniers jours)
            </h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={transactionsByDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="date" stroke="#64748b" fontSize={12} />
                  <YAxis stroke="#64748b" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      border: '1px solid rgba(148, 163, 184, 0.1)',
                      borderRadius: '8px',
                    }}
                  />
                  <Area type="monotone" dataKey="BUY" stackId="1" stroke="#10B981" fill="#10B98150" name="Achats" />
                  <Area type="monotone" dataKey="SELL" stackId="1" stroke="#3B82F6" fill="#3B82F650" name="Ventes" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Today's summary */}
          <div className="card">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">
              Transactions du jour
            </h2>
            {dashboard?.todayTransactions?.length ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {dashboard.todayTransactions.map((tx) => (
                  <div key={`${tx.type}-${tx.status}`} className="p-3 bg-slate-800/40 rounded-xl">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`badge ${tx.type === 'BUY' ? 'badge-success' : tx.type === 'SELL' ? 'badge-info' : 'badge-warning'}`}>
                        {tx.type}
                      </span>
                      <span className={`text-xs ${tx.status === 'COMPLETED' ? 'text-emerald-400' : tx.status === 'PENDING' ? 'text-amber-400' : 'text-red-400'}`}>
                        {tx.status}
                      </span>
                    </div>
                    <p className="text-lg font-bold text-white">{tx.count}</p>
                    <p className="text-xs text-slate-500">{(tx.total_amount || 0).toLocaleString()} FCFA</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-500 text-sm">Aucune transaction aujourd'hui</p>
            )}
          </div>
        </div>
      )}

      {/* Logs Tab */}
      {activeTab === 'logs' && (
        <div className="space-y-6">
          {/* Log stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card">
              <h3 className="text-sm font-semibold text-white mb-3">Total logs</h3>
              <p className="text-3xl font-bold text-gold-500">{logStats?.totalLogs?.toLocaleString() || 0}</p>
            </div>
            <div className="card">
              <h3 className="text-sm font-semibold text-white mb-3">Erreurs recentes (1h)</h3>
              <p className={`text-3xl font-bold ${(logStats?.recentErrors || 0) > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {logStats?.recentErrors || 0}
              </p>
            </div>
            <div className="card">
              <h3 className="text-sm font-semibold text-white mb-3">Par niveau</h3>
              <div className="h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={logLevelData} cx="50%" cy="50%" innerRadius={20} outerRadius={40} dataKey="value" strokeWidth={0}>
                      {logLevelData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-3 flex-wrap">
            <select
              value={logFilters.level || ''}
              onChange={(e) => setLogFilters({ ...logFilters, level: e.target.value || undefined })}
              className="input-field w-32"
            >
              <option value="">Tous niveaux</option>
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
              <option value="fatal">Fatal</option>
            </select>
            <input
              type="text"
              placeholder="Rechercher..."
              value={logFilters.search || ''}
              onChange={(e) => setLogFilters({ ...logFilters, search: e.target.value || undefined })}
              className="input-field flex-1 max-w-xs"
            />
          </div>

          {/* Logs table */}
          <div className="card overflow-hidden">
            {logsLoading ? (
              <div className="p-8 text-center text-slate-500">Chargement...</div>
            ) : logs.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-800/60">
                      <th className="table-header">Timestamp</th>
                      <th className="table-header">Niveau</th>
                      <th className="table-header">Categorie</th>
                      <th className="table-header">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id} className="table-row hover:bg-slate-800/30">
                        <td className="table-cell text-xs text-slate-500 whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleString('fr-FR')}
                        </td>
                        <td className="table-cell">
                          <span className={`font-mono text-xs ${levelColors[log.level] || 'text-slate-400'}`}>
                            {log.level.toUpperCase()}
                          </span>
                        </td>
                        <td className="table-cell text-sm">{log.category}</td>
                        <td className="table-cell text-sm text-slate-300 max-w-md truncate">
                          {log.messagePreview}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-slate-500">Aucun log trouve</div>
            )}
          </div>
        </div>
      )}

      {/* Alerts Tab */}
      {activeTab === 'alerts' && (
        <div className="space-y-6">
          {/* Alert rules */}
          <div className="card">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">
              Regles d'alerte
            </h2>
            {rules.length > 0 ? (
              <div className="space-y-2">
                {rules.map((rule) => (
                  <div key={rule.id} className="p-3 bg-slate-800/40 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => toggleRule.mutate({ ruleId: rule.id, enabled: !rule.enabled })}
                        className={`w-10 h-6 rounded-full transition-colors ${rule.enabled ? 'bg-emerald-500' : 'bg-slate-600'}`}
                      >
                        <div className={`w-4 h-4 bg-white rounded-full transition-transform ${rule.enabled ? 'translate-x-5' : 'translate-x-1'}`} />
                      </button>
                      <div>
                        <p className="text-sm font-medium text-white">{rule.name}</p>
                        <p className="text-xs text-slate-500">
                          {rule.metric} {rule.operator} {rule.threshold}
                        </p>
                      </div>
                    </div>
                    <span className={`badge ${severityBadge[rule.severity] || 'badge-info'}`}>
                      {rule.severity}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-500 text-sm">Aucune regle configuree</p>
            )}
          </div>

          {/* Filters */}
          <div className="flex gap-3">
            <select
              value={alertFilter.severity || ''}
              onChange={(e) => setAlertFilter({ ...alertFilter, severity: e.target.value || undefined })}
              className="input-field w-40"
            >
              <option value="">Toutes severites</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
            <select
              value={alertFilter.resolved === undefined ? '' : String(alertFilter.resolved)}
              onChange={(e) => setAlertFilter({ ...alertFilter, resolved: e.target.value === '' ? undefined : e.target.value === 'true' })}
              className="input-field w-40"
            >
              <option value="">Toutes</option>
              <option value="false">Non resolues</option>
              <option value="true">Resolues</option>
            </select>
          </div>

          {/* Alerts list */}
          <div className="card overflow-hidden">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">
              Historique des alertes
            </h2>
            {alertsLoading ? (
              <div className="p-8 text-center text-slate-500">Chargement...</div>
            ) : alerts.length > 0 ? (
              <div className="space-y-2">
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`p-4 rounded-xl border ${
                      alert.resolved ? 'bg-slate-800/30 border-slate-700/50' : 'bg-red-500/5 border-red-500/20'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`badge ${severityBadge[alert.severity] || 'badge-info'}`}>
                            {alert.severity}
                          </span>
                          <span className="text-sm font-medium text-white">{alert.rule_name}</span>
                        </div>
                        <p className="text-sm text-slate-300">{alert.message}</p>
                        <p className="text-xs text-slate-500 mt-1">
                          {new Date(alert.triggered_at).toLocaleString('fr-FR')}
                          {alert.acknowledged === 1 && ' • Acquittee'}
                          {alert.resolved === 1 && ' • Resolue'}
                        </p>
                      </div>
                      {!alert.resolved && (
                        <div className="flex gap-2">
                          {!alert.acknowledged && (
                            <button
                              onClick={() => acknowledgeAlert.mutate(alert.id)}
                              className="btn-secondary text-xs"
                              disabled={acknowledgeAlert.isPending}
                            >
                              Acquitter
                            </button>
                          )}
                          <button
                            onClick={() => resolveAlert.mutate(alert.id)}
                            className="btn-primary text-xs"
                            disabled={resolveAlert.isPending}
                          >
                            Resoudre
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-slate-500">Aucune alerte</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
