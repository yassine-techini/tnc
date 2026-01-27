import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../lib/api';
import { useAdminStore } from '../stores/auth';

const MODULES = ['dashboard', 'users', 'kyc', 'transactions', 'stock', 'withdrawals', 'reconciliation', 'integrations', 'audit', 'admins'] as const;
const ACTIONS = ['view', 'create', 'update', 'delete', 'approve', 'reject', 'export'] as const;

const moduleLabels: Record<string, string> = {
  dashboard: 'Tableau de bord',
  users: 'Utilisateurs',
  kyc: 'Vérification KYC',
  transactions: 'Transactions',
  stock: 'Stock Or',
  withdrawals: 'Retraits',
  reconciliation: 'Réconciliation',
  integrations: 'Intégrations',
  audit: 'Journal d\'audit',
  admins: 'Administrateurs',
};

const actionLabels: Record<string, string> = {
  view: 'Voir',
  create: 'Créer',
  update: 'Modifier',
  delete: 'Supprimer',
  approve: 'Approuver',
  reject: 'Rejeter',
  export: 'Exporter',
};

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Administrateur',
  KYC_REVIEWER: 'Réviseur KYC',
  FINANCE: 'Finance',
  SUPPORT: 'Support',
};

export default function AdminDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { tokens, hasPermission } = useAdminStore();
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', id],
    queryFn: () => adminApi.getAdmin(tokens!.accessToken, id!),
    enabled: !!tokens && !!id,
    select: (res) => res.data,
  });

  // Initialize overrides from server data
  const initOverrides = (adminData: typeof data) => {
    if (!adminData) return;
    const map = new Map<string, boolean>();
    for (const o of adminData.overrides || []) {
      map.set(`${o.module}:${o.action}`, o.granted);
    }
    setOverrides(map);
    setDirty(false);
  };

  // Check if module:action is in the role defaults
  const isRoleDefault = (module: string, action: string): boolean => {
    if (!data) return false;
    return data.permissions[module]?.includes(action) ?? false;
  };

  // Check the current state of a permission (override or default)
  const isChecked = (module: string, action: string): boolean => {
    const key = `${module}:${action}`;
    if (overrides.has(key)) return overrides.get(key)!;
    return isRoleDefault(module, action);
  };

  const isOverridden = (module: string, action: string): boolean => {
    return overrides.has(`${module}:${action}`);
  };

  const togglePermission = (module: string, action: string) => {
    const key = `${module}:${action}`;
    const currentDefault = isRoleDefault(module, action);
    const currentOverride = overrides.get(key);

    const newOverrides = new Map(overrides);

    if (currentOverride === undefined) {
      // No override yet -> create one (opposite of default)
      newOverrides.set(key, !currentDefault);
    } else {
      // Already overridden -> if it matches default, remove override; else toggle
      if (currentOverride === currentDefault) {
        // Override matches default -> remove it
        newOverrides.delete(key);
      } else {
        // Toggle back to default (remove override)
        newOverrides.delete(key);
      }
    }

    setOverrides(newOverrides);
    setDirty(true);
  };

  const savePermissions = async () => {
    if (!id || !tokens) return;
    setSaving(true);
    try {
      const overridesList = Array.from(overrides.entries()).map(([key, granted]) => {
        const [module, action] = key.split(':');
        return { module, action, granted };
      });
      await adminApi.updateAdminPermissions(tokens.accessToken, id, overridesList);
      queryClient.invalidateQueries({ queryKey: ['admin', id] });
      setDirty(false);
    } catch (err: any) {
      alert(err.message || 'Erreur lors de la sauvegarde');
    }
    setSaving(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return <div className="text-center py-16 text-slate-500">Admin non trouvé</div>;
  }

  // Initialize overrides on first render with data
  if (overrides.size === 0 && data.overrides.length > 0 && !dirty) {
    initOverrides(data);
  }

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/admins')} className="p-2 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 transition-all">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">{data.name || data.email}</h1>
          <p className="text-sm text-slate-500">{data.email} &middot; {roleLabels[data.role] || data.role}</p>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800/60 p-5">
          <p className="text-xs text-slate-500 mb-1">Rôle</p>
          <p className="text-sm font-medium text-slate-900 dark:text-white">{roleLabels[data.role] || data.role}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800/60 p-5">
          <p className="text-xs text-slate-500 mb-1">Statut</p>
          <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${data.active ? 'text-emerald-400' : 'text-red-400'}`}>
            <span className={`w-2 h-2 rounded-full ${data.active ? 'bg-emerald-500' : 'bg-red-500'}`} />
            {data.active ? 'Actif' : 'Inactif'}
          </span>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800/60 p-5">
          <p className="text-xs text-slate-500 mb-1">Dernière connexion</p>
          <p className="text-sm font-medium text-slate-900 dark:text-white">
            {data.lastLoginAt ? new Date(data.lastLoginAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Jamais'}
          </p>
        </div>
      </div>

      {/* Permissions Grid */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800/60 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800/60">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Permissions</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Les cases grisées sont les permissions par défaut du rôle. Les cases colorées sont des surcharges personnalisées.
            </p>
          </div>
          {hasPermission('admins', 'update') && dirty && (
            <button
              onClick={savePermissions}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-gold-500 hover:bg-gold-600 text-white text-sm font-medium transition-all disabled:opacity-50"
            >
              {saving ? 'Enregistrement...' : 'Sauvegarder'}
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800/60">
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3 sticky left-0 bg-white dark:bg-slate-900">Module</th>
                {ACTIONS.map((action) => (
                  <th key={action} className="text-center text-xs font-medium text-slate-500 uppercase tracking-wider px-3 py-3">
                    {actionLabels[action]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {MODULES.map((module) => (
                <tr key={module} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-6 py-3 text-sm font-medium text-slate-900 dark:text-white sticky left-0 bg-white dark:bg-slate-900">
                    {moduleLabels[module]}
                  </td>
                  {ACTIONS.map((action) => {
                    const checked = isChecked(module, action);
                    const overridden = isOverridden(module, action);
                    const canEdit = hasPermission('admins', 'update');

                    return (
                      <td key={action} className="text-center px-3 py-3">
                        <button
                          onClick={() => canEdit && togglePermission(module, action)}
                          disabled={!canEdit}
                          className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-all
                            ${checked
                              ? overridden
                                ? 'bg-gold-500 border-gold-500 text-white'
                                : 'bg-slate-600 border-slate-600 text-white'
                              : overridden
                                ? 'border-red-500/50 bg-red-500/10'
                                : 'border-slate-700 bg-transparent'
                            }
                            ${canEdit ? 'cursor-pointer hover:scale-110' : 'cursor-default opacity-70'}
                          `}
                          title={
                            overridden
                              ? `Surcharge: ${checked ? 'Autorisé' : 'Refusé'}`
                              : checked
                                ? 'Par défaut (rôle)'
                                : 'Non autorisé'
                          }
                        >
                          {checked && (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800/60 flex flex-wrap gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-2">
            <span className="w-5 h-5 rounded bg-slate-600 flex items-center justify-center">
              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
            </span>
            Par défaut (rôle)
          </span>
          <span className="flex items-center gap-2">
            <span className="w-5 h-5 rounded bg-gold-500 flex items-center justify-center">
              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
            </span>
            Surcharge autorisée
          </span>
          <span className="flex items-center gap-2">
            <span className="w-5 h-5 rounded border-2 border-red-500/50 bg-red-500/10" />
            Surcharge refusée
          </span>
          <span className="flex items-center gap-2">
            <span className="w-5 h-5 rounded border-2 border-slate-700" />
            Non autorisé
          </span>
        </div>
      </div>
    </div>
  );
}
