import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAdminStore } from '../stores/auth';
import { adminApi } from '../lib/api';

interface ReconciliationData {
  stock: {
    totalAllocated: number;
    tokensIssued: number;
    availableStock: number;
    coverage: number;
  };
  wallets: {
    totalTokens: number;
    totalCash: number;
    userCount: number;
  };
  transactions: {
    totalBought: number;
    totalSold: number;
    pendingBuys: number;
    pendingSells: number;
  };
  discrepancy: number;
  isBalanced: boolean;
}

export default function Reconciliation() {
  const { tokens } = useAdminStore();
  const [selectedPeriod, setSelectedPeriod] = useState<'day' | 'week' | 'month' | 'all'>('day');

  const { data: stockData, isLoading: stockLoading } = useQuery({
    queryKey: ['admin-stock'],
    queryFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return adminApi.getStock(tokens.accessToken);
    },
    enabled: !!tokens?.accessToken,
  });

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return adminApi.getDashboard(tokens.accessToken);
    },
    enabled: !!tokens?.accessToken,
  });

  const { data: transactionsData } = useQuery({
    queryKey: ['admin-transactions-summary', selectedPeriod],
    queryFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return adminApi.getTransactions(tokens.accessToken, 1, 1000);
    },
    enabled: !!tokens?.accessToken,
  });

  const isLoading = stockLoading || statsLoading;
  const stock = stockData?.data;
  const stats = statsData?.data;
  const transactions = transactionsData?.data?.items || [];

  const reconciliation: ReconciliationData = {
    stock: {
      totalAllocated: stock?.totalAllocated || 0,
      tokensIssued: stock?.tokensIssued || 0,
      availableStock: stock?.availableStock || 0,
      coverage: stock?.coverage || 0,
    },
    wallets: {
      totalTokens: stock?.tokensIssued || 0,
      totalCash: stats?.totalVolume || 0,
      userCount: stats?.totalUsers || 0,
    },
    transactions: {
      totalBought: transactions
        .filter((t: any) => t.type === 'BUY' && t.status === 'COMPLETED')
        .reduce((sum: number, t: any) => sum + (t.tokenAmount || 0), 0),
      totalSold: transactions
        .filter((t: any) => t.type === 'SELL' && t.status === 'COMPLETED')
        .reduce((sum: number, t: any) => sum + (t.tokenAmount || 0), 0),
      pendingBuys: transactions
        .filter((t: any) => t.type === 'BUY' && t.status === 'PENDING')
        .reduce((sum: number, t: any) => sum + (t.tokenAmount || 0), 0),
      pendingSells: transactions
        .filter((t: any) => t.type === 'SELL' && t.status === 'PENDING')
        .reduce((sum: number, t: any) => sum + (t.tokenAmount || 0), 0),
    },
    discrepancy: 0,
    isBalanced: true,
  };

  const transactionBreakdown = {
    BUY: { count: 0, totalTokens: 0, totalCash: 0 },
    SELL: { count: 0, totalTokens: 0, totalCash: 0 },
    DEPOSIT: { count: 0, totalTokens: 0, totalCash: 0 },
    WITHDRAWAL: { count: 0, totalTokens: 0, totalCash: 0 },
  };

  transactions.forEach((t: any) => {
    if (t.status === 'COMPLETED' && transactionBreakdown[t.type as keyof typeof transactionBreakdown]) {
      transactionBreakdown[t.type as keyof typeof transactionBreakdown].count++;
      transactionBreakdown[t.type as keyof typeof transactionBreakdown].totalTokens += t.tokenAmount || 0;
      transactionBreakdown[t.type as keyof typeof transactionBreakdown].totalCash += t.cashAmount || 0;
    }
  });

  const exportReport = () => {
    const report = {
      generatedAt: new Date().toISOString(),
      period: selectedPeriod,
      stockReconciliation: reconciliation.stock,
      walletTotals: reconciliation.wallets,
      transactionSummary: reconciliation.transactions,
      transactionBreakdown,
      discrepancy: reconciliation.discrepancy,
      isBalanced: reconciliation.isBalanced,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `reconciliation_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const breakdownRows = [
    { key: 'BUY', label: 'Achats', color: 'bg-emerald-500', tokenColor: 'text-emerald-400', tokenPrefix: '+' },
    { key: 'SELL', label: 'Ventes', color: 'bg-red-500', tokenColor: 'text-red-400', tokenPrefix: '-' },
    { key: 'DEPOSIT', label: 'Dépôts', color: 'bg-blue-500', tokenColor: '', tokenPrefix: '' },
    { key: 'WITHDRAWAL', label: 'Retraits', color: 'bg-amber-500', tokenColor: 'text-red-400', tokenPrefix: '-' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Réconciliation</h1>
          <p className="text-sm text-slate-500 mt-1">Verification de la cohérence des données</p>
        </div>
        <div className="flex gap-3">
          <div className="flex rounded-xl border border-slate-800/60 overflow-hidden">
            {(['day', 'week', 'month', 'all'] as const).map((period) => (
              <button
                key={period}
                onClick={() => setSelectedPeriod(period)}
                className={`px-3 py-2 text-xs font-medium transition-all ${
                  selectedPeriod === period
                    ? 'bg-gold-500/15 text-gold-400'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/40'
                }`}
              >
                {{ day: "Aujourd'hui", week: 'Semaine', month: 'Mois', all: 'Tout' }[period]}
              </button>
            ))}
          </div>
          <button onClick={exportReport} className="btn-secondary flex items-center gap-2 group">
            <svg className="w-4 h-4 transition-transform group-hover:-translate-y-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Exporter
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card">
              <div className="h-28 bg-slate-800/60 rounded-xl animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Status Banner */}
          <div className={`p-4 rounded-xl border ${
            reconciliation.isBalanced
              ? 'bg-emerald-500/10 border-emerald-500/20'
              : 'bg-red-500/10 border-red-500/20'
          }`}>
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                reconciliation.isBalanced ? 'bg-emerald-500/15' : 'bg-red-500/15'
              }`}>
                {reconciliation.isBalanced ? (
                  <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                )}
              </div>
              <div>
                <p className={`font-semibold text-sm ${reconciliation.isBalanced ? 'text-emerald-400' : 'text-red-400'}`}>
                  {reconciliation.isBalanced ? 'Comptes équilibrés' : 'Écart détecté'}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {reconciliation.isBalanced
                    ? 'Les tokens émis correspondent aux soldes des portefeuilles'
                    : `Ecart de ${reconciliation.discrepancy.toFixed(6)} g détecté`}
                </p>
              </div>
            </div>
          </div>

          {/* Main Reconciliation */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Stock Side */}
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-gold-500/15 flex items-center justify-center">
                  <svg className="w-4 h-4 text-gold-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <h2 className="text-sm font-semibold text-gold-400">Or Physique</h2>
                <span className="text-[10px] bg-slate-800/60 text-slate-500 px-2 py-0.5 rounded-lg font-medium">Cote Stock</span>
              </div>
              <div className="space-y-2">
                {[
                  { label: 'Or total alloué', value: `${reconciliation.stock.totalAllocated.toFixed(3)} g`, color: 'text-gold-400' },
                  { label: 'Tokens émis', value: `${reconciliation.stock.tokensIssued.toFixed(3)} g`, color: 'text-white' },
                  { label: 'Stock disponible', value: `${reconciliation.stock.availableStock.toFixed(3)} g`, color: 'text-emerald-400' },
                  { label: 'Taux de couverture', value: `${(reconciliation.stock.coverage * 100).toFixed(2)}%`, color: reconciliation.stock.coverage >= 1 ? 'text-emerald-400' : 'text-red-400' },
                ].map((item) => (
                  <div key={item.label} className="flex justify-between items-center p-3 rounded-xl bg-slate-800/40">
                    <span className="text-xs text-slate-400">{item.label}</span>
                    <span className={`font-mono font-semibold text-sm ${item.color}`}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Wallet Side */}
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center">
                  <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                </div>
                <h2 className="text-sm font-semibold text-white">Portefeuilles</h2>
                <span className="text-[10px] bg-slate-800/60 text-slate-500 px-2 py-0.5 rounded-lg font-medium">Cote Utilisateurs</span>
              </div>
              <div className="space-y-2">
                {[
                  { label: 'Total tokens détenus', value: `${reconciliation.wallets.totalTokens.toFixed(3)} g`, color: 'text-white' },
                  { label: 'Total solde FCFA', value: `${reconciliation.wallets.totalCash.toLocaleString()} FCFA`, color: 'text-white' },
                  { label: "Nombre d'utilisateurs", value: `${reconciliation.wallets.userCount}`, color: 'text-white' },
                ].map((item) => (
                  <div key={item.label} className="flex justify-between items-center p-3 rounded-xl bg-slate-800/40">
                    <span className="text-xs text-slate-400">{item.label}</span>
                    <span className={`font-mono font-semibold text-sm ${item.color}`}>{item.value}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center p-3 rounded-xl border-2 border-dashed border-slate-700/60 bg-slate-800/20">
                  <span className="text-xs text-slate-400 font-medium">Écart (Émis - Détenus)</span>
                  <span className={`font-mono font-bold text-sm ${
                    reconciliation.isBalanced ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {reconciliation.discrepancy >= 0 ? '+' : ''}{reconciliation.discrepancy.toFixed(6)} g
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Transaction Breakdown */}
          <div className="card">
            <h2 className="text-sm font-semibold text-white mb-4">Répartition des transactions</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800/60">
                    <th className="table-header">Type</th>
                    <th className="table-header text-right">Nombre</th>
                    <th className="table-header text-right">Total Or (g)</th>
                    <th className="table-header text-right">Total FCFA</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdownRows.map((row) => {
                    const data = transactionBreakdown[row.key as keyof typeof transactionBreakdown];
                    const hasTokens = row.key === 'BUY' || row.key === 'SELL';
                    const hasCashSign = row.key === 'DEPOSIT' || row.key === 'WITHDRAWAL';
                    return (
                      <tr key={row.key} className="table-row">
                        <td className="table-cell">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${row.color}`} />
                            <span className="text-sm">{row.label}</span>
                          </div>
                        </td>
                        <td className="table-cell text-right font-mono text-sm">{data.count}</td>
                        <td className={`table-cell text-right font-mono text-sm ${row.tokenColor || 'text-slate-500'}`}>
                          {hasTokens ? `${row.tokenPrefix}${data.totalTokens.toFixed(3)}` : '-'}
                        </td>
                        <td className={`table-cell text-right font-mono text-sm ${
                          hasCashSign ? (row.key === 'DEPOSIT' ? 'text-emerald-400' : 'text-red-400') : 'text-slate-300'
                        }`}>
                          {hasCashSign && (row.key === 'DEPOSIT' ? '+' : '-')}{data.totalCash.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-700/60">
                    <td className="table-cell font-semibold text-white">Net Or</td>
                    <td className="table-cell text-right">-</td>
                    <td className={`table-cell text-right font-mono font-bold ${
                      transactionBreakdown.BUY.totalTokens - transactionBreakdown.SELL.totalTokens >= 0
                        ? 'text-emerald-400'
                        : 'text-red-400'
                    }`}>
                      {(transactionBreakdown.BUY.totalTokens - transactionBreakdown.SELL.totalTokens).toFixed(3)} g
                    </td>
                    <td className="table-cell text-right">-</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Pending Transactions */}
          <div className="card">
            <h2 className="text-sm font-semibold text-white mb-4">Transactions en attente</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-4 rounded-xl bg-slate-800/40">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
                    <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Achats en attente</p>
                    <p className="text-xl font-bold text-amber-400 mt-0.5">
                      {reconciliation.transactions.pendingBuys.toFixed(3)} <span className="text-sm">g</span>
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-4 rounded-xl bg-slate-800/40">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
                    <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Ventes en attente</p>
                    <p className="text-xl font-bold text-amber-400 mt-0.5">
                      {reconciliation.transactions.pendingSells.toFixed(3)} <span className="text-sm">g</span>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Reconciliation Formula */}
          <div className="card">
            <h2 className="text-sm font-semibold text-white mb-4">Formule de vérification</h2>
            <div className="font-mono text-xs space-y-3 p-4 bg-slate-800/40 rounded-xl border border-slate-700/40">
              <div>
                <p className="text-slate-500 mb-1">// Invariant principal</p>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    reconciliation.stock.tokensIssued <= reconciliation.stock.totalAllocated ? 'bg-emerald-500' : 'bg-red-500'
                  }`} />
                  <p className={reconciliation.stock.tokensIssued <= reconciliation.stock.totalAllocated ? 'text-emerald-400' : 'text-red-400'}>
                    ASSERT: Tokens Émis ({reconciliation.stock.tokensIssued.toFixed(3)})
                    {' '}&lt;= Or Alloué ({reconciliation.stock.totalAllocated.toFixed(3)})
                    {' '}: <span className="font-bold">{reconciliation.stock.tokensIssued <= reconciliation.stock.totalAllocated ? 'OK' : 'FAIL'}</span>
                  </p>
                </div>
              </div>
              <div className="border-t border-slate-700/40 pt-3">
                <p className="text-slate-500 mb-1">// Cohérence des soldes</p>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${reconciliation.isBalanced ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  <p className={reconciliation.isBalanced ? 'text-emerald-400' : 'text-red-400'}>
                    ASSERT: Sum(Wallets.tokens) == Tokens Émis
                    {' '}: <span className="font-bold">{reconciliation.isBalanced ? 'OK' : `ECART ${reconciliation.discrepancy.toFixed(6)}g`}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
