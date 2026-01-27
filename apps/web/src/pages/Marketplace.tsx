import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import PriceChart, { PriceDataPoint } from '../components/PriceChart';
import { UTCTimestamp } from 'lightweight-charts';
import { Button } from '../components/ui/Button';
import { formatCurrency, formatGrams } from '../lib/formatters';

// Hook for countdown timer
function useCountdown(expiresAt: string | null) {
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    if (!expiresAt) {
      setTimeLeft(0);
      return;
    }

    const calculateTimeLeft = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      return Math.max(0, Math.round(diff / 1000));
    };

    setTimeLeft(calculateTimeLeft());

    const interval = setInterval(() => {
      const remaining = calculateTimeLeft();
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  return timeLeft;
}

type TabType = 'buy' | 'sell';
type ViewState = 'form' | 'confirm' | 'success';

interface Quote {
  quoteId: string;
  type: 'BUY' | 'SELL';
  tokenAmount: number;
  cashAmount: number;
  pricePerGram: number;
  fees: number;
  total: number;
  expiresAt: string;
}

export default function Marketplace() {
  const queryClient = useQueryClient();
  const { tokens, user } = useAuthStore();
  const [tab, setTab] = useState<TabType>('buy');
  const [amount, setAmount] = useState('');
  const [amountType, setAmountType] = useState<'grams' | 'xof'>('grams');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [viewState, setViewState] = useState<ViewState>('form');
  const [transactionResult, setTransactionResult] = useState<{
    transactionId: string;
    tokenAmount: number;
    cashAmount: number;
  } | null>(null);
  const [error, setError] = useState('');

  const [chartPeriod, setChartPeriod] = useState<'24h' | '7d' | '30d'>('24h');

  const { data: priceData, isLoading: priceLoading } = useQuery({
    queryKey: ['price'],
    queryFn: () => api.getPrice(),
    refetchInterval: 60000,
  });

  const { data: priceHistoryData } = useQuery({
    queryKey: ['price-history', chartPeriod],
    queryFn: () => api.getPriceHistory(chartPeriod),
  });

  const { data: stockData } = useQuery({
    queryKey: ['stock'],
    queryFn: () => api.getStock(),
  });

  const { data: walletData } = useQuery({
    queryKey: ['wallet'],
    queryFn: () => api.getWallet(tokens?.accessToken || ''),
    enabled: !!tokens?.accessToken,
  });

  const price = priceData?.data;
  const priceHistory = priceHistoryData?.data?.items || [];
  const stock = stockData?.data;
  const wallet = walletData?.data;

  // Transform price history for chart
  const chartData = useMemo<PriceDataPoint[]>(() => {
    return priceHistory.map((item) => ({
      time: Math.floor(new Date(item.timestamp).getTime() / 1000) as UTCTimestamp,
      value: item.priceXof,
    }));
  }, [priceHistory]);

  // Quote mutation
  const quoteMutation = useMutation({
    mutationFn: async () => {
      if (!tokens?.accessToken) throw new Error('Vous devez être connecté');
      const numAmount = parseFloat(amount);
      if (!numAmount || numAmount <= 0) throw new Error('Montant invalide');

      return api.getQuote(
        tab === 'buy' ? 'BUY' : 'SELL',
        numAmount,
        amountType,
        tokens.accessToken
      );
    },
    onSuccess: (data) => {
      setQuote(data.data);
      setViewState('confirm');
      setError('');
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Buy mutation
  const buyMutation = useMutation({
    mutationFn: async () => {
      if (!tokens?.accessToken || !quote) throw new Error('Erreur de session');
      return api.executeBuy(quote.quoteId, 'wallet_balance', tokens.accessToken);
    },
    onSuccess: (data) => {
      setTransactionResult({
        transactionId: data.data.transactionId,
        tokenAmount: data.data.tokenAmount,
        cashAmount: data.data.cashAmount,
      });
      setViewState('success');
      setQuote(null);
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (err: Error) => {
      setError(err.message);
      setViewState('form');
    },
  });

  // Sell mutation
  const sellMutation = useMutation({
    mutationFn: async () => {
      if (!tokens?.accessToken || !quote) throw new Error('Erreur de session');
      return api.executeSell(quote.quoteId, 'wallet_balance', tokens.accessToken);
    },
    onSuccess: (data) => {
      setTransactionResult({
        transactionId: data.data.transactionId,
        tokenAmount: data.data.tokenAmount,
        cashAmount: data.data.cashAmount,
      });
      setViewState('success');
      setQuote(null);
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (err: Error) => {
      setError(err.message);
      setViewState('form');
    },
  });

  const calculateTotal = () => {
    const numAmount = parseFloat(amount) || 0;
    if (amountType === 'grams') {
      return tab === 'buy'
        ? numAmount * (price?.buyPrice || 0)
        : numAmount * (price?.sellPrice || 0);
    } else {
      return tab === 'buy'
        ? numAmount / (price?.buyPrice || 1)
        : numAmount / (price?.sellPrice || 1);
    }
  };

  const handleTransaction = () => {
    setError('');

    // Validation
    if (!tokens?.accessToken) {
      setError('Vous devez être connecté pour effectuer des transactions');
      return;
    }

    if (user?.kycLevel === 'BASIC') {
      setError('Vous devez compléter votre vérification KYC pour trader');
      return;
    }

    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      setError('Veuillez entrer un montant valide');
      return;
    }

    // For buy: check if enough cash balance
    if (tab === 'buy') {
      const totalCost = amountType === 'grams'
        ? numAmount * (price?.buyPrice || 0)
        : numAmount;
      if (totalCost > (wallet?.cashBalance || 0)) {
        setError('Solde insuffisant. Veuillez déposer des fonds.');
        return;
      }
    }

    // For sell: check if enough gold
    if (tab === 'sell') {
      const goldToSell = amountType === 'grams'
        ? numAmount
        : numAmount / (price?.sellPrice || 1);
      if (goldToSell > (wallet?.tokenBalance || 0)) {
        setError('Vous n\'avez pas assez d\'or à vendre');
        return;
      }
    }

    // Get quote
    quoteMutation.mutate();
  };

  const confirmTransaction = () => {
    if (tab === 'buy') {
      buyMutation.mutate();
    } else {
      sellMutation.mutate();
    }
  };

  const cancelConfirmation = () => {
    setViewState('form');
    setQuote(null);
  };

  const resetAndClose = () => {
    setViewState('form');
    setAmount('');
    setTransactionResult(null);
    setError('');
  };

  const isLoading = quoteMutation.isPending || buyMutation.isPending || sellMutation.isPending;

  // Countdown for quote expiration
  const quoteTimeLeft = useCountdown(quote?.expiresAt || null);
  const isQuoteExpired = viewState === 'confirm' && quoteTimeLeft === 0;

  // Auto-cancel when quote expires
  useEffect(() => {
    if (isQuoteExpired && viewState === 'confirm') {
      setError('Le devis a expiré. Veuillez réessayer.');
      cancelConfirmation();
    }
  }, [isQuoteExpired, viewState]);

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Marketplace</h1>
        <p className="text-sm text-slate-500 mt-1">Achetez et vendez de l'or tokenisé</p>
      </div>

      {/* Wallet Summary */}
      {wallet && (
        <div className="grid grid-cols-2 gap-4">
          <div className="card p-4">
            <p className="stat-label">Solde Or</p>
            <p className="text-xl font-bold text-gold-500 mt-1">{wallet.tokenBalance.toFixed(3)} <span className="text-sm">g</span></p>
          </div>
          <div className="card p-4">
            <p className="stat-label">Solde FCFA</p>
            <p className="text-xl font-bold mt-1">{wallet.cashBalance.toLocaleString()} <span className="text-sm text-slate-400">FCFA</span></p>
          </div>
        </div>
      )}

      {/* Price Chart Card */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="stat-label">Prix de l'Or</p>
            {priceLoading ? (
              <div className="h-8 w-32 bg-slate-700 rounded animate-pulse mt-1"></div>
            ) : (
              <div className="flex items-baseline gap-3">
                <p className="text-3xl font-bold text-gold-500">
                  {(price?.priceXof || 0).toLocaleString()}
                </p>
                <span className="text-slate-400">FCFA/g</span>
                <span className={`text-sm font-medium px-2 py-0.5 rounded ${
                  (price?.change24h || 0) >= 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                }`}>
                  {(price?.change24h || 0) >= 0 ? '+' : ''}{(price?.change24h || 0).toFixed(2)}%
                </span>
              </div>
            )}
          </div>
          <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
            {[
              { value: '24h', label: '24h' },
              { value: '7d', label: '7j' },
              { value: '30d', label: '30j' },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setChartPeriod(opt.value as typeof chartPeriod)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  chartPeriod === opt.value
                    ? 'bg-gold-500 text-slate-900 font-medium'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Price Chart */}
        {chartData.length > 0 ? (
          <PriceChart
            data={chartData}
            height={200}
            chartType="area"
            priceFormat={{ precision: 0, minMove: 1 }}
          />
        ) : (
          <div className="h-[200px] flex items-center justify-center text-slate-500">
            <div className="w-6 h-6 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Price info footer */}
        <div className="mt-4 pt-4 border-t border-slate-800/60 grid grid-cols-3 gap-4 text-center">
          <div className="p-2.5 rounded-xl bg-slate-800/40">
            <p className="stat-label">Achat</p>
            <p className="font-semibold text-emerald-400 mt-0.5">{(price?.buyPrice || 0).toLocaleString()} FCFA</p>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-800/40">
            <p className="stat-label">Vente</p>
            <p className="font-semibold text-red-400 mt-0.5">{(price?.sellPrice || 0).toLocaleString()} FCFA</p>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-800/40">
            <p className="stat-label">Stock</p>
            <p className="font-semibold mt-0.5">{stock?.availableStock?.toFixed(1) || '—'} g</p>
          </div>
        </div>
      </div>

      {/* Buy/Sell Card */}
      <div className="card">
        {/* Success View */}
        {viewState === 'success' && transactionResult && (
          <div className="text-center py-8">
            {/* Animated success icon */}
            <div className="relative w-20 h-20 mx-auto mb-6">
              <div className="absolute inset-0 bg-green-500/20 rounded-full animate-ping" />
              <div className="relative w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center">
                <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>

            <h2 className="text-2xl font-bold mb-2 text-green-400">Transaction réussie!</h2>
            <p className="text-slate-400 mb-8">
              {tab === 'buy'
                ? `Vous avez acheté ${formatGrams(transactionResult.tokenAmount)} d'or`
                : `Vous avez vendu ${formatGrams(transactionResult.tokenAmount)} d'or`}
            </p>

            {/* Transaction summary card */}
            <div className="bg-gradient-to-br from-slate-800 to-slate-800/50 rounded-xl p-6 mb-8 text-left max-w-sm mx-auto border border-slate-700/50">
              <div className="text-center mb-4 pb-4 border-b border-slate-700/50">
                <p className="text-sm text-slate-400 mb-1">Montant de la transaction</p>
                <p className="text-3xl font-bold text-gold-500">{formatCurrency(transactionResult.cashAmount, 'XOF')}</p>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Or {tab === 'buy' ? 'acheté' : 'vendu'}</span>
                  <span className="font-semibold text-white">{formatGrams(transactionResult.tokenAmount)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Transaction ID</span>
                  <span className="font-mono text-xs bg-slate-700/50 px-2 py-1 rounded">
                    {transactionResult.transactionId.slice(0, 12)}...
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Statut</span>
                  <span className="flex items-center gap-1 text-green-400">
                    <span className="w-2 h-2 bg-green-400 rounded-full" />
                    Confirmé
                  </span>
                </div>
              </div>
            </div>

            <div className="flex gap-3 justify-center">
              <Button
                variant="secondary"
                onClick={() => window.location.href = '/wallet'}
                className="min-w-[140px]"
              >
                Voir mon wallet
              </Button>
              <Button
                variant="primary"
                onClick={resetAndClose}
                className="min-w-[140px]"
              >
                Nouvelle transaction
              </Button>
            </div>
          </div>
        )}

        {/* Confirmation View */}
        {viewState === 'confirm' && quote && (
          <div className="py-4">
            {/* Header with icon */}
            <div className="text-center mb-6">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
                tab === 'buy' ? 'bg-green-500/20' : 'bg-red-500/20'
              }`}>
                {tab === 'buy' ? (
                  <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12m6-6H6" />
                  </svg>
                ) : (
                  <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                  </svg>
                )}
              </div>
              <h2 className="text-xl font-semibold">
                Confirmer {tab === 'buy' ? "l'achat" : 'la vente'}
              </h2>
              <p className="text-slate-400 text-sm mt-1">
                Vérifiez les détails avant de confirmer
              </p>
            </div>

            {/* Main amount highlight */}
            <div className={`text-center py-6 rounded-xl mb-6 ${
              tab === 'buy' ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'
            }`}>
              <p className="text-sm text-slate-400 mb-1">
                {tab === 'buy' ? "Vous achetez" : "Vous vendez"}
              </p>
              <p className={`text-4xl font-bold ${tab === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                {formatGrams(quote.tokenAmount)}
              </p>
              <p className="text-slate-400 text-sm mt-1">d'or tokenisé</p>
            </div>

            {/* Details */}
            <div className="bg-slate-800/50 rounded-xl p-4 space-y-3 mb-6">
              <div className="flex justify-between py-2 border-b border-slate-700/50">
                <span className="text-slate-400">Prix unitaire</span>
                <span className="font-medium">{formatCurrency(quote.pricePerGram, 'XOF')}/g</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-700/50">
                <span className="text-slate-400">Sous-total</span>
                <span className="font-medium">{formatCurrency(quote.cashAmount, 'XOF')}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-700/50">
                <span className="text-slate-400">Frais (2%)</span>
                <span className="font-medium">{formatCurrency(quote.fees, 'XOF')}</span>
              </div>
              <div className="flex justify-between pt-2">
                <span className="font-semibold text-lg">Total</span>
                <span className="font-bold text-gold-500 text-xl">{formatCurrency(quote.total, 'XOF')}</span>
              </div>
            </div>

            {/* Countdown timer */}
            <div className={`flex items-center justify-center gap-2 mb-6 py-3 rounded-lg ${
              quoteTimeLeft <= 10 ? 'bg-red-500/10 text-red-400' : 'bg-slate-800/50 text-slate-400'
            }`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm font-medium">
                Ce devis expire dans <span className={`font-bold ${quoteTimeLeft <= 10 ? 'text-red-400' : 'text-white'}`}>{quoteTimeLeft}s</span>
              </span>
              {/* Progress bar */}
              <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden ml-2">
                <div
                  className={`h-full transition-all duration-1000 rounded-full ${
                    quoteTimeLeft <= 10 ? 'bg-red-500' : 'bg-gold-500'
                  }`}
                  style={{ width: `${(quoteTimeLeft / 60) * 100}%` }}
                />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm mb-4 flex items-center gap-2">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={cancelConfirmation}
                disabled={isLoading}
              >
                Annuler
              </Button>
              <Button
                variant={tab === 'buy' ? 'primary' : 'danger'}
                className="flex-1"
                onClick={confirmTransaction}
                isLoading={isLoading}
                loadingText="Traitement..."
                disabled={isQuoteExpired}
              >
                {tab === 'buy' ? 'Confirmer l\'achat' : 'Confirmer la vente'}
              </Button>
            </div>
          </div>
        )}

        {/* Form View */}
        {viewState === 'form' && (
          <>
            <div className="flex border-b border-slate-700 mb-6">
              <button
                onClick={() => { setTab('buy'); setError(''); }}
                className={`flex-1 py-3 text-center font-medium transition-colors ${
                  tab === 'buy'
                    ? 'text-green-400 border-b-2 border-green-400'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Acheter
              </button>
              <button
                onClick={() => { setTab('sell'); setError(''); }}
                className={`flex-1 py-3 text-center font-medium transition-colors ${
                  tab === 'sell'
                    ? 'text-red-400 border-b-2 border-red-400'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Vendre
              </button>
            </div>

            <div className="space-y-6">
              {/* Amount Input */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-slate-300">Montant</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAmountType('grams')}
                      className={`px-2 py-1 text-xs rounded ${amountType === 'grams' ? 'bg-gold-500 text-slate-900' : 'bg-slate-700'}`}
                    >
                      Grammes
                    </button>
                    <button
                      onClick={() => setAmountType('xof')}
                      className={`px-2 py-1 text-xs rounded ${amountType === 'xof' ? 'bg-gold-500 text-slate-900' : 'bg-slate-700'}`}
                    >
                      FCFA
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    className="input pr-16"
                    placeholder="0.000"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); setError(''); }}
                    step="0.001"
                    min="0"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">
                    {amountType === 'grams' ? 'g' : 'FCFA'}
                  </span>
                </div>
                {/* Quick amounts */}
                {amountType === 'grams' && (
                  <div className="flex gap-2 mt-2">
                    {[0.1, 0.5, 1, 5, 10].map((val) => (
                      <button
                        key={val}
                        onClick={() => setAmount(val.toString())}
                        className="px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded"
                      >
                        {val}g
                      </button>
                    ))}
                  </div>
                )}
                {amountType === 'xof' && (
                  <div className="flex gap-2 mt-2">
                    {[10000, 25000, 50000, 100000].map((val) => (
                      <button
                        key={val}
                        onClick={() => setAmount(val.toString())}
                        className="px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded"
                      >
                        {(val / 1000)}K
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Price Summary */}
              <div className="bg-slate-900/50 rounded-lg p-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Prix unitaire</span>
                  <span>{tab === 'buy' ? price?.buyPrice?.toLocaleString() : price?.sellPrice?.toLocaleString()} FCFA/g</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Spread</span>
                  <span>{((tab === 'buy' ? price?.spreadBuy : price?.spreadSell) || 0.02) * 100}%</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">{amountType === 'grams' ? 'Vous payez/recevez' : 'Or équivalent'}</span>
                  <span className="font-medium">
                    {amountType === 'grams'
                      ? `${calculateTotal().toLocaleString()} FCFA`
                      : `${calculateTotal().toFixed(3)} g`}
                  </span>
                </div>
                <div className="pt-3 border-t border-slate-700 flex justify-between">
                  <span className="font-medium">Total</span>
                  <span className="font-bold text-gold-500">
                    {amountType === 'grams'
                      ? `${calculateTotal().toLocaleString()} FCFA`
                      : `${parseFloat(amount || '0').toLocaleString()} FCFA`}
                  </span>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                  {error}
                </div>
              )}

              {/* KYC Warning */}
              {user?.kycLevel === 'BASIC' && (
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-400 text-sm">
                  Vous devez compléter votre vérification KYC pour acheter ou vendre de l'or.
                  <a href="/kyc" className="underline ml-1">Vérifier maintenant</a>
                </div>
              )}

              {/* Action Button */}
              <button
                className={`w-full py-4 rounded-lg font-semibold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                  tab === 'buy'
                    ? 'bg-green-600 hover:bg-green-500 text-white'
                    : 'bg-red-600 hover:bg-red-500 text-white'
                }`}
                onClick={handleTransaction}
                disabled={!amount || parseFloat(amount) <= 0 || isLoading || user?.kycLevel === 'BASIC'}
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Traitement...
                  </span>
                ) : (
                  tab === 'buy' ? 'Acheter de l\'or' : 'Vendre mon or'
                )}
              </button>

              <p className="text-xs text-slate-500 text-center">
                Le prix est valide pendant 60 secondes. Les transactions sont soumises aux limites KYC.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
