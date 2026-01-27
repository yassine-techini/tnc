import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../stores/auth';
import { api } from '../lib/api';
import PriceChart, { PriceDataPoint } from '../components/PriceChart';
import { UTCTimestamp } from 'lightweight-charts';

const typeLabels: Record<string, string> = {
  BUY: 'Achat',
  SELL: 'Vente',
  DEPOSIT: 'Dépôt',
  WITHDRAWAL: 'Retrait',
  FEE: 'Frais',
};

const statusLabels: Record<string, { label: string; badge: string }> = {
  PENDING: { label: 'En attente', badge: 'badge-warning' },
  PROCESSING: { label: 'En cours', badge: 'badge-info' },
  COMPLETED: { label: 'Complète', badge: 'badge-success' },
  FAILED: { label: 'Échoué', badge: 'badge-error' },
  CANCELLED: { label: 'Annule', badge: 'badge-warning' },
};

const periodOptions = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7j' },
  { value: '30d', label: '30j' },
  { value: '1y', label: '1an' },
];

export default function Dashboard() {
  const { user, tokens } = useAuthStore();
  const [chartPeriod, setChartPeriod] = useState<'24h' | '7d' | '30d' | '1y'>('7d');

  const { data: walletData, isLoading: walletLoading } = useQuery({
    queryKey: ['wallet'],
    queryFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return api.getWallet(tokens.accessToken);
    },
    enabled: !!tokens?.accessToken,
  });

  const { data: priceData, isLoading: priceLoading } = useQuery({
    queryKey: ['price'],
    queryFn: () => api.getPrice(),
    refetchInterval: 60000,
  });

  const { data: priceHistoryData, isLoading: historyLoading } = useQuery({
    queryKey: ['price-history', chartPeriod],
    queryFn: () => api.getPriceHistory(chartPeriod),
  });

  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ['transactions-recent'],
    queryFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return api.getTransactions(tokens.accessToken, 1, 5);
    },
    enabled: !!tokens?.accessToken,
  });

  const { data: stockData } = useQuery({
    queryKey: ['stock'],
    queryFn: () => api.getStock(),
  });

  const wallet = walletData?.data;
  const price = priceData?.data;
  const priceHistory = priceHistoryData?.data?.items || [];
  const transactions = txData?.data?.items || [];
  const stock = stockData?.data;

  // Transform price history for chart
  const chartData = useMemo<PriceDataPoint[]>(() => {
    return priceHistory.map((item) => ({
      time: Math.floor(new Date(item.timestamp).getTime() / 1000) as UTCTimestamp,
      value: item.priceXof,
    }));
  }, [priceHistory]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Tableau de bord</h1>
        <p className="text-slate-500 mt-1 text-sm">Bienvenue, {user?.email}</p>
      </div>

      {/* KYC Alert */}
      {user?.kycLevel === 'BASIC' && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center flex-shrink-0">
            <span className="text-xl">⚠️</span>
          </div>
          <div className="flex-1">
            <p className="font-semibold text-amber-400 text-sm">Vérification requise</p>
            <p className="text-xs text-slate-400 mt-0.5">
              Complétez votre KYC pour acheter et vendre de l'or.{' '}
              <a href="/kyc" className="text-gold-500 hover:text-gold-400 font-medium transition-colors">Commencer →</a>
            </p>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Token Balance */}
        <div className="card-gold relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-gold-500/5 rounded-full blur-2xl" />
          <p className="stat-label mb-2">Solde Or</p>
          {walletLoading ? (
            <div className="h-8 bg-slate-800 rounded-lg animate-pulse" />
          ) : (
            <div className="relative">
              <p className="text-2xl font-bold text-gold-500 tracking-tight">
                {wallet?.tokenBalance?.toFixed(3) || '0.000'} g
              </p>
              <p className="text-xs text-slate-500 mt-1">
                ≈ {((wallet?.tokenBalance || 0) * (price?.sellPrice || 0)).toLocaleString()} FCFA
              </p>
            </div>
          )}
        </div>

        {/* Cash Balance */}
        <div className="card">
          <p className="stat-label mb-2">Solde FCFA</p>
          {walletLoading ? (
            <div className="h-8 bg-slate-800 rounded-lg animate-pulse" />
          ) : (
            <p className="text-2xl font-bold tracking-tight">
              {(wallet?.cashBalance || 0).toLocaleString()} <span className="text-sm text-slate-500">FCFA</span>
            </p>
          )}
        </div>

        {/* Gold Price */}
        <div className="card">
          <p className="stat-label mb-2">Prix de l'or</p>
          {priceLoading ? (
            <div className="h-8 bg-slate-800 rounded-lg animate-pulse" />
          ) : (
            <>
              <p className="text-2xl font-bold tracking-tight">
                {(price?.priceXof || 0).toLocaleString()} <span className="text-sm text-slate-500">FCFA/g</span>
              </p>
              <p className={`text-xs mt-1 font-medium ${(price?.change24h || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {(price?.change24h || 0) >= 0 ? '↑' : '↓'} {Math.abs(price?.change24h || 0).toFixed(2)}% (24h)
              </p>
            </>
          )}
        </div>

        {/* Performance */}
        <div className="card">
          <p className="stat-label mb-2">Performance</p>
          {walletLoading ? (
            <div className="h-8 bg-slate-800 rounded-lg animate-pulse" />
          ) : (
            <>
              <p className={`text-2xl font-bold tracking-tight ${(wallet?.profitLoss || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {(wallet?.profitLoss || 0) >= 0 ? '+' : ''}{(wallet?.profitLossPercent || 0).toFixed(2)}%
              </p>
              <p className={`text-xs mt-1 font-medium ${(wallet?.profitLoss || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {(wallet?.profitLoss || 0) >= 0 ? '+' : ''}{(wallet?.profitLoss || 0).toLocaleString()} FCFA
              </p>
            </>
          )}
        </div>
      </div>

      {/* Price Chart & Stock */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Prix de l'Or (FCFA/g)</h2>
            <div className="flex gap-1 bg-slate-800/60 rounded-xl p-1">
              {periodOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setChartPeriod(opt.value as typeof chartPeriod)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                    chartPeriod === opt.value
                      ? 'bg-gradient-to-r from-gold-500 to-gold-600 text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {historyLoading ? (
            <div className="h-[300px] flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : chartData.length > 0 ? (
            <PriceChart
              data={chartData}
              height={300}
              chartType="area"
              priceFormat={{ precision: 0, minMove: 1 }}
            />
          ) : (
            <div className="h-[300px] flex items-center justify-center text-slate-500 text-sm">
              Aucune donnée disponible
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider mb-5">Stock National</h2>
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-slate-800/40">
              <p className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Or alloué</p>
              <p className="text-xl font-bold text-gold-500 mt-1">
                {(stock?.totalAllocated || 0).toLocaleString()} g
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/40">
              <p className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Tokens émis</p>
              <p className="text-lg font-bold mt-1">
                {(stock?.tokensIssued || 0).toLocaleString()} g
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/40">
              <p className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Couverture</p>
              <p className={`text-lg font-bold mt-1 ${
                (stock?.coverage || 0) >= 1 ? 'text-emerald-400' : 'text-red-400'
              }`}>
                {((stock?.coverage || 1) * 100).toFixed(0)}%
              </p>
            </div>
            <div className="pt-3 border-t border-slate-800/60">
              <p className="text-[11px] text-slate-600">
                Dernier audit: {stock?.lastAuditDate
                  ? new Date(stock.lastAuditDate).toLocaleDateString('fr-FR')
                  : 'N/A'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions & KYC Level */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">Actions rapides</h2>
          <div className="flex gap-3">
            <a href="/marketplace?action=buy" className="btn-primary flex-1 text-center">
              Acheter de l'or
            </a>
            <a href="/marketplace?action=sell" className="btn-outline flex-1 text-center">
              Vendre
            </a>
          </div>
          <div className="flex gap-3 mt-3">
            <a href="/wallet" className="btn-secondary flex-1 text-center text-xs">
              📥 Déposer
            </a>
            <a href="/wallet" className="btn-secondary flex-1 text-center text-xs">
              📤 Retirer
            </a>
          </div>
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">Niveau KYC</h2>
          <div className="flex items-center justify-between">
            <div>
              <span className={`badge ${
                user?.kycLevel === 'VERIFIED' ? 'badge-success' :
                user?.kycLevel === 'STANDARD' ? 'badge-info' : 'badge-warning'
              }`}>
                {user?.kycLevel || 'BASIC'}
              </span>
              <p className="text-xs text-slate-500 mt-2">
                {user?.kycLevel === 'VERIFIED'
                  ? 'Accès complet à la plateforme'
                  : user?.kycLevel === 'STANDARD'
                  ? 'Limite: 500g/mois'
                  : 'Consultation uniquement'}
              </p>
            </div>
            {user?.kycLevel !== 'VERIFIED' && (
              <a href="/kyc" className="btn-secondary text-xs">
                Améliorer →
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="card">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Transactions récentes</h2>
          <a href="/transactions" className="text-xs text-gold-500 hover:text-gold-400 font-medium transition-colors">
            Voir tout →
          </a>
        </div>

        {txLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-slate-800/40 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-14 h-14 rounded-2xl bg-slate-800/60 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">📋</span>
            </div>
            <p className="text-slate-500 text-sm">Aucune transaction récente</p>
            <a href="/marketplace" className="btn-primary mt-4 inline-block text-sm">
              Commencer à investir
            </a>
          </div>
        ) : (
          <div className="space-y-2">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between p-3 bg-slate-800/40 rounded-xl hover:bg-slate-800/60 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${
                      tx.type === 'BUY' || tx.type === 'DEPOSIT'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-red-500/15 text-red-400'
                    }`}
                  >
                    {tx.type === 'BUY' || tx.type === 'DEPOSIT' ? '↓' : '↑'}
                  </div>
                  <div>
                    <p className="font-medium text-sm text-white">{typeLabels[tx.type] || tx.type}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {new Date(tx.createdAt).toLocaleDateString('fr-FR', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`font-semibold text-sm ${
                    tx.type === 'BUY' || tx.type === 'DEPOSIT' ? 'text-emerald-400' : 'text-white'
                  }`}>
                    {tx.tokenAmount
                      ? `${tx.type === 'SELL' ? '-' : '+'}${tx.tokenAmount.toFixed(3)} g`
                      : `${tx.type === 'WITHDRAWAL' ? '-' : '+'}${tx.cashAmount.toLocaleString()} FCFA`}
                  </p>
                  <span className={`${statusLabels[tx.status]?.badge || 'badge-warning'} text-[10px] mt-1 inline-block`}>
                    {statusLabels[tx.status]?.label || tx.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info Box */}
      <div className="card !p-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-500/15 flex items-center justify-center flex-shrink-0">
            <span className="text-base">ℹ️</span>
          </div>
          <div>
            <p className="font-semibold text-sm text-white">A propos de TNC Trading</p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Chaque token représente 1 gramme d'or physique stocké par l'État du Burkina Faso.
              La couverture est vérifiée régulièrement pour garantir la sécurité de vos investissements.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
