import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useAdminStore } from '../stores/auth';
import { adminApi } from '../lib/api';

const typeLabels: Record<string, string> = {
  BUY: 'Achat',
  SELL: 'Vente',
  DEPOSIT: 'Dépôt',
  WITHDRAWAL: 'Retrait',
  FEE: 'Frais',
};

const typeBadge: Record<string, string> = {
  BUY: 'badge-success',
  SELL: 'badge-info',
  DEPOSIT: 'badge-warning',
  WITHDRAWAL: 'badge-error',
};

export default function Dashboard() {
  const { tokens } = useAdminStore();

  const { data: dashboardData, isLoading } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return adminApi.getDashboard(tokens.accessToken);
    },
    enabled: !!tokens?.accessToken,
  });

  const { data: priceData } = useQuery({
    queryKey: ['price'],
    queryFn: () => adminApi.getPrice(),
    refetchInterval: 60000,
  });

  const { data: stockData } = useQuery({
    queryKey: ['admin-stock'],
    queryFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return adminApi.getStock(tokens.accessToken);
    },
    enabled: !!tokens?.accessToken,
  });

  const { data: pendingKycData } = useQuery({
    queryKey: ['admin-pending-kyc-dashboard'],
    queryFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return adminApi.getPendingKyc(tokens.accessToken, 1, 5);
    },
    enabled: !!tokens?.accessToken,
  });

  const { data: pendingWithdrawalsData } = useQuery({
    queryKey: ['admin-pending-withdrawals-dashboard'],
    queryFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return adminApi.getWithdrawals(tokens.accessToken, 'PENDING');
    },
    enabled: !!tokens?.accessToken,
  });

  const stats = dashboardData?.data;
  const price = priceData?.data;
  const stock = stockData?.data;
  const pendingKyc = pendingKycData?.data?.items || [];
  const pendingWithdrawals = pendingWithdrawalsData?.data?.items || [];

  const stockValue = (stock?.totalAllocated || 0) * (price?.priceXof || 0);

  // Coverage pie chart data
  const coverageData = [
    { name: 'Tokens Émis', value: stock?.tokensIssued || 0, color: '#3B82F6' },
    { name: 'Disponible', value: stock?.availableStock || 0, color: '#D4AF37' },
  ];

  // Quick stats for action items
  const actionItems = [
    {
      label: 'KYC en attente',
      count: stats?.pendingKyc || 0,
      icon: '📋',
      link: '/kyc',
      color: 'yellow',
      urgent: (stats?.pendingKyc || 0) > 5,
    },
    {
      label: 'Retraits en attente',
      count: stats?.pendingWithdrawals || 0,
      icon: '📤',
      link: '/withdrawals',
      color: 'red',
      urgent: (stats?.pendingWithdrawals || 0) > 0,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Tableau de bord</h1>
          <p className="text-slate-500 mt-1 text-sm">Vue d'ensemble de la plateforme TNC Trading</p>
        </div>
        <div className="text-right hidden sm:block">
          <p className="text-[11px] text-slate-600 uppercase tracking-wider font-medium">Dernière MAJ</p>
          <p className="text-sm text-slate-400 mt-0.5">
            {price?.updatedAt ? new Date(price.updatedAt).toLocaleString('fr-FR') : '—'}
          </p>
        </div>
      </div>

      {/* Price & Stock Header */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Price Card */}
        <div className="card-gold relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-gold-500/5 rounded-full blur-2xl" />
          <div className="relative flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Prix de l'or actuel</p>
              <p className="text-3xl font-bold text-gold-500 mt-2 tracking-tight">
                {price?.priceXof?.toLocaleString() || '—'} <span className="text-lg text-gold-600">FCFA/g</span>
              </p>
              <div className="flex items-center gap-4 mt-3">
                <span className="text-xs text-slate-500">
                  Achat: <span className="text-emerald-400 font-medium">{price?.buyPrice?.toLocaleString() || '—'}</span>
                </span>
                <span className="text-xs text-slate-500">
                  Vente: <span className="text-blue-400 font-medium">{price?.sellPrice?.toLocaleString() || '—'}</span>
                </span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-slate-600 uppercase tracking-wider font-medium">Variation 24h</p>
              <p className={`text-2xl font-bold mt-1 ${
                (price?.change24h || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}>
                {(price?.change24h || 0) >= 0 ? '+' : ''}{price?.change24h?.toFixed(2) || '0'}%
              </p>
              <p className="text-xs text-slate-500 mt-1">
                LBMA: ${price?.lbmaUsd?.toFixed(2) || '—'}/g
              </p>
            </div>
          </div>
        </div>

        {/* Stock Card */}
        <div className="card">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Stock d'Or</h2>
            <span className={`badge ${(stock?.coverage || 0) >= 1 ? 'badge-success' : 'badge-error'}`}>
              Couverture: {((stock?.coverage || 0) * 100).toFixed(1)}%
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="p-3 rounded-xl bg-slate-800/40">
              <p className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Alloué</p>
              <p className="text-lg font-bold text-gold-500 mt-1">{stock?.totalAllocated?.toLocaleString() || 0} g</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/40">
              <p className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Émis</p>
              <p className="text-lg font-bold text-blue-400 mt-1">{stock?.tokensIssued?.toLocaleString() || 0} g</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/40">
              <p className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Disponible</p>
              <p className="text-lg font-bold text-emerald-400 mt-1">{stock?.availableStock?.toLocaleString() || 0} g</p>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800/60">
            <p className="text-xs text-slate-500">
              Valeur totale: <span className="text-gold-500 font-semibold">{stockValue.toLocaleString()} FCFA</span>
            </p>
          </div>
        </div>
      </div>

      {/* Action Items */}
      {actionItems.some(item => item.urgent) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {actionItems.filter(item => item.urgent).map((item) => (
            <Link
              key={item.label}
              to={item.link}
              className={`card-interactive p-5 flex items-center justify-between border-2 ${
                item.color === 'yellow'
                  ? 'border-amber-500/30 bg-amber-500/5'
                  : 'border-red-500/30 bg-red-500/5'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  item.color === 'yellow' ? 'bg-amber-500/15' : 'bg-red-500/15'
                }`}>
                  <span className="text-2xl">{item.icon}</span>
                </div>
                <div>
                  <p className="font-semibold text-white">{item.label}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Actions requises</p>
                </div>
              </div>
              <div className="text-right">
                <p className={`text-3xl font-bold ${
                  item.color === 'yellow' ? 'text-amber-400' : 'text-red-400'
                }`}>
                  {item.count}
                </p>
                <span className="text-xs text-gold-500 font-medium">Voir →</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Main KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Utilisateurs', value: stats?.totalUsers, icon: '👥', color: 'bg-blue-500/15', textColor: '' },
          { label: 'Actifs (30j)', value: stats?.activeUsers, icon: '🔄', color: 'bg-emerald-500/15', textColor: 'text-emerald-400' },
          { label: 'Transactions', value: stats?.totalTransactions, icon: '💳', color: 'bg-gold-500/15', textColor: '' },
          { label: 'Volume Total', value: stats?.totalVolume, icon: '💰', color: 'bg-purple-500/15', textColor: 'text-gold-500', isVolume: true },
        ].map((kpi) => (
          <div key={kpi.label} className="card">
            <div className="flex items-center gap-3">
              <div className={`stat-icon ${kpi.color} rounded-xl`}>
                <span className="text-xl">{kpi.icon}</span>
              </div>
              <div>
                <p className="stat-label">{kpi.label}</p>
                {isLoading ? (
                  <div className="h-6 w-16 bg-slate-800 rounded-lg animate-pulse mt-1" />
                ) : (
                  <p className={`text-xl font-bold tracking-tight ${kpi.textColor}`}>
                    {kpi.isVolume
                      ? `${(((kpi.value as number) || 0) / 1000000).toFixed(1)}M`
                      : ((kpi.value as number) || 0).toLocaleString()
                    }
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Stock Coverage Chart */}
        <div className="card">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider mb-5">Répartition du Stock</h2>
          <div className="h-64 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={coverageData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={3}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {coverageData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    border: '1px solid rgba(148, 163, 184, 0.1)',
                    borderRadius: '12px',
                    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
                  }}
                  formatter={(value: number) => [`${value.toLocaleString()} g`, '']}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-6 mt-4">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              <span className="text-xs text-slate-500">Émis ({stock?.tokensIssued?.toLocaleString() || 0} g)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-gold-500" />
              <span className="text-xs text-slate-500">Disponible ({stock?.availableStock?.toLocaleString() || 0} g)</span>
            </div>
          </div>
        </div>

        {/* Pending Actions */}
        <div className="card">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider mb-5">Actions en Attente</h2>
          <div className="space-y-5">
            {/* Pending KYC */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">KYC en attente</span>
                <Link to="/kyc" className="text-xs text-gold-500 hover:text-gold-400 font-medium transition-colors">
                  Voir tout →
                </Link>
              </div>
              {pendingKyc.length > 0 ? (
                <div className="space-y-2">
                  {pendingKyc.slice(0, 3).map((kyc) => (
                    <div key={kyc.id} className="p-3 bg-slate-800/40 rounded-xl flex items-center justify-between hover:bg-slate-800/60 transition-colors">
                      <div>
                        <p className="text-sm font-medium text-slate-200">{kyc.email}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {kyc.firstName} {kyc.lastName} - {kyc.documentType}
                        </p>
                      </div>
                      <span className="badge badge-warning">En attente</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 bg-slate-800/30 rounded-xl text-sm text-slate-500 text-center">
                  Aucun KYC en attente
                </div>
              )}
            </div>

            {/* Pending Withdrawals */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Retraits en attente</span>
                <Link to="/withdrawals" className="text-xs text-gold-500 hover:text-gold-400 font-medium transition-colors">
                  Voir tout →
                </Link>
              </div>
              {pendingWithdrawals.length > 0 ? (
                <div className="space-y-2">
                  {pendingWithdrawals.slice(0, 3).map((withdrawal) => (
                    <div key={withdrawal.id} className="p-3 bg-slate-800/40 rounded-xl flex items-center justify-between hover:bg-slate-800/60 transition-colors">
                      <div>
                        <p className="text-sm font-medium text-slate-200">{withdrawal.userEmail}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {(withdrawal.amount ?? 0).toLocaleString()} FCFA - {withdrawal.paymentMethod}
                        </p>
                      </div>
                      <span className="badge badge-error">En attente</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 bg-slate-800/30 rounded-xl text-sm text-slate-500 text-center">
                  Aucun retrait en attente
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between mb-5 px-1">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Transactions Récentes</h2>
          <Link to="/transactions" className="text-xs text-gold-500 hover:text-gold-400 font-medium transition-colors">
            Voir tout →
          </Link>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-slate-800/40 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : stats?.recentTransactions?.length ? (
          <div className="overflow-x-auto -mx-6">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-800/60">
                  <th className="table-header">Type</th>
                  <th className="table-header">Montant</th>
                  <th className="table-header">Date</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentTransactions.map((tx) => (
                  <tr key={tx.id} className="table-row">
                    <td className="table-cell">
                      <span className={`badge ${typeBadge[tx.type] || 'badge-info'}`}>
                        {typeLabels[tx.type] || tx.type}
                      </span>
                    </td>
                    <td className="table-cell font-semibold text-white">
                      {(tx.amount ?? 0).toLocaleString()} FCFA
                    </td>
                    <td className="table-cell text-slate-500 text-xs">
                      {tx.createdAt ? new Date(tx.createdAt).toLocaleString('fr-FR', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-slate-500">
            Aucune transaction récente
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { to: '/users', icon: '👥', label: 'Utilisateurs' },
          { to: '/transactions', icon: '💳', label: 'Transactions' },
          { to: '/kyc', icon: '📋', label: 'KYC' },
          { to: '/withdrawals', icon: '📤', label: 'Retraits' },
        ].map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="card-interactive p-5 text-center group"
          >
            <div className="w-12 h-12 rounded-xl bg-slate-800/60 flex items-center justify-center mx-auto group-hover:bg-gold-500/10 transition-colors">
              <span className="text-2xl">{link.icon}</span>
            </div>
            <p className="mt-3 font-medium text-sm text-slate-300 group-hover:text-white transition-colors">{link.label}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
