import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, Legend } from 'recharts';
import { useStateStore } from '../stores/auth';
import { stateApi } from '../lib/api';

const periodOptions = [
  { value: 7, label: '7 jours' },
  { value: 30, label: '30 jours' },
  { value: 90, label: '90 jours' },
  { value: 365, label: '1 an' },
];

const txPeriodOptions = [
  { value: 'day', label: 'Par jour' },
  { value: 'week', label: 'Par semaine' },
  { value: 'month', label: 'Par mois' },
];

export default function Dashboard() {
  const { isAuthenticated } = useStateStore();
  const [chartPeriod, setChartPeriod] = useState(7);
  const [txPeriod, setTxPeriod] = useState<'day' | 'week' | 'month'>('day');

  const { data: dashboardData, isLoading } = useQuery({
    queryKey: ['state-dashboard'],
    queryFn: () => stateApi.getDashboard(),
    enabled: isAuthenticated,
  });

  const { data: priceData } = useQuery({
    queryKey: ['price'],
    queryFn: () => stateApi.getPrice(),
    refetchInterval: 60000,
  });

  const { data: priceHistoryData } = useQuery({
    queryKey: ['state-price-history', chartPeriod],
    queryFn: () => stateApi.getPriceHistory(chartPeriod),
    enabled: isAuthenticated,
  });

  const { data: txStatsData } = useQuery({
    queryKey: ['state-tx-stats-dashboard', txPeriod],
    queryFn: () => stateApi.getTransactionStats(txPeriod),
    enabled: isAuthenticated,
  });

  const stats = dashboardData?.data;
  const price = priceData?.data;
  const priceHistory = priceHistoryData?.data?.items || [];
  const txStats = txStatsData?.data?.items || [];

  const stockValue = (stats?.totalAllocated || 0) * (price?.priceXof || 0);

  // Data for coverage pie chart
  const coverageData = [
    { name: 'Tokens Émis', value: stats?.tokensIssued || 0, color: '#3B82F6' },
    { name: 'Disponible', value: (stats?.totalAllocated || 0) - (stats?.tokensIssued || 0), color: '#D4AF37' },
  ];

  // Calculate price stats
  const priceStats = priceHistory.length > 0 ? {
    min: Math.min(...priceHistory.map(p => p.priceXof)),
    max: Math.max(...priceHistory.map(p => p.priceXof)),
    avg: priceHistory.reduce((sum, p) => sum + p.priceXof, 0) / priceHistory.length,
    change: priceHistory.length > 1
      ? ((priceHistory[priceHistory.length - 1].priceXof - priceHistory[0].priceXof) / priceHistory[0].priceXof) * 100
      : 0,
  } : null;

  // Calculate transaction totals
  const txTotals = txStats.reduce((acc, tx) => ({
    buyCount: acc.buyCount + (tx.buyCount || 0),
    sellCount: acc.sellCount + (tx.sellCount || 0),
    buyVolume: acc.buyVolume + (tx.buyVolume || 0),
    sellVolume: acc.sellVolume + (tx.sellVolume || 0),
  }), { buyCount: 0, sellCount: 0, buyVolume: 0, sellVolume: 0 });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Vue d'ensemble</h1>
        <p className="text-slate-400 mt-1">Etat de la réserve d'or nationale tokenisée</p>
      </div>

      {/* Main Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gold Allocated */}
        <div className="card-state">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-gold-500/20 rounded-xl flex items-center justify-center">
              <span className="text-3xl">🪙</span>
            </div>
            <div>
              <p className="text-sm text-slate-400">Or Alloué</p>
              {isLoading ? (
                <div className="h-8 w-32 bg-slate-700 rounded animate-pulse mt-1"></div>
              ) : (
                <>
                  <p className="text-3xl font-bold text-gold-500">
                    {stats?.totalAllocated?.toFixed(0) || '0'} g
                  </p>
                  <p className="text-sm text-slate-400">
                    = {stockValue.toLocaleString()} FCFA
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Tokens Issued */}
        <div className="card">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-blue-500/20 rounded-xl flex items-center justify-center">
              <span className="text-3xl">📊</span>
            </div>
            <div>
              <p className="text-sm text-slate-400">Tokens Émis</p>
              {isLoading ? (
                <div className="h-8 w-32 bg-slate-700 rounded animate-pulse mt-1"></div>
              ) : (
                <p className="text-3xl font-bold">
                  {stats?.tokensIssued?.toFixed(0) || '0'} g
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Coverage */}
        <div className="card">
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${
              (stats?.coverage || 0) >= 1 ? 'bg-green-500/20' : 'bg-red-500/20'
            }`}>
              <span className="text-3xl">{(stats?.coverage || 0) >= 1 ? '✓' : '⚠️'}</span>
            </div>
            <div>
              <p className="text-sm text-slate-400">Couverture</p>
              {isLoading ? (
                <div className="h-8 w-32 bg-slate-700 rounded animate-pulse mt-1"></div>
              ) : (
                <p className={`text-3xl font-bold ${
                  (stats?.coverage || 0) >= 1 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {((stats?.coverage || 0) * 100).toFixed(1)}%
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Price Info */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Prix de l'Or</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="stat-card">
            <p className="text-sm text-slate-400">Prix LBMA (USD)</p>
            <p className="text-xl font-bold">${price?.lbmaUsd?.toFixed(2) || '—'}/g</p>
          </div>
          <div className="stat-card">
            <p className="text-sm text-slate-400">Prix FCFA</p>
            <p className="text-xl font-bold text-gold-500">{price?.priceXof?.toLocaleString() || '—'} FCFA/g</p>
          </div>
          <div className="stat-card">
            <p className="text-sm text-slate-400">Variation 24h</p>
            <p className={`text-xl font-bold ${(price?.change24h || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {(price?.change24h || 0) >= 0 ? '+' : ''}{price?.change24h?.toFixed(2) || '0'}%
            </p>
          </div>
          <div className="stat-card">
            <p className="text-sm text-slate-400">Dernière MAJ</p>
            <p className="text-xl font-bold">
              {price?.updatedAt ? new Date(price.updatedAt).toLocaleTimeString('fr-FR') : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Price Chart */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Évolution du Prix</h2>
            <div className="flex gap-1">
              {periodOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setChartPeriod(option.value)}
                  className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                    chartPeriod === option.value
                      ? 'bg-gold-500 text-slate-900 font-medium'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Price Stats Summary */}
          {priceStats && (
            <div className="grid grid-cols-4 gap-2 mb-4">
              <div className="p-2 bg-slate-800/50 rounded text-center">
                <p className="text-xs text-slate-400">Min</p>
                <p className="text-sm font-medium">{priceStats.min.toLocaleString()}</p>
              </div>
              <div className="p-2 bg-slate-800/50 rounded text-center">
                <p className="text-xs text-slate-400">Max</p>
                <p className="text-sm font-medium">{priceStats.max.toLocaleString()}</p>
              </div>
              <div className="p-2 bg-slate-800/50 rounded text-center">
                <p className="text-xs text-slate-400">Moyenne</p>
                <p className="text-sm font-medium">{priceStats.avg.toLocaleString()}</p>
              </div>
              <div className="p-2 bg-slate-800/50 rounded text-center">
                <p className="text-xs text-slate-400">Variation</p>
                <p className={`text-sm font-medium ${priceStats.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {priceStats.change >= 0 ? '+' : ''}{priceStats.change.toFixed(2)}%
                </p>
              </div>
            </div>
          )}

          {priceHistory.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={priceHistory}>
                  <defs>
                    <linearGradient id="colorPriceGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#D4AF37" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#D4AF37" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis
                    dataKey="date"
                    stroke="#9CA3AF"
                    fontSize={12}
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      if (chartPeriod <= 7) return date.toLocaleDateString('fr-FR', { weekday: 'short' });
                      if (chartPeriod <= 30) return date.toLocaleDateString('fr-FR', { day: '2-digit' });
                      return date.toLocaleDateString('fr-FR', { month: 'short' });
                    }}
                  />
                  <YAxis
                    stroke="#9CA3AF"
                    fontSize={12}
                    tickFormatter={(value) => `${(value / 1000).toFixed(0)}K`}
                    domain={['auto', 'auto']}
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
                    fill="url(#colorPriceGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-slate-400">
              Chargement des données...
            </div>
          )}
        </div>

        {/* Coverage Pie Chart */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Répartition du Stock</h2>
          <div className="h-64 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={coverageData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {coverageData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#1A1A2E', border: 'none', borderRadius: '8px' }}
                  formatter={(value: number) => [`${value.toFixed(0)} g`, '']}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-6 mt-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-blue-500"></div>
              <span className="text-sm text-slate-400">Tokens Émis ({stats?.tokensIssued?.toFixed(0) || 0} g)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-gold-500"></div>
              <span className="text-sm text-slate-400">Disponible ({((stats?.totalAllocated || 0) - (stats?.tokensIssued || 0)).toFixed(0)} g)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Transaction Stats */}
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

        {/* Transaction Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
            <p className="text-xs text-slate-400">Achats (nb)</p>
            <p className="text-xl font-bold text-green-400">{txTotals.buyCount}</p>
          </div>
          <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <p className="text-xs text-slate-400">Ventes (nb)</p>
            <p className="text-xl font-bold text-blue-400">{txTotals.sellCount}</p>
          </div>
          <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
            <p className="text-xs text-slate-400">Vol. Achats</p>
            <p className="text-lg font-bold text-green-400">{txTotals.buyVolume.toLocaleString()} <span className="text-sm">FCFA</span></p>
          </div>
          <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <p className="text-xs text-slate-400">Vol. Ventes</p>
            <p className="text-lg font-bold text-blue-400">{txTotals.sellVolume.toLocaleString()} <span className="text-sm">FCFA</span></p>
          </div>
        </div>

        {txStats.length > 0 ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={txStats}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="date"
                  stroke="#9CA3AF"
                  fontSize={12}
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    if (txPeriod === 'day') return date.toLocaleDateString('fr-FR', { day: '2-digit' });
                    if (txPeriod === 'week') return `S${Math.ceil(date.getDate() / 7)}`;
                    return date.toLocaleDateString('fr-FR', { month: 'short' });
                  }}
                />
                <YAxis
                  stroke="#9CA3AF"
                  fontSize={12}
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
          <div className="h-64 flex items-center justify-center text-slate-400">
            Chargement des données...
          </div>
        )}
      </div>

      {/* Platform Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Utilisateurs</h2>
          <div className="flex items-center gap-4">
            <div className="text-4xl">👥</div>
            <div>
              <p className="text-3xl font-bold">{stats?.totalUsers?.toLocaleString() || '0'}</p>
              <p className="text-sm text-slate-400">Comptes enregistrés</p>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Volume Total</h2>
          <div className="flex items-center gap-4">
            <div className="text-4xl">💰</div>
            <div>
              <p className="text-3xl font-bold">{stats?.totalVolume?.toLocaleString() || '0'} FCFA</p>
              <p className="text-sm text-slate-400">Depuis le lancement</p>
            </div>
          </div>
        </div>
      </div>

      {/* Info Box */}
      <div className="p-4 bg-slate-800/50 border border-slate-700 rounded-lg">
        <div className="flex items-start gap-3">
          <span className="text-xl">ℹ️</span>
          <div>
            <p className="font-medium">Informations</p>
            <p className="text-sm text-slate-400 mt-1">
              Les données présentées sur ce portail sont en temps réel et reflètent
              l'état actuel de la plateforme TNC Trading. Pour toute question,
              contactez la Direction Générale des Mines.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
