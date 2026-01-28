/**
 * Analytics Dashboard - Statistiques et analyses avancees
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../stores/auth';
import { api } from '../lib/api';
import PriceChart, { PriceDataPoint } from '../components/PriceChart';
import { StatCard, StatGrid } from '../components/ui/StatCard';
import { SkeletonChart, SkeletonStatCard } from '../components/ui/Skeleton';
import { Button } from '../components/ui/Button';
import { UTCTimestamp } from 'lightweight-charts';

type Period = '7d' | '30d' | '90d' | '1y' | 'all';

const periodOptions: { value: Period; label: string }[] = [
  { value: '7d', label: '7 jours' },
  { value: '30d', label: '30 jours' },
  { value: '90d', label: '90 jours' },
  { value: '1y', label: '1 an' },
  { value: 'all', label: 'Tout' },
];

interface TransactionStats {
  totalBuy: number;
  totalSell: number;
  totalDeposit: number;
  totalWithdrawal: number;
  buyCount: number;
  sellCount: number;
  totalGramsBought: number;
  totalGramsSold: number;
  avgBuyPrice: number;
  avgSellPrice: number;
  totalFees: number;
}

export default function Analytics() {
  const { tokens } = useAuthStore();
  const [period, setPeriod] = useState<Period>('30d');
  const [chartPeriod, setChartPeriod] = useState<'24h' | '7d' | '30d' | '1y'>('30d');

  // Fetch all transactions for analytics
  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ['transactions-all', period],
    queryFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      // Fetch up to 1000 transactions for analytics
      return api.getTransactions(tokens.accessToken, 1, 1000);
    },
    enabled: !!tokens?.accessToken,
  });

  // Fetch wallet data
  const { data: walletData, isLoading: walletLoading } = useQuery({
    queryKey: ['wallet'],
    queryFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return api.getWallet(tokens.accessToken);
    },
    enabled: !!tokens?.accessToken,
  });

  // Fetch price data
  const { data: priceData, isLoading: priceLoading } = useQuery({
    queryKey: ['price'],
    queryFn: () => api.getPrice(),
    refetchInterval: 60000,
  });

  // Fetch price history for chart
  const { data: priceHistoryData, isLoading: historyLoading } = useQuery({
    queryKey: ['price-history', chartPeriod],
    queryFn: () => api.getPriceHistory(chartPeriod),
  });

  const wallet = walletData?.data;
  const price = priceData?.data;
  const transactions = txData?.data?.items || [];
  const priceHistory = priceHistoryData?.data?.items || [];

  // Filter transactions by period
  const filteredTransactions = useMemo(() => {
    if (period === 'all') return transactions;

    const now = new Date();
    const daysMap: Record<Period, number> = {
      '7d': 7,
      '30d': 30,
      '90d': 90,
      '1y': 365,
      'all': 0,
    };
    const days = daysMap[period];
    const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    return transactions.filter((tx) => new Date(tx.createdAt) >= cutoffDate);
  }, [transactions, period]);

  // Calculate statistics
  const stats = useMemo<TransactionStats>(() => {
    return filteredTransactions.reduce(
      (acc, tx) => {
        if (tx.status !== 'COMPLETED') return acc;

        switch (tx.type) {
          case 'BUY':
            acc.totalBuy += tx.cashAmount;
            acc.buyCount += 1;
            acc.totalGramsBought += tx.tokenAmount || 0;
            if (tx.pricePerGram) {
              acc.avgBuyPrice = (acc.avgBuyPrice * (acc.buyCount - 1) + tx.pricePerGram) / acc.buyCount;
            }
            break;
          case 'SELL':
            acc.totalSell += tx.cashAmount;
            acc.sellCount += 1;
            acc.totalGramsSold += tx.tokenAmount || 0;
            if (tx.pricePerGram) {
              acc.avgSellPrice = (acc.avgSellPrice * (acc.sellCount - 1) + tx.pricePerGram) / acc.sellCount;
            }
            break;
          case 'DEPOSIT':
            acc.totalDeposit += tx.cashAmount;
            break;
          case 'WITHDRAWAL':
            acc.totalWithdrawal += tx.cashAmount;
            break;
        }
        acc.totalFees += tx.fees;
        return acc;
      },
      {
        totalBuy: 0,
        totalSell: 0,
        totalDeposit: 0,
        totalWithdrawal: 0,
        buyCount: 0,
        sellCount: 0,
        totalGramsBought: 0,
        totalGramsSold: 0,
        avgBuyPrice: 0,
        avgSellPrice: 0,
        totalFees: 0,
      }
    );
  }, [filteredTransactions]);

  // Calculate transaction volume by day for chart
  const volumeData = useMemo<PriceDataPoint[]>(() => {
    const volumeByDay: Record<string, number> = {};

    filteredTransactions.forEach((tx) => {
      if (tx.status !== 'COMPLETED') return;
      const date = new Date(tx.createdAt).toISOString().split('T')[0];
      volumeByDay[date] = (volumeByDay[date] || 0) + tx.cashAmount;
    });

    return Object.entries(volumeByDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({
        time: Math.floor(new Date(date).getTime() / 1000) as UTCTimestamp,
        value,
      }));
  }, [filteredTransactions]);

  // Price chart data
  const priceChartData = useMemo<PriceDataPoint[]>(() => {
    return priceHistory.map((item) => ({
      time: Math.floor(new Date(item.timestamp).getTime() / 1000) as UTCTimestamp,
      value: item.priceXof,
    }));
  }, [priceHistory]);

  // Calculate transaction breakdown by type
  const transactionBreakdown = useMemo(() => {
    const breakdown: Record<string, { count: number; amount: number }> = {
      BUY: { count: 0, amount: 0 },
      SELL: { count: 0, amount: 0 },
      DEPOSIT: { count: 0, amount: 0 },
      WITHDRAWAL: { count: 0, amount: 0 },
    };

    filteredTransactions.forEach((tx) => {
      if (tx.status === 'COMPLETED' && breakdown[tx.type]) {
        breakdown[tx.type].count += 1;
        breakdown[tx.type].amount += tx.cashAmount;
      }
    });

    return breakdown;
  }, [filteredTransactions]);

  // Export statistics to CSV
  const exportToCSV = () => {
    const csvData = [
      ['Statistiques de Trading - TNC Trading'],
      ['Periode', periodOptions.find(p => p.value === period)?.label || period],
      ['Date de generation', new Date().toLocaleDateString('fr-FR')],
      [''],
      ['Metriques', 'Valeur'],
      ['Total des achats', `${stats.totalBuy.toLocaleString()} FCFA`],
      ['Total des ventes', `${stats.totalSell.toLocaleString()} FCFA`],
      ['Total des depots', `${stats.totalDeposit.toLocaleString()} FCFA`],
      ['Total des retraits', `${stats.totalWithdrawal.toLocaleString()} FCFA`],
      [''],
      ['Nombre d\'achats', stats.buyCount.toString()],
      ['Nombre de ventes', stats.sellCount.toString()],
      ['Or achete total', `${stats.totalGramsBought.toFixed(3)} g`],
      ['Or vendu total', `${stats.totalGramsSold.toFixed(3)} g`],
      [''],
      ['Prix d\'achat moyen', `${stats.avgBuyPrice.toLocaleString()} FCFA/g`],
      ['Prix de vente moyen', `${stats.avgSellPrice.toLocaleString()} FCFA/g`],
      ['Total des frais', `${stats.totalFees.toLocaleString()} FCFA`],
      [''],
      ['Solde actuel en or', `${wallet?.tokenBalance?.toFixed(3) || 0} g`],
      ['Solde en FCFA', `${(wallet?.cashBalance || 0).toLocaleString()} FCFA`],
      ['Valeur estimee du portefeuille', `${((wallet?.tokenBalance || 0) * (price?.sellPrice || 0)).toLocaleString()} FCFA`],
    ];

    const csvContent = csvData.map(row => row.join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `analytics_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const isLoading = txLoading || walletLoading || priceLoading;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Analyses</h1>
          <p className="text-sm text-slate-500 mt-1">Statistiques detaillees de votre activite</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={exportToCSV}
            leftIcon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            }
          >
            Exporter
          </Button>
        </div>
      </div>

      {/* Period Selector */}
      <div className="flex rounded-xl border border-slate-800/60 overflow-hidden w-fit">
        {periodOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setPeriod(opt.value)}
            className={`px-4 py-2 text-xs font-medium transition-all ${
              period === opt.value
                ? 'bg-gold-500/15 text-gold-400'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/40'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Portfolio Summary */}
      <div className="card-gold">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p className="stat-label">Valeur totale du portefeuille</p>
            {isLoading ? (
              <div className="h-12 w-48 bg-slate-700 rounded animate-pulse mt-1" />
            ) : (
              <p className="text-4xl font-bold text-gold-500">
                {((wallet?.tokenBalance || 0) * (price?.sellPrice || 0) + (wallet?.cashBalance || 0)).toLocaleString()} FCFA
              </p>
            )}
          </div>
          <div className="flex gap-8">
            <div>
              <p className="stat-label">Or</p>
              <p className="text-2xl font-bold text-gold-500">
                {wallet?.tokenBalance?.toFixed(3) || '0.000'} g
              </p>
            </div>
            <div>
              <p className="stat-label">FCFA</p>
              <p className="text-2xl font-bold">
                {(wallet?.cashBalance || 0).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <StatGrid columns={4}>
        {isLoading ? (
          <>
            <SkeletonStatCard />
            <SkeletonStatCard />
            <SkeletonStatCard />
            <SkeletonStatCard />
          </>
        ) : (
          <>
            <StatCard
              title="Total des achats"
              value={`${stats.totalBuy.toLocaleString()} FCFA`}
              subtitle={`${stats.buyCount} operations`}
              icon="🛒"
              variant="success"
            />
            <StatCard
              title="Total des ventes"
              value={`${stats.totalSell.toLocaleString()} FCFA`}
              subtitle={`${stats.sellCount} operations`}
              icon="💰"
              variant="default"
            />
            <StatCard
              title="Or achete"
              value={`${stats.totalGramsBought.toFixed(3)} g`}
              subtitle={`Prix moyen: ${stats.avgBuyPrice > 0 ? stats.avgBuyPrice.toLocaleString() : '-'} FCFA/g`}
              icon="⬇️"
              variant="gold"
            />
            <StatCard
              title="Or vendu"
              value={`${stats.totalGramsSold.toFixed(3)} g`}
              subtitle={`Prix moyen: ${stats.avgSellPrice > 0 ? stats.avgSellPrice.toLocaleString() : '-'} FCFA/g`}
              icon="⬆️"
              variant="default"
            />
          </>
        )}
      </StatGrid>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Price Chart */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Evolution du prix de l'or</h2>
            <div className="flex gap-1 bg-slate-700 rounded p-1">
              {(['24h', '7d', '30d', '1y'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setChartPeriod(p)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    chartPeriod === p
                      ? 'bg-gold-500 text-slate-900 font-medium'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {p === '24h' ? '24h' : p === '7d' ? '7j' : p === '30d' ? '30j' : '1an'}
                </button>
              ))}
            </div>
          </div>
          {historyLoading ? (
            <SkeletonChart />
          ) : priceChartData.length > 0 ? (
            <PriceChart
              data={priceChartData}
              height={250}
              chartType="area"
              priceFormat={{ precision: 0, minMove: 1 }}
            />
          ) : (
            <div className="h-[250px] flex items-center justify-center text-slate-400">
              Aucune donnée disponible
            </div>
          )}
        </div>

        {/* Volume Chart */}
        <div className="card">
          <h2 className="text-sm font-semibold text-white mb-4">Volume des transactions</h2>
          {isLoading ? (
            <SkeletonChart />
          ) : volumeData.length > 0 ? (
            <PriceChart
              data={volumeData}
              height={250}
              chartType="histogram"
              priceFormat={{ precision: 0, minMove: 1 }}
            />
          ) : (
            <div className="h-[250px] flex items-center justify-center text-slate-400">
              Aucune transaction sur cette periode
            </div>
          )}
        </div>
      </div>

      {/* Transaction Breakdown */}
      <div className="card">
        <h2 className="text-sm font-semibold text-white mb-4">Repartition des transactions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(transactionBreakdown).map(([type, data]) => {
            const labels: Record<string, { name: string; color: string; bgColor: string }> = {
              BUY: { name: 'Achats', color: 'text-emerald-400', bgColor: 'bg-emerald-500/15' },
              SELL: { name: 'Ventes', color: 'text-blue-400', bgColor: 'bg-blue-500/15' },
              DEPOSIT: { name: 'Depots', color: 'text-purple-400', bgColor: 'bg-purple-500/15' },
              WITHDRAWAL: { name: 'Retraits', color: 'text-amber-400', bgColor: 'bg-amber-500/15' },
            };
            const label = labels[type];
            return (
              <div key={type} className="bg-slate-800/40 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2 h-2 rounded-full ${label.bgColor.replace('/15', '')}`} />
                  <span className="stat-label">{label.name}</span>
                </div>
                <p className={`text-2xl font-bold ${label.color}`}>
                  {data.count}
                </p>
                <p className="text-sm text-slate-400">
                  {data.amount.toLocaleString()} FCFA
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Additional Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Deposits vs Withdrawals */}
        <div className="card">
          <h3 className="text-sm font-semibold text-white mb-4">Flux de tresorerie</h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-400">Dépôts</span>
                <span className="text-green-400">+{stats.totalDeposit.toLocaleString()} FCFA</span>
              </div>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (stats.totalDeposit / (stats.totalDeposit + stats.totalWithdrawal || 1)) * 100)}%`,
                  }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-400">Retraits</span>
                <span className="text-red-400">-{stats.totalWithdrawal.toLocaleString()} FCFA</span>
              </div>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-500 rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (stats.totalWithdrawal / (stats.totalDeposit + stats.totalWithdrawal || 1)) * 100)}%`,
                  }}
                />
              </div>
            </div>
            <div className="pt-2 border-t border-slate-700">
              <div className="flex justify-between">
                <span className="text-slate-400">Solde net</span>
                <span className={stats.totalDeposit - stats.totalWithdrawal >= 0 ? 'text-green-400' : 'text-red-400'}>
                  {stats.totalDeposit - stats.totalWithdrawal >= 0 ? '+' : ''}
                  {(stats.totalDeposit - stats.totalWithdrawal).toLocaleString()} FCFA
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Performance */}
        <div className="card">
          <h3 className="text-sm font-semibold text-white mb-4">Performance</h3>
          {walletLoading ? (
            <div className="space-y-2">
              <div className="h-6 bg-slate-700 rounded animate-pulse" />
              <div className="h-6 bg-slate-700 rounded animate-pulse" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Prix d'achat moyen</span>
                <span className="font-medium">{wallet?.averageBuyPrice?.toLocaleString() || '-'} FCFA/g</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Prix actuel</span>
                <span className="font-medium">{price?.sellPrice?.toLocaleString() || '-'} FCFA/g</span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-slate-700">
                <span className="text-slate-400">Gain/Perte</span>
                <span className={`font-bold ${(wallet?.profitLoss || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {(wallet?.profitLoss || 0) >= 0 ? '+' : ''}{(wallet?.profitLoss || 0).toLocaleString()} FCFA
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Rendement</span>
                <span className={`font-bold ${(wallet?.profitLossPercent || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {(wallet?.profitLossPercent || 0) >= 0 ? '+' : ''}{(wallet?.profitLossPercent || 0).toFixed(2)}%
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Fees Summary */}
        <div className="card">
          <h3 className="text-sm font-semibold text-white mb-4">Resume des frais</h3>
          <div className="space-y-4">
            <div className="text-center py-4">
              <p className="text-slate-400 text-sm">Total des frais payes</p>
              <p className="text-3xl font-bold text-yellow-400">
                {stats.totalFees.toLocaleString()} FCFA
              </p>
            </div>
            <div className="pt-2 border-t border-slate-700">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Frais moyens par operation</span>
                <span>
                  {stats.buyCount + stats.sellCount > 0
                    ? Math.round(stats.totalFees / (stats.buyCount + stats.sellCount)).toLocaleString()
                    : '-'}{' '}
                  FCFA
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Info Box */}
      <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-white">A propos des analyses</p>
            <p className="text-sm text-slate-400 mt-1">
              Les statistiques sont calculées à partir de vos transactions complétées.
              Les données sont mises à jour en temps réel.
              Exportez vos données en CSV pour une analyse plus approfondie.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
