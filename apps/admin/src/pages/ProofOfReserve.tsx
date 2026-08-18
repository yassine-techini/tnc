import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAdminStore } from '../stores/auth';
import { adminApi } from '../lib/api';

export default function ProofOfReserve() {
  const { isAuthenticated } = useAdminStore();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-por'],
    queryFn: () => adminApi.getProofOfReserve(),
    enabled: isAuthenticated,
    refetchInterval: 60000, // Refresh every minute
  });

  const report = data?.data;

  /**
   * `pricing` vaut `null` tant qu'aucun cours n'a ete releve — un `0` inventerait
   * un prix. Les cartes de prix ne s'affichent alors pas plutot que d'annoncer
   * une valeur qui n'existe pas.
   */
  const prix = report?.pricing;

  /**
   * `coverageRatio` vaut `null` quand rien n'est emis : le ratio est sans objet,
   * et non « zero pour cent » (ADR 012 SS 5).
   */
  const couverturePct =
    report?.goldStock.coverageRatio != null
      ? `${(report.goldStock.coverageRatio * 100).toFixed(1)}%`
      : '—';

  const [pdfEnCours, setPdfEnCours] = useState(false);
  const [pdfErreur, setPdfErreur] = useState('');

  const telechargerPdf = async () => {
    setPdfEnCours(true);
    setPdfErreur('');
    try {
      const blob = await adminApi.downloadProofOfReservePdf();
      const url = URL.createObjectURL(blob);
      const lien = document.createElement('a');
      lien.href = url;
      lien.download = `proof-of-reserve-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(lien);
      lien.click();
      document.body.removeChild(lien);
      URL.revokeObjectURL(url);
    } catch (e) {
      setPdfErreur(e instanceof Error ? e.message : 'Le PDF n a pas pu être généré');
    } finally {
      setPdfEnCours(false);
    }
  };

  // Export JSON — utile pour une machine qui relit le rapport.
  // Le PDF, lui, vient du serveur : il est rendu par `renderPdf` depuis la
  // phase 1.3. Le commentaire qui affirmait ici qu'aucun generateur PDF
  // n'existait dans Workers avait survecu a sa raison d'etre.
  const exportJson = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `proof-of-reserve-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatNumber = (num: number, decimals = 3) => {
    return num.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('fr-FR') + ' FCFA';
  };

  return (
    <div className="space-y-6">
      {/* Un echec de generation doit se voir : sinon le bouton ne fait rien et
          l operateur croit a un navigateur qui bloque le telechargement. */}
      {pdfErreur && (
        <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-300">
          {pdfErreur}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Proof of Reserve</h1>
          <p className="text-sm text-slate-500 mt-1">
            Rapport de couverture des tokens par l'or physique
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => refetch()}
            className="btn-secondary flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Actualiser
          </button>
          <button
            onClick={telechargerPdf}
            disabled={!report || pdfEnCours}
            className="btn-secondary flex items-center gap-2 disabled:opacity-50"
          >
            {pdfEnCours ? 'Génération…' : 'PDF'}
          </button>
          <button onClick={exportJson} disabled={!report} className="btn-primary flex items-center gap-2 disabled:opacity-50">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Exporter JSON
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="card">
              <div className="h-24 bg-slate-800/60 rounded-xl animate-pulse" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="card p-6 text-center">
          <div className="w-12 h-12 mx-auto rounded-xl bg-red-500/15 flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <p className="text-red-400 font-medium">Erreur lors du chargement du rapport</p>
          <button onClick={() => refetch()} className="btn-secondary mt-4">
            Réessayer
          </button>
        </div>
      ) : report && (
        <>
          {/* Coverage Status Banner */}
          <div className={`p-4 rounded-xl border ${
            report.goldStock.isCovered
              ? 'bg-emerald-500/10 border-emerald-500/20'
              : 'bg-red-500/10 border-red-500/20'
          }`}>
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                report.goldStock.isCovered ? 'bg-emerald-500/15' : 'bg-red-500/15'
              }`}>
                {report.goldStock.isCovered ? (
                  <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                )}
              </div>
              <div>
                <p className={`font-semibold ${report.goldStock.isCovered ? 'text-emerald-400' : 'text-red-400'}`}>
                  {report.goldStock.isCovered
                    ? 'Couverture Complète - Tous les tokens sont adossés à de l\'or physique'
                    : 'Alerte de Couverture - Stock insuffisant pour couvrir tous les tokens'}
                </p>
                <p className="text-sm text-slate-400 mt-1">
                  Taux de couverture: <span className="font-bold">{couverturePct}</span>
                </p>
              </div>
            </div>
          </div>

          {/* Main Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Gold Total */}
            <div className="card-gold relative overflow-hidden">
              <div className="absolute -top-8 -right-8 w-24 h-24 bg-gold-500/10 rounded-full blur-2xl" />
              <div className="relative">
                <div className="flex items-center gap-3 mb-3">
                  <div className="stat-icon bg-gold-500/15">
                    <svg className="w-5 h-5 text-gold-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                  </div>
                  <p className="stat-label">Or Physique Alloué</p>
                </div>
                <p className="text-3xl font-bold text-gold-500 tracking-tight">
                  {formatNumber(report.goldStock.totalAllocated)} <span className="text-lg">g</span>
                </p>
                <p className="text-[11px] text-slate-500 mt-1">Stock total de l'État</p>
              </div>
            </div>

            {/* Tokens Issued */}
            <div className="card">
              <div className="flex items-center gap-3 mb-3">
                <div className="stat-icon bg-blue-500/15">
                  <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="stat-label">Tokens en Circulation</p>
              </div>
              <p className="text-3xl font-bold text-white tracking-tight">
                {formatNumber(report.goldStock.tokensIssued)} <span className="text-lg text-slate-400">g</span>
              </p>
              <p className="text-[11px] text-slate-500 mt-1">Détenus par {report.tokenHolders.totalHolders} utilisateurs</p>
            </div>

            {/* Coverage */}
            <div className="card">
              <div className="flex items-center gap-3 mb-3">
                <div className={`stat-icon ${report.goldStock.isCovered ? 'bg-emerald-500/15' : 'bg-red-500/15'}`}>
                  <svg className={`w-5 h-5 ${report.goldStock.isCovered ? 'text-emerald-400' : 'text-red-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <p className="stat-label">Taux de Couverture</p>
              </div>
              <p className={`text-3xl font-bold tracking-tight ${report.goldStock.isCovered ? 'text-emerald-400' : 'text-red-400'}`}>
                {couverturePct}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                {report.goldStock.isCovered ? 'Réserves suffisantes' : 'Réserves insuffisantes'}
              </p>
            </div>

            {/* Current Price */}
            <div className="card">
              <div className="flex items-center gap-3 mb-3">
                <div className="stat-icon bg-purple-500/15">
                  <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <p className="stat-label">Prix Actuel</p>
              </div>
              <p className="text-3xl font-bold text-white tracking-tight">
                {prix ? formatCurrency(prix.priceXof) : '—'}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                {prix ? `Par gramme d'or (${prix.source})` : 'Aucun cours relevé'}
              </p>
            </div>
          </div>

          {/* Coverage Visualization */}
          <div className="card">
            <h2 className="text-sm font-semibold text-white mb-4">Répartition des Réserves</h2>
            <div className="h-4 bg-slate-800/80 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  report.goldStock.isCovered
                    ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                    : 'bg-gradient-to-r from-red-500 to-red-400'
                }`}
                style={{
                  width: `${Math.min((report.goldStock.coverageRatio ?? 0) * 100, 100)}%`,
                }}
              />
            </div>
            <div className="flex justify-between mt-3">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${report.goldStock.isCovered ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <span className="text-xs text-slate-400">
                  Tokens émis: <span className="text-white font-medium">{formatNumber(report.goldStock.tokensIssued)} g</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-gold-500" />
                <span className="text-xs text-slate-400">
                  Or alloué: <span className="text-white font-medium">{formatNumber(report.goldStock.totalAllocated)} g</span>
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Token Holders Distribution */}
            <div className="card">
              <h2 className="text-sm font-semibold text-white mb-4">Distribution des Détenteurs</h2>
              <div className="space-y-3">
                {report.tokenHolders.distribution.map((tier, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-slate-800/40 rounded-xl">
                    <div>
                      <p className="text-sm font-medium text-white">{tier.range}</p>
                      <p className="text-[11px] text-slate-500">{tier.count} utilisateurs</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gold-400">{formatNumber(tier.totalTokens)} g</p>
                    </div>
                  </div>
                ))}
                <div className="pt-3 border-t border-slate-800">
                  <div className="flex justify-between">
                    <span className="text-sm text-slate-400">Total</span>
                    <span className="text-sm font-bold text-white">{report.tokenHolders.totalHolders} détenteurs</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-sm text-slate-400">Moyenne par détenteur</span>
                    <span className="text-sm font-bold text-gold-400">{formatNumber(report.tokenHolders.averageHolding)} g</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Transaction Activity */}
            <div className="card">
              <h2 className="text-sm font-semibold text-white mb-4">Activité des Transactions</h2>
              <div className="space-y-4">
                {/* 24h */}
                <div className="p-3 bg-slate-800/40 rounded-xl">
                  <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Dernières 24h</p>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-lg font-bold text-emerald-400">{report.transactions.last24h.buys}</p>
                      <p className="text-[10px] text-slate-500">Achats</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-orange-400">{report.transactions.last24h.sells}</p>
                      <p className="text-[10px] text-slate-500">Ventes</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-blue-400">{formatNumber(report.transactions.last24h.volumeXof)}</p>
                      <p className="text-[10px] text-slate-500">Volume (g)</p>
                    </div>
                  </div>
                </div>

                {/* 7d */}
                <div className="p-3 bg-slate-800/40 rounded-xl">
                  <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-2">7 derniers jours</p>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-lg font-bold text-emerald-400">{report.transactions.last7d.buys}</p>
                      <p className="text-[10px] text-slate-500">Achats</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-orange-400">{report.transactions.last7d.sells}</p>
                      <p className="text-[10px] text-slate-500">Ventes</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-blue-400">{formatNumber(report.transactions.last7d.volumeXof)}</p>
                      <p className="text-[10px] text-slate-500">Volume (g)</p>
                    </div>
                  </div>
                </div>

                {/* 30d */}
                <div className="p-3 bg-slate-800/40 rounded-xl">
                  <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-2">30 derniers jours</p>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-lg font-bold text-emerald-400">{report.transactions.last30d.buys}</p>
                      <p className="text-[10px] text-slate-500">Achats</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-orange-400">{report.transactions.last30d.sells}</p>
                      <p className="text-[10px] text-slate-500">Ventes</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-blue-400">{formatNumber(report.transactions.last30d.volumeXof)}</p>
                      <p className="text-[10px] text-slate-500">Volume (g)</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Pricing & Audit Info */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Détails des prix — masqués tant qu'aucun cours n'a été relevé :
                un tableau de zéros se lirait comme un marché à l'arrêt. */}
            {prix && (
            <div className="card">
              <h2 className="text-sm font-semibold text-white mb-4">Détails des Prix</h2>
              <div className="space-y-3">
                <div className="flex justify-between items-center p-3 bg-slate-800/40 rounded-xl">
                  <span className="text-sm text-slate-400">Prix d'achat</span>
                  <span className="text-sm font-bold text-emerald-400">{formatCurrency(prix.buyPrice)}/g</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-slate-800/40 rounded-xl">
                  <span className="text-sm text-slate-400">Prix de vente</span>
                  <span className="text-sm font-bold text-orange-400">{formatCurrency(prix.sellPrice)}/g</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-slate-800/40 rounded-xl">
                  <span className="text-sm text-slate-400">Spread</span>
                  <span className="text-sm font-bold text-white">{((prix.spreadBuy + prix.spreadSell) * 100).toFixed(2)}%</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-slate-800/40 rounded-xl">
                  <span className="text-sm text-slate-400">Source du prix</span>
                  <span className="text-sm font-bold text-white">{prix.source}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-slate-800/40 rounded-xl">
                  <span className="text-sm text-slate-400">Dernière mise à jour</span>
                  <span className="text-sm font-bold text-white">{formatDate(prix.timestamp)}</span>
                </div>
              </div>
            </div>
            )}

            {/* Audit Info */}
            <div className="card">
              <h2 className="text-sm font-semibold text-white mb-4">Informations d'Audit</h2>
              <div className="space-y-4">
                <div className="p-4 bg-slate-800/40 rounded-xl">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center">
                      <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Dernier audit</p>
                      <p className="text-sm font-medium text-white">
                        {report.audit.lastAuditDate ? formatDate(report.audit.lastAuditDate) : 'Aucun audit enregistré'}
                      </p>
                    </div>
                  </div>
                  {report.audit.lastAuditResult && (
                    <p className="text-xs text-slate-400 mt-2 p-2 bg-slate-900/50 rounded-lg">
                      {report.audit.lastAuditResult}
                    </p>
                  )}
                </div>

                {report.audit.nextAuditDue && (
                  <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                    <div className="flex items-center gap-3">
                      <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <div>
                        <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Prochain audit prévu</p>
                        <p className="text-sm font-medium text-blue-400">{formatDate(report.audit.nextAuditDue)}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Vérification.
              La page affichait un « checksum » qu'aucune route ne produisait. Ce
              qui est vérifiable existe pourtant déjà : l'empreinte de
              l'attestation signée, que la page publique /reserve recalcule dans
              le navigateur. On publie celle-là, ou on dit qu'il n'y en a pas. */}
          <div className="card">
            <h2 className="text-sm font-semibold text-white mb-4">Vérification du Rapport</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-3 bg-slate-800/40 rounded-xl">
                <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1">Généré le</p>
                <p className="text-sm font-medium text-white">{formatDate(report.generatedAt)}</p>
              </div>
              <div className="p-3 bg-slate-800/40 rounded-xl">
                <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1">Attestation</p>
                <p className="text-sm font-medium text-white">
                  {report.attestation
                    ? `nº ${report.attestation.sequence}${report.attestation.signed ? ' (signée)' : ' (non signée)'}`
                    : 'Aucune émise'}
                </p>
              </div>
              <div className="p-3 bg-slate-800/40 rounded-xl">
                <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1">Empreinte</p>
                <p className="text-sm font-mono text-slate-400 truncate">
                  {report.attestation ? report.attestation.digest : '—'}
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
