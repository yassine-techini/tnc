import { useQuery } from '@tanstack/react-query';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';
import { useStateStore } from '../stores/auth';
import { stateApi } from '../lib/api';

export default function Stock() {
  const { tokens } = useStateStore();

  const { data, isLoading } = useQuery({
    queryKey: ['state-stock'],
    queryFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return stateApi.getStock(tokens.accessToken);
    },
    enabled: !!tokens?.accessToken,
  });

  const { data: priceData } = useQuery({
    queryKey: ['price'],
    queryFn: () => stateApi.getPrice(),
  });

  const stock = data?.data;
  const price = priceData?.data;
  const stockHistory = stock?.stockHistory || [];

  const stockValue = (stock?.totalAllocated || 0) * (price?.priceXof || 0);
  const issuedValue = (stock?.tokensIssued || 0) * (price?.priceXof || 0);
  const availableValue = (stock?.availableStock || 0) * (price?.priceXof || 0);

  // Calculate utilization rate
  const utilizationRate = stock?.totalAllocated
    ? ((stock.tokensIssued || 0) / stock.totalAllocated) * 100
    : 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Stock d'Or National</h1>
        <p className="text-slate-400 mt-1">Suivi de la réserve d'or allouée à la tokenisation</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="card">
              <div className="h-24 bg-slate-700 rounded animate-pulse"></div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Main Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="card-state">
              <p className="text-sm text-slate-400">Or Total Alloué</p>
              <p className="text-3xl font-bold text-gold-500 mt-2">
                {stock?.totalAllocated?.toLocaleString() || '0'} g
              </p>
              <p className="text-sm text-slate-400 mt-1">
                = {((stock?.totalAllocated || 0) / 1000).toFixed(3)} kg
              </p>
            </div>

            <div className="card">
              <p className="text-sm text-slate-400">Valeur Estimée</p>
              <p className="text-3xl font-bold mt-2">
                {stockValue.toLocaleString()} <span className="text-lg text-slate-400">FCFA</span>
              </p>
              <p className="text-sm text-slate-400 mt-1">
                Au prix actuel ({price?.priceXof?.toLocaleString() || '—'} FCFA/g)
              </p>
            </div>

            <div className="card">
              <p className="text-sm text-slate-400">Tokens en Circulation</p>
              <p className="text-3xl font-bold text-blue-400 mt-2">
                {stock?.tokensIssued?.toLocaleString() || '0'} g
              </p>
              <p className="text-sm text-slate-400 mt-1">
                = {issuedValue.toLocaleString()} FCFA
              </p>
            </div>

            <div className="card">
              <p className="text-sm text-slate-400">Stock Disponible</p>
              <p className="text-3xl font-bold text-green-400 mt-2">
                {stock?.availableStock?.toLocaleString() || '0'} g
              </p>
              <p className="text-sm text-slate-400 mt-1">
                = {availableValue.toLocaleString()} FCFA
              </p>
            </div>
          </div>

          {/* Coverage Visualization */}
          <div className="card">
            <h2 className="text-lg font-semibold mb-6">Taux de Couverture</h2>

            <div className="relative h-12 bg-slate-700 rounded-lg overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-gold-600 to-gold-400"
                style={{
                  width: `${Math.min(utilizationRate, 100)}%`,
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-bold">
                  {((stock?.coverage || 0) * 100).toFixed(1)}% couvert
                </span>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4 mt-6">
              <div className="text-center p-4 bg-slate-900/50 rounded-lg">
                <div className="w-4 h-4 bg-gold-500 rounded mx-auto mb-2"></div>
                <p className="text-sm text-slate-400">Tokens Émis</p>
                <p className="font-semibold">{stock?.tokensIssued?.toLocaleString()} g</p>
                <p className="text-xs text-slate-500">{utilizationRate.toFixed(1)}% du stock</p>
              </div>
              <div className="text-center p-4 bg-slate-900/50 rounded-lg">
                <div className="w-4 h-4 bg-green-500 rounded mx-auto mb-2"></div>
                <p className="text-sm text-slate-400">Disponible</p>
                <p className="font-semibold">{stock?.availableStock?.toLocaleString()} g</p>
                <p className="text-xs text-slate-500">{(100 - utilizationRate).toFixed(1)}% du stock</p>
              </div>
              <div className="text-center p-4 bg-slate-900/50 rounded-lg">
                <div className="w-4 h-4 bg-slate-500 rounded mx-auto mb-2"></div>
                <p className="text-sm text-slate-400">Total Alloué</p>
                <p className="font-semibold">{stock?.totalAllocated?.toLocaleString()} g</p>
                <p className="text-xs text-slate-500">100%</p>
              </div>
              <div className="text-center p-4 bg-slate-900/50 rounded-lg">
                <div className={`w-4 h-4 rounded mx-auto mb-2 ${(stock?.coverage || 0) >= 1 ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <p className="text-sm text-slate-400">Couverture</p>
                <p className={`font-semibold ${(stock?.coverage || 0) >= 1 ? 'text-green-400' : 'text-red-400'}`}>
                  {((stock?.coverage || 0) * 100).toFixed(1)}%
                </p>
                <p className="text-xs text-slate-500">{(stock?.coverage || 0) >= 1 ? 'OK' : 'Insuffisant'}</p>
              </div>
            </div>
          </div>

          {/* Stock History Chart */}
          {stockHistory.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold mb-4">Évolution du Stock</h2>
              <p className="text-sm text-slate-400 mb-4">
                Historique de l'allocation et de l'émission des tokens
              </p>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={stockHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis
                      dataKey="date"
                      stroke="#9CA3AF"
                      fontSize={12}
                      tickFormatter={(value) => new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                    />
                    <YAxis
                      stroke="#9CA3AF"
                      fontSize={12}
                      tickFormatter={(value) => `${(value / 1000).toFixed(0)}K`}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1A1A2E', border: 'none', borderRadius: '8px' }}
                      labelStyle={{ color: '#9CA3AF' }}
                      formatter={(value: number, name: string) => [
                        `${value.toLocaleString()} g`,
                        name === 'allocated' ? 'Or Alloué' : 'Tokens Émis'
                      ]}
                      labelFormatter={(label) => new Date(label).toLocaleDateString('fr-FR')}
                    />
                    <Legend
                      formatter={(value) => value === 'allocated' ? 'Or Alloué' : 'Tokens Émis'}
                    />
                    <Line
                      type="monotone"
                      dataKey="allocated"
                      stroke="#D4AF37"
                      strokeWidth={2}
                      dot={false}
                      name="allocated"
                    />
                    <Line
                      type="monotone"
                      dataKey="issued"
                      stroke="#3B82F6"
                      strokeWidth={2}
                      dot={false}
                      name="issued"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Stock Value Over Time */}
          <div className="card">
            <h2 className="text-lg font-semibold mb-4">Valeur du Stock</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-4 bg-gold-500/10 border border-gold-500/30 rounded-lg">
                <p className="text-sm text-slate-400">Valeur Totale</p>
                <p className="text-2xl font-bold text-gold-500">
                  {stockValue.toLocaleString()} FCFA
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {(stockValue / 1000000).toFixed(2)} millions FCFA
                </p>
              </div>
              <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                <p className="text-sm text-slate-400">Tokens en Circulation</p>
                <p className="text-2xl font-bold text-blue-400">
                  {issuedValue.toLocaleString()} FCFA
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {(issuedValue / 1000000).toFixed(2)} millions FCFA
                </p>
              </div>
              <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                <p className="text-sm text-slate-400">Réserve Disponible</p>
                <p className="text-2xl font-bold text-green-400">
                  {availableValue.toLocaleString()} FCFA
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {(availableValue / 1000000).toFixed(2)} millions FCFA
                </p>
              </div>
            </div>
          </div>

          {/* Coverage Alert */}
          <div className={`p-4 rounded-lg border ${
            (stock?.coverage || 0) >= 1
              ? 'bg-green-500/10 border-green-500/30'
              : 'bg-red-500/10 border-red-500/30'
          }`}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{(stock?.coverage || 0) >= 1 ? '✅' : '⚠️'}</span>
              <div>
                <p className={`font-medium ${
                  (stock?.coverage || 0) >= 1 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {(stock?.coverage || 0) >= 1
                    ? 'Réserve entièrement couverte'
                    : 'Attention: Couverture insuffisante'}
                </p>
                <p className="text-sm text-slate-400">
                  {(stock?.coverage || 0) >= 1
                    ? 'Tous les tokens en circulation sont adossés à de l\'or physique.'
                    : 'Les tokens emis depassent le stock d\'or alloue.'}
                </p>
              </div>
            </div>
          </div>

          {/* Audit Info */}
          <div className="card">
            <h2 className="text-lg font-semibold mb-4">Informations d'Audit</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-4 bg-slate-900/50 rounded-lg">
                <p className="text-sm text-slate-400">Dernier Audit</p>
                <p className="text-xl font-medium mt-1">
                  {stock?.lastAuditDate
                    ? new Date(stock.lastAuditDate).toLocaleDateString('fr-FR', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })
                    : 'Non disponible'}
                </p>
              </div>
              <div className="p-4 bg-slate-900/50 rounded-lg">
                <p className="text-sm text-slate-400">Statut</p>
                <span className={`badge mt-2 ${
                  stock?.lastAuditDate ? 'badge-success' : 'badge-warning'
                }`}>
                  {stock?.lastAuditDate ? 'Vérifié' : 'En attente'}
                </span>
              </div>
              <div className="p-4 bg-slate-900/50 rounded-lg">
                <p className="text-sm text-slate-400">Prochain Audit</p>
                <p className="text-xl font-medium mt-1">
                  {stock?.lastAuditDate
                    ? new Date(new Date(stock.lastAuditDate).setMonth(new Date(stock.lastAuditDate).getMonth() + 3)).toLocaleDateString('fr-FR', {
                        month: 'long',
                        year: 'numeric',
                      })
                    : 'À planifier'}
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
