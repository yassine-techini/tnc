import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../lib/api';
import { useAdminStore } from '../stores/auth';

const categoryLabels: Record<string, string> = {
  payment: 'Paiement',
  notification: 'Notifications',
  kyc: 'KYC',
  market: 'Marché',
};

const categoryIcons: Record<string, string> = {
  payment: '💳',
  notification: '🔔',
  kyc: '🪪',
  market: '📈',
};

interface Integration {
  id: string;
  provider: string;
  displayName: string;
  category: string;
  enabled: boolean;
  config: Record<string, string>;
  lastTestedAt: string | null;
  lastTestResult: string | null;
  updatedAt: string;
}

export default function Integrations() {
  const queryClient = useQueryClient();
  const { tokens, hasPermission } = useAdminStore();
  const [configModal, setConfigModal] = useState<Integration | null>(null);
  const [configForm, setConfigForm] = useState<Record<string, string>>({});
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ provider: string; success: boolean; message: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['integrations'],
    queryFn: () => adminApi.getIntegrations(tokens!.accessToken),
    enabled: !!tokens,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ provider, enabled }: { provider: string; enabled: boolean }) =>
      adminApi.updateIntegration(tokens!.accessToken, provider, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations'] }),
  });

  const configMutation = useMutation({
    mutationFn: ({ provider, config }: { provider: string; config: Record<string, string> }) =>
      adminApi.updateIntegration(tokens!.accessToken, provider, { config }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      setConfigModal(null);
    },
  });

  const testMutation = useMutation({
    mutationFn: (provider: string) => adminApi.testIntegration(tokens!.accessToken, provider),
    onSuccess: (res) => {
      setTestResult({ provider: res.data.provider, success: res.data.testResult === 'success', message: res.data.message });
      setTestingProvider(null);
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
    onError: (err: any) => {
      setTestResult({ provider: testingProvider || '', success: false, message: err.message });
      setTestingProvider(null);
    },
  });

  const integrations = data?.data?.items || [];
  const canEdit = hasPermission('integrations', 'update');

  // Group by category
  const grouped = integrations.reduce<Record<string, Integration[]>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  const categoryOrder = ['payment', 'notification', 'kyc', 'market'];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Intégrations</h1>
        <p className="text-sm text-slate-500 mt-0.5">Configuration des services tiers</p>
      </div>

      {/* Test result banner */}
      {testResult && (
        <div className={`p-4 rounded-xl flex items-center justify-between ${testResult.success ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
          <div className="flex items-center gap-3">
            <span className={`w-2.5 h-2.5 rounded-full ${testResult.success ? 'bg-emerald-500' : 'bg-red-500'}`} />
            <span className={`text-sm font-medium ${testResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
              {testResult.message}
            </span>
          </div>
          <button onClick={() => setTestResult(null)} className="text-slate-400 hover:text-slate-200">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        categoryOrder.filter((cat) => grouped[cat]).map((category) => (
          <div key={category} className="space-y-3">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
              <span>{categoryIcons[category]}</span>
              {categoryLabels[category] || category}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {grouped[category].map((integration) => (
                <div key={integration.id} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800/60 shadow-sm p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{integration.displayName}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">{integration.provider}</p>
                    </div>
                    {canEdit && (
                      <button
                        onClick={() => toggleMutation.mutate({ provider: integration.provider, enabled: !integration.enabled })}
                        className={`relative w-11 h-6 rounded-full transition-all ${integration.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${integration.enabled ? 'translate-x-5' : ''}`} />
                      </button>
                    )}
                  </div>

                  {/* Status */}
                  <div className="flex items-center gap-3 mb-4 text-xs">
                    <span className={`inline-flex items-center gap-1.5 font-medium ${integration.enabled ? 'text-emerald-400' : 'text-slate-500'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${integration.enabled ? 'bg-emerald-500' : 'bg-slate-600'}`} />
                      {integration.enabled ? 'Actif' : 'Inactif'}
                    </span>
                    {integration.lastTestedAt && (
                      <span className={`inline-flex items-center gap-1.5 ${integration.lastTestResult === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {integration.lastTestResult === 'success' ? 'OK' : 'Erreur'}
                        &middot; {new Date(integration.lastTestedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    {canEdit && (
                      <button
                        onClick={() => {
                          setConfigModal(integration);
                          setConfigForm({ ...integration.config });
                        }}
                        className="flex-1 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium transition-all"
                      >
                        Configurer
                      </button>
                    )}
                    {canEdit && (
                      <button
                        onClick={() => { setTestingProvider(integration.provider); testMutation.mutate(integration.provider); }}
                        disabled={testingProvider === integration.provider}
                        className="flex-1 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium transition-all disabled:opacity-50"
                      >
                        {testingProvider === integration.provider ? 'Test...' : 'Tester'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Config Modal */}
      {configModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800/60 shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Configurer {configModal.displayName}</h2>
              <button onClick={() => setConfigModal(null)} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="mb-4 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400">
              Les clés API secrètes sont configurées via <code className="bg-blue-500/20 px-1 rounded">wrangler secret</code> et ne sont pas affichées ici.
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              configMutation.mutate({ provider: configModal.provider, config: configForm });
            }} className="space-y-4">
              {Object.entries(configForm).map(([key, value]) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-slate-400 mb-1.5">{key}</label>
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => setConfigForm({ ...configForm, [key]: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-gold-500 outline-none"
                    placeholder={key}
                  />
                </div>
              ))}
              {Object.keys(configForm).length === 0 && (
                <p className="text-sm text-slate-500">Aucun paramètre configurable pour ce provider.</p>
              )}
              <button type="submit" disabled={configMutation.isPending} className="w-full py-2.5 rounded-xl bg-gold-500 hover:bg-gold-600 text-white text-sm font-medium transition-all disabled:opacity-50">
                {configMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
