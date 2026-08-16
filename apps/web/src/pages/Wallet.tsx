import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/auth';
import { api } from '../lib/api';
import { QUICK_AMOUNTS, type PaymentMethodId } from '../lib/constants';
import { formatCurrency, formatGrams } from '../lib/formatters';
import { Button } from '../components/ui/Button';
import { TransactionList, type Transaction } from '../components/wallet/TransactionItem';
import { PaymentMethodSelector, QuickAmountSelector } from '../components/market/PaymentMethodSelector';

type ActiveSection = 'none' | 'deposit' | 'withdraw' | 'success' | 'certificate';

type TransactionResult = {
  type: 'deposit' | 'withdrawal';
  amount: number;
  transactionId: string;
  status: string;
  paymentUrl?: string;
  estimatedTime?: string;
};

export default function Wallet() {
  const { isAuthenticated, user } = useAuthStore();
  const queryClient = useQueryClient();

  // Active section state (replaces modal states)
  const [activeSection, setActiveSection] = useState<ActiveSection>('none');
  const [transactionResult, setTransactionResult] = useState<TransactionResult | null>(null);
  const [certificateData, setCertificateData] = useState<{
    certificateId: string;
    verificationCode: string;
    downloadUrl: string;
    tokenBalance: number;
    leasedBalance: number;
    totalOwnedGrams: number;
    issuedAt: string;
  } | null>(null);

  // Form states
  const [amount, setAmount] = useState<number | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodId>('orange_money');
  const [error, setError] = useState('');

  const { data: walletData, isLoading } = useQuery({
    queryKey: ['wallet'],
    queryFn: () => api.getWallet(),
    enabled: isAuthenticated,
  });

  const { data: priceData } = useQuery({
    queryKey: ['price'],
    queryFn: () => api.getPrice(),
  });

  const { data: txData } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => api.getTransactions(1, 10),
    enabled: isAuthenticated,
  });

  const depositMutation = useMutation({
    mutationFn: async () => {
      if (!amount || amount < 1000) {
        throw new Error('Montant minimum: 1,000 FCFA');
      }
      const fullPhone = paymentMethod === 'stripe' || paymentMethod === 'card'
        ? undefined
        : (phoneNumber.startsWith('+') ? phoneNumber : `+226${phoneNumber}`);
      return api.deposit(amount, paymentMethod, fullPhone || '');
    },
    onSuccess: (data) => {
      setTransactionResult({
        type: 'deposit',
        amount: amount || 0,
        transactionId: data.data.transactionId,
        status: data.data.status,
        paymentUrl: data.data.paymentUrl,
      });
      setActiveSection('success');
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: async () => {
      if (!amount || amount < 1000) {
        throw new Error('Montant minimum: 1,000 FCFA');
      }
      if (amount > (wallet?.cashBalance || 0)) {
        throw new Error('Solde insuffisant');
      }
      // Check KYC limits
      const dailyLimit = user?.kycLevel === 'VERIFIED' ? 5000000 : user?.kycLevel === 'STANDARD' ? 500000 : 0;
      if (amount > dailyLimit) {
        throw new Error(`Limite de retrait: ${dailyLimit.toLocaleString()} FCFA/jour pour votre niveau KYC`);
      }
      const fullPhone = phoneNumber.startsWith('+') ? phoneNumber : `+226${phoneNumber}`;
      return api.withdraw(amount, paymentMethod, fullPhone);
    },
    onSuccess: (data) => {
      setTransactionResult({
        type: 'withdrawal',
        amount: amount || 0,
        transactionId: data.data.withdrawalId,
        status: data.data.status,
        estimatedTime: data.data.estimatedTime,
      });
      setActiveSection('success');
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const resetForm = () => {
    setAmount(null);
    setPhoneNumber('');
    setPaymentMethod('orange_money');
    setError('');
  };

  const openDeposit = () => {
    resetForm();
    setActiveSection('deposit');
  };

  const openWithdraw = () => {
    if (user?.kycLevel === 'BASIC') {
      setError('Niveau KYC insuffisant pour les retraits. Complétez votre vérification KYC.');
      return;
    }
    resetForm();
    setActiveSection('withdraw');
  };

  const closeSection = () => {
    setActiveSection('none');
    setTransactionResult(null);
    setCertificateData(null);
    resetForm();
  };

  const certificateMutation = useMutation({
    mutationFn: () => api.generateCertificate(),
    onSuccess: (data) => {
      setCertificateData({
        certificateId: data.data.certificateId,
        verificationCode: data.data.verificationCode,
        downloadUrl: data.data.downloadUrl,
        tokenBalance: data.data.tokenBalance,
        leasedBalance: data.data.leasedBalance,
        totalOwnedGrams: data.data.totalOwnedGrams,
        issuedAt: data.data.issuedAt,
      });
      setActiveSection('certificate');
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const generateCertificate = () => {
    certificateMutation.mutate();
  };

  const downloadCertificate = async () => {
    if (certificateData?.downloadUrl) {
      const apiUrl = import.meta.env.VITE_API_URL || '';
      const fullUrl = `${apiUrl}${certificateData.downloadUrl}`;

      try {
        const link = document.createElement('a');
        link.href = fullUrl;
        link.target = '_blank';
        link.download = `certificat-or-${certificateData.certificateId.slice(0, 8)}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch {
        window.open(fullUrl, '_blank');
      }
    }
  };

  const wallet = walletData?.data;
  const price = priceData?.data;
  const transactions: Transaction[] = (txData?.data?.items || []).map((tx: Record<string, unknown>) => ({
    id: tx.id as string,
    type: tx.type as Transaction['type'],
    status: tx.status as Transaction['status'],
    tokenAmount: tx.tokenAmount as number | undefined,
    cashAmount: tx.cashAmount as number,
    pricePerGram: tx.pricePerGram as number | undefined,
    fees: tx.fees as number | undefined,
    createdAt: tx.createdAt as string,
    completedAt: tx.completedAt as string | undefined,
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Mon Portefeuille</h1>
        <p className="text-sm text-slate-500 mt-1">Gérez vos actifs et retraits</p>
      </div>

      {/* Balance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card-gold">
          <p className="stat-label">Solde Or</p>
          {isLoading ? (
            <div className="h-12 bg-slate-800/60 rounded-xl animate-pulse"></div>
          ) : (
            <>
              <p className="text-4xl font-bold text-gold-500">
                {wallet?.tokenBalance?.toFixed(3) || '0.000'} g
              </p>
              <p className="text-slate-400 mt-2">
                Valeur: {((wallet?.tokenBalance || 0) * (price?.sellPrice || 0)).toLocaleString()} FCFA
              </p>
            </>
          )}
        </div>

        <div className="card">
          <p className="stat-label">Solde Disponible</p>
          {isLoading ? (
            <div className="h-12 bg-slate-800/60 rounded-xl animate-pulse"></div>
          ) : (
            <>
              <p className="text-4xl font-bold">
                {(wallet?.cashBalance || 0).toLocaleString()} <span className="text-xl text-slate-400">FCFA</span>
              </p>
              <Button
                variant="primary"
                className="mt-4"
                onClick={openWithdraw}
                disabled={!wallet?.cashBalance || wallet.cashBalance < 1000}
              >
                Retirer mes fonds
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Performance */}
      <div className="card">
        <h2 className="text-sm font-semibold text-white mb-4">Performance</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-3 rounded-xl bg-slate-800/40">
            <p className="stat-label">Prix d'achat moyen</p>
            <p className="text-xl font-semibold mt-1">{wallet?.averageBuyPrice?.toLocaleString() || '—'} <span className="text-sm text-slate-400">FCFA/g</span></p>
          </div>
          <div className="p-3 rounded-xl bg-slate-800/40">
            <p className="stat-label">Prix actuel</p>
            <p className="text-xl font-semibold mt-1">{price?.sellPrice?.toLocaleString() || '—'} <span className="text-sm text-slate-400">FCFA/g</span></p>
          </div>
          <div className="p-3 rounded-xl bg-slate-800/40">
            <p className="stat-label">Gain/Perte</p>
            <p className={`text-xl font-semibold mt-1 ${(wallet?.profitLoss || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {(wallet?.profitLoss || 0) >= 0 ? '+' : ''}{(wallet?.profitLoss || 0).toLocaleString()} <span className="text-sm">FCFA</span>
            </p>
          </div>
          <div className="p-3 rounded-xl bg-slate-800/40">
            <p className="stat-label">Rendement</p>
            <p className={`text-xl font-semibold mt-1 ${(wallet?.profitLossPercent || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {(wallet?.profitLossPercent || 0) >= 0 ? '+' : ''}{(wallet?.profitLossPercent || 0).toFixed(2)}%
            </p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="card">
        <h2 className="text-sm font-semibold text-white mb-4">Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Button
            variant={activeSection === 'deposit' ? 'primary' : 'secondary'}
            size="lg"
            className="flex items-center justify-center gap-2"
            onClick={() => activeSection === 'deposit' ? closeSection() : openDeposit()}
          >
            <span>📥</span> {activeSection === 'deposit' ? 'Fermer' : 'Déposer des fonds'}
          </Button>
          <Button
            variant={activeSection === 'withdraw' ? 'primary' : 'secondary'}
            size="lg"
            className="flex items-center justify-center gap-2"
            onClick={() => activeSection === 'withdraw' ? closeSection() : openWithdraw()}
          >
            <span>📤</span> {activeSection === 'withdraw' ? 'Fermer' : 'Retirer des fonds'}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            className="flex items-center justify-center gap-2"
            onClick={generateCertificate}
            disabled={!wallet?.tokenBalance || wallet.tokenBalance <= 0}
            isLoading={certificateMutation.isPending}
            loadingText="Génération..."
          >
            <span>📄</span> Certificat de détention
          </Button>
        </div>
      </div>

      {/* Inline Deposit Section */}
      {activeSection === 'deposit' && (
        <div className="card border-2 border-gold-500/30">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold">Déposer des fonds</h2>
            <button
              onClick={closeSection}
              className="text-slate-400 hover:text-white p-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-6">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {error}
              </div>
            )}

            {/* Amount */}
            <div>
              <label className="block text-sm text-slate-400 mb-2">Montant (FCFA)</label>
              <QuickAmountSelector
                amounts={QUICK_AMOUNTS}
                selectedAmount={amount}
                onSelect={setAmount}
              />
            </div>

            {/* Payment Method */}
            <div>
              <label className="block text-sm text-slate-400 mb-2">Mode de paiement</label>
              <PaymentMethodSelector
                selectedMethod={paymentMethod}
                onSelect={setPaymentMethod}
                phoneNumber={phoneNumber}
                onPhoneChange={setPhoneNumber}
              />
            </div>

            {/* KYC Info for deposits */}
            {user?.kycLevel === 'BASIC' && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <p className="text-sm text-amber-400">
                  <strong>Niveau KYC requis:</strong> Complétez votre vérification KYC pour effectuer des dépôts et acheter de l'or.
                </p>
                <a
                  href="/kyc"
                  className="text-sm text-amber-500 hover:text-amber-400 underline mt-1 inline-block"
                >
                  Compléter ma vérification KYC →
                </a>
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={closeSection}
              >
                Annuler
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => depositMutation.mutate()}
                disabled={!amount || (paymentMethod !== 'stripe' && paymentMethod !== 'card' && !phoneNumber) || user?.kycLevel === 'BASIC'}
                isLoading={depositMutation.isPending}
                loadingText="Traitement..."
              >
                Déposer {amount ? formatCurrency(amount, 'XOF') : '0 FCFA'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Inline Withdraw Section */}
      {activeSection === 'withdraw' && (
        <div className="card border-2 border-gold-500/30">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold">Retirer des fonds</h2>
            <button
              onClick={closeSection}
              className="text-slate-400 hover:text-white p-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-6">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {error}
              </div>
            )}

            {/* Available Balance */}
            <div className="p-4 bg-slate-800 rounded-lg">
              <p className="text-sm text-slate-400">Solde disponible</p>
              <p className="text-2xl font-bold">{formatCurrency(wallet?.cashBalance || 0, 'XOF')}</p>
            </div>

            {/* Amount */}
            <div>
              <label className="block text-sm text-slate-400 mb-2">Montant (FCFA)</label>
              <QuickAmountSelector
                amounts={QUICK_AMOUNTS}
                selectedAmount={amount}
                onSelect={setAmount}
              />
              <button
                onClick={() => setAmount(wallet?.cashBalance || 0)}
                className="text-sm text-amber-500 hover:text-amber-400 mt-2"
              >
                Retirer tout
              </button>
            </div>

            {/* Payment Method */}
            <div>
              <label className="block text-sm text-slate-400 mb-2">Mode de retrait</label>
              <PaymentMethodSelector
                selectedMethod={paymentMethod}
                onSelect={setPaymentMethod}
                phoneNumber={phoneNumber}
                onPhoneChange={setPhoneNumber}
              />
            </div>

            {/* KYC Info */}
            <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <p className="text-sm text-blue-400">
                Limite de retrait ({user?.kycLevel}):{' '}
                {formatCurrency(
                  user?.kycLevel === 'VERIFIED' ? 5000000 :
                  user?.kycLevel === 'STANDARD' ? 500000 : 0,
                  'XOF'
                )}/jour
              </p>
            </div>

            <div className="flex gap-3">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={closeSection}
              >
                Annuler
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => withdrawMutation.mutate()}
                disabled={!amount || !phoneNumber}
                isLoading={withdrawMutation.isPending}
                loadingText="Traitement..."
              >
                Retirer {amount ? formatCurrency(amount, 'XOF') : '0 FCFA'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Inline Success Section */}
      {activeSection === 'success' && transactionResult && (
        <div className="card border-2 border-green-500/30">
          <div className="text-center py-4">
            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold mb-2">
              {transactionResult.type === 'deposit' ? 'Dépôt initié' : 'Retrait demandé'}
            </h2>
            <p className="text-slate-400 mb-4">
              {transactionResult.type === 'deposit'
                ? 'Vous allez recevoir une demande de paiement sur votre téléphone.'
                : `Votre retrait sera traité sous ${transactionResult.estimatedTime || '24-48h'}.`}
            </p>
            <div className="bg-slate-800 rounded-lg p-4 mb-4 max-w-sm mx-auto">
              <p className="text-sm text-slate-400">Montant</p>
              <p className="text-2xl font-bold">{formatCurrency(transactionResult.amount, 'XOF')}</p>
              <p className="text-xs text-slate-500 mt-2">
                Référence: {transactionResult.transactionId.slice(0, 8).toUpperCase()}
              </p>
            </div>
            <div className="flex gap-3 justify-center max-w-sm mx-auto">
              {transactionResult.paymentUrl && (
                <a
                  href={transactionResult.paymentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 btn btn-secondary text-center"
                >
                  Ouvrir le paiement
                </a>
              )}
              <Button
                variant="primary"
                className="flex-1"
                onClick={closeSection}
              >
                Fermer
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Inline Certificate Section */}
      {activeSection === 'certificate' && certificateData && (
        <div className="card border-2 border-amber-500/30">
          <div className="text-center py-4">
            <div className="w-16 h-16 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold mb-2">Certificat de détention</h2>
            <p className="text-slate-400 mb-4">
              Votre certificat de propriété a été généré avec succès.
            </p>
            <div className="bg-slate-800 rounded-lg p-4 mb-4 space-y-3 text-left max-w-sm mx-auto">
              <div className="flex justify-between">
                <span className="text-slate-400">Or détenu</span>
                <span className="font-bold text-amber-500">{formatGrams(certificateData.totalOwnedGrams)}</span>
              </div>
              {certificateData.leasedBalance > 0 && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">dont en portefeuille</span>
                    <span>{formatGrams(certificateData.tokenBalance)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">dont en location (prêté)</span>
                    <span>{formatGrams(certificateData.leasedBalance)}</span>
                  </div>
                </>
              )}
              {/* No valuation: gold moves, and a certificate stating a value is
                  wrong the next day. The document says so too. */}
              <div className="flex justify-between">
                <span className="text-slate-400">Code de vérification</span>
                <span className="font-mono text-sm">{certificateData.verificationCode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Émis le</span>
                <span className="text-sm">{new Date(certificateData.issuedAt).toLocaleDateString('fr-FR')}</span>
              </div>
              <div className="pt-2 border-t border-slate-700">
                <p className="text-xs text-slate-500">
                  ID: {certificateData.certificateId}
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-center max-w-sm mx-auto">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={closeSection}
              >
                Fermer
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={downloadCertificate}
                leftIcon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                }
              >
                Télécharger
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Error toast */}
      {error && activeSection === 'none' && (
        <div className="fixed bottom-4 right-4 bg-red-500/90 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 z-50">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-white/80 hover:text-white">
            ×
          </button>
        </div>
      )}

      {/* Recent Transactions */}
      <div className="card">
        <h2 className="text-sm font-semibold text-white mb-4">Transactions Récentes</h2>
        <TransactionList
          transactions={transactions}
          emptyMessage="Aucune transaction"
        />
      </div>
    </div>
  );
}
