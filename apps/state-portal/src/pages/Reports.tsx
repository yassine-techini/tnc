import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';
import { useStateStore } from '../stores/auth';
import { stateApi } from '../lib/api';

const txPeriodOptions = [
  { value: 'day', label: 'Par jour' },
  { value: 'week', label: 'Par semaine' },
  { value: 'month', label: 'Par mois' },
];

const pricePeriodOptions = [
  { value: 7, label: '7 jours' },
  { value: 30, label: '30 jours' },
  { value: 90, label: '90 jours' },
];

export default function Reports() {
  const { isAuthenticated } = useStateStore();
  const [selectedMonth, setSelectedMonth] = useState('');
  const [txPeriod, setTxPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [pricePeriod, setPricePeriod] = useState(30);
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');

  const { data: porData, isLoading: porLoading } = useQuery({
    queryKey: ['state-por'],
    queryFn: () => stateApi.getProofOfReserve(),
    enabled: isAuthenticated,
  });

  const { data: monthlyData, isLoading: monthlyLoading } = useQuery({
    queryKey: ['state-monthly', selectedMonth],
    queryFn: () => stateApi.getMonthlyReport(selectedMonth || undefined),
    enabled: isAuthenticated,
  });

  const { data: priceHistoryData } = useQuery({
    queryKey: ['state-price-history', pricePeriod],
    queryFn: () => stateApi.getPriceHistory(pricePeriod),
    enabled: isAuthenticated,
  });

  const { data: txStatsData } = useQuery({
    queryKey: ['state-tx-stats', txPeriod],
    queryFn: () => stateApi.getTransactionStats(txPeriod),
    enabled: isAuthenticated,
  });

  const exportPorMutation = useMutation({
    mutationFn: async () => {
      const blob = await stateApi.exportPorReport();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `por-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    },
  });

  const exportMonthlyMutation = useMutation({
    mutationFn: async () => {
      const blob = await stateApi.exportMonthlyReport(selectedMonth || undefined);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `monthly-report-${selectedMonth || new Date().toISOString().slice(0, 7)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    },
  });

  const exportDataMutation = useMutation({
    mutationFn: async () => {
      const blob = await stateApi.exportRawData(
        exportStartDate || undefined,
        exportEndDate || undefined
      );
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateRange = exportStartDate || exportEndDate
        ? `_${exportStartDate || 'début'}_${exportEndDate || 'fin'}`
        : '';
      a.download = `tnc-data${dateRange}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    },
  });

  const por = porData?.data;
  const monthly = monthlyData?.data;
  const priceHistory = priceHistoryData?.data?.items || [];
  const txStats = txStatsData?.data?.items || [];

  const months = Array.from({ length: 12 }, (_, i) => {
    const date = new Date();
    date.setMonth(date.getMonth() - i);
    return {
      value: date.toISOString().slice(0, 7),
      label: date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
    };
  });

  // Calculate price stats
  const priceStats = useMemo(() => {
    if (priceHistory.length === 0) return null;
    return {
      min: Math.min(...priceHistory.map(p => p.priceXof)),
      max: Math.max(...priceHistory.map(p => p.priceXof)),
      avg: priceHistory.reduce((sum, p) => sum + p.priceXof, 0) / priceHistory.length,
      change: priceHistory.length > 1
        ? ((priceHistory[priceHistory.length - 1].priceXof - priceHistory[0].priceXof) / priceHistory[0].priceXof) * 100
        : 0,
    };
  }, [priceHistory]);

  // Calculate tx totals
  const txTotals = useMemo(() => {
    return txStats.reduce((acc, tx) => ({
      buyCount: acc.buyCount + (tx.buyCount || 0),
      sellCount: acc.sellCount + (tx.sellCount || 0),
      buyVolume: acc.buyVolume + (tx.buyVolume || 0),
      sellVolume: acc.sellVolume + (tx.sellVolume || 0),
    }), { buyCount: 0, sellCount: 0, buyVolume: 0, sellVolume: 0 });
  }, [txStats]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Rapports</h1>
        <p className="text-slate-400 mt-1">Proof of Reserve et rapports mensuels</p>
      </div>

      {/* Proof of Reserve */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Proof of Reserve (PoR)</h2>
          <span className={`badge ${
            por?.auditStatus === 'VERIFIED' ? 'badge-success' :
            por?.auditStatus === 'EXPIRED' ? 'badge-error' : 'badge-warning'
          }`}>
            {por?.auditStatus === 'VERIFIED' ? 'Vérifié' :
             por?.auditStatus === 'EXPIRED' ? 'Expiré' : 'En attente'}
          </span>
        </div>

        {porLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-slate-700 rounded animate-pulse"></div>
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div className="stat-card">
                <p className="text-sm text-slate-400">Or Physique</p>
                <p className="text-2xl font-bold text-gold-500">
                  {por?.totalAllocatedGold?.toLocaleString() || '0'} g
                </p>
              </div>
              <div className="stat-card">
                <p className="text-sm text-slate-400">Tokens Émis</p>
                <p className="text-2xl font-bold">
                  {por?.totalTokensIssued?.toLocaleString() || '0'} g
                </p>
              </div>
              <div className="stat-card">
                <p className="text-sm text-slate-400">Ratio de Couverture</p>
                <p className={`text-2xl font-bold ${
                  (por?.coverageRatio || 0) >= 1 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {((por?.coverageRatio || 0) * 100).toFixed(1)}%
                </p>
              </div>
            </div>

            <div className="p-4 bg-slate-900/50 rounded-lg">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-slate-400">Date du rapport</p>
                  <p className="font-medium">
                    {por?.reportDate
                      ? new Date(por.reportDate).toLocaleDateString('fr-FR')
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400">Dernier audit</p>
                  <p className="font-medium">
                    {por?.lastAuditDate
                      ? new Date(por.lastAuditDate).toLocaleDateString('fr-FR')
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400">Auditeur</p>
                  <p className="font-medium">{por?.auditor || '—'}</p>
                </div>
                <div>
                  <p className="text-slate-400">Surplus/Déficit</p>
                  <p className={`font-medium ${
                    (por?.totalAllocatedGold || 0) >= (por?.totalTokensIssued || 0)
                      ? 'text-green-400'
                      : 'text-red-400'
                  }`}>
                    {((por?.totalAllocatedGold || 0) - (por?.totalTokensIssued || 0)).toLocaleString()} g
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Monthly Report */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Rapport Mensuel</h2>
          <select
            className="input w-auto"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          >
            <option value="">Mois actuel</option>
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {monthlyLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 bg-slate-700 rounded animate-pulse"></div>
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
              <div className="stat-card">
                <p className="text-sm text-slate-400">Transactions</p>
                <p className="text-2xl font-bold">{monthly?.totalTransactions || 0}</p>
              </div>
              <div className="stat-card">
                <p className="text-sm text-slate-400">Volume Total</p>
                <p className="text-2xl font-bold">{monthly?.totalVolume?.toLocaleString() || 0} FCFA</p>
              </div>
              <div className="stat-card">
                <p className="text-sm text-slate-400">Nouveaux Utilisateurs</p>
                <p className="text-2xl font-bold text-green-400">{monthly?.newUsers || 0}</p>
              </div>
              <div className="stat-card">
                <p className="text-sm text-slate-400">Utilisateurs Actifs</p>
                <p className="text-2xl font-bold">{monthly?.activeUsers || 0}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                <p className="text-sm text-slate-400">Volume Achats</p>
                <p className="text-xl font-bold text-green-400">
                  {monthly?.buyVolume?.toLocaleString() || 0} FCFA
                </p>
              </div>
              <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                <p className="text-sm text-slate-400">Volume Ventes</p>
                <p className="text-xl font-bold text-blue-400">
                  {monthly?.sellVolume?.toLocaleString() || 0} FCFA
                </p>
              </div>
            </div>

            <div className="mt-6 p-4 bg-slate-900/50 rounded-lg">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-slate-400">Prix Moyen</p>
                  <p className="font-medium">{monthly?.averagePrice?.toLocaleString() || '—'} FCFA/g</p>
                </div>
                <div>
                  <p className="text-slate-400">Frais Collectés</p>
                  <p className="font-medium">{monthly?.fees?.toLocaleString() || '—'} FCFA</p>
                </div>
                <div>
                  <p className="text-slate-400">Ratio Achat/Vente</p>
                  <p className="font-medium">
                    {monthly?.buyVolume && monthly?.sellVolume
                      ? (monthly.buyVolume / monthly.sellVolume).toFixed(2)
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400">Taux Rétention</p>
                  <p className="font-medium">
                    {monthly?.activeUsers && monthly?.newUsers
                      ? ((monthly.activeUsers / (monthly.activeUsers + monthly.newUsers)) * 100).toFixed(1)
                      : '—'}%
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Price History Chart */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Évolution du Prix</h2>
          <div className="flex gap-1">
            {pricePeriodOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setPricePeriod(option.value)}
                className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                  pricePeriod === option.value
                    ? 'bg-gold-500 text-slate-900 font-medium'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Price Stats */}
        {priceStats && (
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div className="p-3 bg-slate-800/50 rounded-lg text-center">
              <p className="text-xs text-slate-400">Min</p>
              <p className="text-sm font-medium">{priceStats.min.toLocaleString()} FCFA</p>
            </div>
            <div className="p-3 bg-slate-800/50 rounded-lg text-center">
              <p className="text-xs text-slate-400">Max</p>
              <p className="text-sm font-medium">{priceStats.max.toLocaleString()} FCFA</p>
            </div>
            <div className="p-3 bg-slate-800/50 rounded-lg text-center">
              <p className="text-xs text-slate-400">Moyenne</p>
              <p className="text-sm font-medium">{priceStats.avg.toLocaleString()} FCFA</p>
            </div>
            <div className="p-3 bg-slate-800/50 rounded-lg text-center">
              <p className="text-xs text-slate-400">Variation</p>
              <p className={`text-sm font-medium ${priceStats.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {priceStats.change >= 0 ? '+' : ''}{priceStats.change.toFixed(2)}%
              </p>
            </div>
          </div>
        )}

        {priceHistory.length > 0 ? (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={priceHistory}>
                <defs>
                  <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#D4AF37" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#D4AF37" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="date"
                  stroke="#9CA3AF"
                  tickFormatter={(value) => new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                />
                <YAxis
                  stroke="#9CA3AF"
                  tickFormatter={(value) => `${(value / 1000).toFixed(0)}K`}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1A1A2E', border: 'none', borderRadius: '8px' }}
                  labelStyle={{ color: '#9CA3AF' }}
                  formatter={(value: number) => [`${value.toLocaleString()} FCFA/g`, 'Prix']}
                  labelFormatter={(label) => new Date(label).toLocaleDateString('fr-FR')}
                />
                <Area
                  type="monotone"
                  dataKey="priceXof"
                  stroke="#D4AF37"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorPrice)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-80 flex items-center justify-center text-slate-400">
            Chargement des données...
          </div>
        )}
      </div>

      {/* Transaction Volume Chart */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Volume des Transactions</h2>
          <div className="flex gap-1">
            {txPeriodOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setTxPeriod(option.value as 'day' | 'week' | 'month')}
                className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                  txPeriod === option.value
                    ? 'bg-gold-500 text-slate-900 font-medium'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Transaction Totals */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
            <p className="text-xs text-slate-400">Achats (nb)</p>
            <p className="text-lg font-bold text-green-400">{txTotals.buyCount}</p>
          </div>
          <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <p className="text-xs text-slate-400">Ventes (nb)</p>
            <p className="text-lg font-bold text-blue-400">{txTotals.sellCount}</p>
          </div>
          <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
            <p className="text-xs text-slate-400">Vol. Achats</p>
            <p className="text-sm font-bold text-green-400">{txTotals.buyVolume.toLocaleString()} FCFA</p>
          </div>
          <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <p className="text-xs text-slate-400">Vol. Ventes</p>
            <p className="text-sm font-bold text-blue-400">{txTotals.sellVolume.toLocaleString()} FCFA</p>
          </div>
        </div>

        {txStats.length > 0 ? (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={txStats}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="date"
                  stroke="#9CA3AF"
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    if (txPeriod === 'day') return date.toLocaleDateString('fr-FR', { day: '2-digit' });
                    if (txPeriod === 'week') return `S${Math.ceil(date.getDate() / 7)}`;
                    return date.toLocaleDateString('fr-FR', { month: 'short' });
                  }}
                />
                <YAxis
                  stroke="#9CA3AF"
                  tickFormatter={(value) => `${(value / 1000000).toFixed(1)}M`}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1A1A2E', border: 'none', borderRadius: '8px' }}
                  labelStyle={{ color: '#9CA3AF' }}
                  formatter={(value: number, name: string) => [
                    `${value.toLocaleString()} FCFA`,
                    name === 'buyVolume' ? 'Achats' : 'Ventes'
                  ]}
                  labelFormatter={(label) => new Date(label).toLocaleDateString('fr-FR')}
                />
                <Legend
                  formatter={(value) => value === 'buyVolume' ? 'Achats' : 'Ventes'}
                />
                <Bar dataKey="buyVolume" fill="#10B981" name="buyVolume" radius={[4, 4, 0, 0]} />
                <Bar dataKey="sellVolume" fill="#3B82F6" name="sellVolume" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-80 flex items-center justify-center text-slate-400">
            Chargement des données...
          </div>
        )}
      </div>

      {/* Download Section */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Télécharger les Rapports</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* PoR Report */}
          <div className="p-4 bg-slate-900/50 rounded-lg">
            <h3 className="font-medium mb-2">Rapport PoR</h3>
            <p className="text-sm text-slate-400 mb-4">
              Proof of Reserve avec couverture et audit
            </p>
            <button
              className="btn-secondary w-full flex items-center justify-center gap-2 disabled:opacity-50"
              onClick={() => exportPorMutation.mutate()}
              disabled={exportPorMutation.isPending}
            >
              {exportPorMutation.isPending ? (
                <span className="animate-spin">⏳</span>
              ) : (
                <span>📄</span>
              )}
              Exporter PDF
            </button>
          </div>

          {/* Monthly Report */}
          <div className="p-4 bg-slate-900/50 rounded-lg">
            <h3 className="font-medium mb-2">Rapport Mensuel</h3>
            <p className="text-sm text-slate-400 mb-4">
              Statistiques du mois: {selectedMonth
                ? new Date(selectedMonth + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
                : 'actuel'}
            </p>
            <button
              className="btn-secondary w-full flex items-center justify-center gap-2 disabled:opacity-50"
              onClick={() => exportMonthlyMutation.mutate()}
              disabled={exportMonthlyMutation.isPending}
            >
              {exportMonthlyMutation.isPending ? (
                <span className="animate-spin">⏳</span>
              ) : (
                <span>📊</span>
              )}
              Exporter PDF
            </button>
          </div>

          {/* Raw Data with Date Range */}
          <div className="p-4 bg-slate-900/50 rounded-lg">
            <h3 className="font-medium mb-2">Données Brutes</h3>
            <p className="text-sm text-slate-400 mb-3">
              Transactions et données détaillées
            </p>
            <div className="space-y-2 mb-4">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-slate-400 mb-1">Du</label>
                  <input
                    type="date"
                    className="input w-full text-sm"
                    value={exportStartDate}
                    onChange={(e) => setExportStartDate(e.target.value)}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-slate-400 mb-1">Au</label>
                  <input
                    type="date"
                    className="input w-full text-sm"
                    value={exportEndDate}
                    onChange={(e) => setExportEndDate(e.target.value)}
                  />
                </div>
              </div>
              {(exportStartDate || exportEndDate) && (
                <button
                  className="text-xs text-gold-400 hover:text-gold-300"
                  onClick={() => {
                    setExportStartDate('');
                    setExportEndDate('');
                  }}
                >
                  Effacer les dates
                </button>
              )}
            </div>
            <button
              className="btn-secondary w-full flex items-center justify-center gap-2 disabled:opacity-50"
              onClick={() => exportDataMutation.mutate()}
              disabled={exportDataMutation.isPending}
            >
              {exportDataMutation.isPending ? (
                <span className="animate-spin">⏳</span>
              ) : (
                <span>📁</span>
              )}
              Exporter CSV
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-500 mt-4">
          Les rapports téléchargés sont signés numériquement et peuvent être vérifiés.
          {(exportStartDate || exportEndDate) && (
            <span className="text-gold-400">
              {' '}Période sélectionnée: {exportStartDate || 'début'} - {exportEndDate || 'fin'}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
