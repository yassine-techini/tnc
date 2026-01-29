import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminStore } from '../stores/auth';
import { adminApi } from '../lib/api';

export default function Stock() {
  const { isAuthenticated } = useAdminStore();
  const queryClient = useQueryClient();
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-stock'],
    queryFn: () => adminApi.getStock(),
    enabled: isAuthenticated,
  });

  const { data: priceData } = useQuery({
    queryKey: ['price'],
    queryFn: () => adminApi.getPrice(),
  });

  const adjustMutation = useMutation({
    mutationFn: () => adminApi.adjustStock(parseFloat(adjustAmount), adjustReason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-stock'] });
      setShowAdjustModal(false);
      setAdjustAmount('');
      setAdjustReason('');
    },
  });

  const stock = data?.data;
  const price = priceData?.data;
  const stockValue = (stock?.totalAllocated || 0) * (price?.priceXof || 0);
  const coveragePercent = ((stock?.coverage || 0) * 100).toFixed(1);
  const isCovered = (stock?.coverage || 0) >= 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Stock d'Or</h1>
          <p className="text-sm text-slate-500 mt-1">Gestion du stock d'or physique alloué</p>
        </div>
        <button onClick={() => setShowAdjustModal(true)} className="btn-primary flex items-center gap-2 group">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Ajuster le stock
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="card">
              <div className="h-20 bg-slate-800/60 rounded-xl animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Main Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Gold Total - card-gold */}
            <div className="card-gold relative overflow-hidden">
              <div className="absolute -top-8 -right-8 w-24 h-24 bg-gold-500/10 rounded-full blur-2xl" />
              <div className="relative">
                <div className="flex items-center gap-3 mb-3">
                  <div className="stat-icon bg-gold-500/15">
                    <svg className="w-5 h-5 text-gold-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                  </div>
                  <p className="stat-label">Or Total Alloué</p>
                </div>
                <p className="text-3xl font-bold text-gold-500 tracking-tight">
                  {stock?.totalAllocated?.toFixed(3) || '0'} <span className="text-lg">g</span>
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  ≈ {stockValue.toLocaleString()} FCFA
                </p>
              </div>
            </div>

            <div className="card">
              <div className="flex items-center gap-3 mb-3">
                <div className="stat-icon bg-blue-500/15">
                  <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                  </svg>
                </div>
                <p className="stat-label">Tokens Émis</p>
              </div>
              <p className="text-3xl font-bold text-white tracking-tight">
                {stock?.tokensIssued?.toFixed(3) || '0'} <span className="text-lg text-slate-400">g</span>
              </p>
              <p className="text-[11px] text-slate-500 mt-1">En circulation</p>
            </div>

            <div className="card">
              <div className="flex items-center gap-3 mb-3">
                <div className="stat-icon bg-emerald-500/15">
                  <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                  </svg>
                </div>
                <p className="stat-label">Stock Disponible</p>
              </div>
              <p className="text-3xl font-bold text-emerald-400 tracking-tight">
                {stock?.availableStock?.toFixed(3) || '0'} <span className="text-lg">g</span>
              </p>
              <p className="text-[11px] text-slate-500 mt-1">À la vente</p>
            </div>

            <div className="card">
              <div className="flex items-center gap-3 mb-3">
                <div className={`stat-icon ${isCovered ? 'bg-emerald-500/15' : 'bg-red-500/15'}`}>
                  <svg className={`w-5 h-5 ${isCovered ? 'text-emerald-400' : 'text-red-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <p className="stat-label">Couverture</p>
              </div>
              <p className={`text-3xl font-bold tracking-tight ${isCovered ? 'text-emerald-400' : 'text-red-400'}`}>
                {coveragePercent}%
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                {isCovered ? 'Couverture complète' : 'Couverture insuffisante'}
              </p>
            </div>
          </div>

          {/* Coverage Warning */}
          {!isCovered && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-sm text-red-400">Alerte de couverture</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Le stock d'or physique ne couvre pas 100% des tokens émis. Ajoutez du stock ou limitez les ventes.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Stock Visualization */}
          <div className="card">
            <h2 className="text-sm font-semibold text-white mb-4">Répartition du stock</h2>
            <div className="h-3 bg-slate-800/80 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-gold-500 to-gold-400 rounded-full transition-all duration-700"
                style={{
                  width: `${Math.min(
                    ((stock?.tokensIssued || 0) / (stock?.totalAllocated || 1)) * 100,
                    100
                  )}%`,
                }}
              />
            </div>
            <div className="flex justify-between mt-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-gold-500" />
                <span className="text-xs text-slate-400">
                  Tokens émis: <span className="text-white font-medium">{stock?.tokensIssued?.toFixed(3)} g</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
                <span className="text-xs text-slate-400">
                  Total alloué: <span className="text-white font-medium">{stock?.totalAllocated?.toFixed(3)} g</span>
                </span>
              </div>
            </div>
          </div>

          {/* Audit Info */}
          <div className="card">
            <h2 className="text-sm font-semibold text-white mb-4">Dernier audit</h2>
            {stock?.lastAuditDate ? (
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                  <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Date du dernier audit</p>
                  <p className="text-lg font-semibold text-white">
                    {new Date(stock.lastAuditDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-slate-800/60 flex items-center justify-center">
                  <svg className="w-6 h-6 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-sm text-slate-500">Aucun audit enregistré</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Adjust Modal */}
      {showAdjustModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="card w-full max-w-md">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-white">Ajuster le stock</h3>
              <button onClick={() => setShowAdjustModal(false)} className="p-1.5 rounded-lg hover:bg-slate-800 transition-colors">
                <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
                  Quantité (grammes)
                </label>
                <input
                  type="number"
                  className="input"
                  placeholder="Ex: 100 ou -50"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  step="0.001"
                />
                <p className="text-[10px] text-slate-600 mt-1">
                  Utilisez un nombre négatif pour réduire le stock
                </p>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
                  Raison de l'ajustement
                </label>
                <textarea
                  className="input min-h-[80px]"
                  placeholder="Ex: Nouvelle allocation de l'État..."
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                />
              </div>
            </div>
            {adjustMutation.isError && (
              <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">
                Erreur lors de l'ajustement. Veuillez réessayer.
              </div>
            )}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowAdjustModal(false)} className="btn-secondary flex-1">
                Annuler
              </button>
              <button
                onClick={() => adjustMutation.mutate()}
                disabled={!adjustAmount || !adjustReason || adjustMutation.isPending}
                className="btn-primary flex-1"
              >
                {adjustMutation.isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                    En cours...
                  </span>
                ) : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
