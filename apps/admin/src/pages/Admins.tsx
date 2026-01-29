import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../lib/api';
import { useAdminStore } from '../stores/auth';

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'KYC_REVIEWER', 'FINANCE', 'SUPPORT'] as const;

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Administrateur',
  KYC_REVIEWER: 'Réviseur KYC',
  FINANCE: 'Finance',
  SUPPORT: 'Support',
};

const roleBadgeColors: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  ADMIN: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  KYC_REVIEWER: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  FINANCE: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  SUPPORT: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
};

export default function Admins() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, hasPermission } = useAdminStore();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<any>(null);
  const [createForm, setCreateForm] = useState({ email: '', name: '', password: '', role: 'ADMIN' });
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admins'],
    queryFn: () => adminApi.getAdmins(),
    enabled: isAuthenticated,
  });

  const createMutation = useMutation({
    mutationFn: (form: typeof createForm) => adminApi.createAdmin(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admins'] });
      setShowCreateModal(false);
      setCreateForm({ email: '', name: '', password: '', role: 'ADMIN' });
      setError('');
    },
    onError: (err: any) => setError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => adminApi.updateAdmin(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admins'] });
      setEditingAdmin(null);
    },
    onError: (err: any) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteAdmin(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admins'] }),
    onError: (err: any) => setError(err.message),
  });

  const admins = data?.data?.items || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Administrateurs</h1>
          <p className="text-sm text-slate-500 mt-0.5">{admins.length} admin{admins.length !== 1 ? 's' : ''}</p>
        </div>
        {hasPermission('admins', 'create') && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gold-500 hover:bg-gold-600 text-white text-sm font-medium transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nouvel admin
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800/60 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : admins.length === 0 ? (
          <div className="text-center py-16 text-slate-500">Aucun administrateur</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800/60">
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">Admin</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">Rôle</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">Statut</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">Dernière connexion</th>
                <th className="text-right text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {admins.map((admin) => (
                <tr
                  key={admin.id}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
                  onClick={() => navigate(`/admins/${admin.id}`)}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-gold-500 to-gold-700 flex items-center justify-center flex-shrink-0">
                        <span className="text-white font-bold text-sm">{admin.email?.charAt(0).toUpperCase()}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900 dark:text-white">{admin.name || admin.email}</p>
                        <p className="text-xs text-slate-500">{admin.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border ${roleBadgeColors[admin.role] || roleBadgeColors.SUPPORT}`}>
                      {roleLabels[admin.role] || admin.role}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${admin.active ? 'text-emerald-400' : 'text-red-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${admin.active ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      {admin.active ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-slate-500">
                    {admin.lastLoginAt ? new Date(admin.lastLoginAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Jamais'}
                  </td>
                  <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2">
                      {hasPermission('admins', 'update') && (
                        <button
                          onClick={() => { setEditingAdmin(admin); setError(''); }}
                          className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-all"
                          title="Modifier"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                      )}
                      {hasPermission('admins', 'delete') && (
                        <button
                          onClick={() => { if (confirm('Désactiver cet admin ?')) deleteMutation.mutate(admin.id); }}
                          className="p-2 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-all"
                          title="Désactiver"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800/60 shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Nouvel administrateur</h2>
              <button onClick={() => { setShowCreateModal(false); setError(''); }} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            {error && <div className="mb-4 p-3 rounded-xl bg-red-500/10 text-red-400 text-sm">{error}</div>}
            <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(createForm); }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">Email</label>
                <input type="email" required value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} className="w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-gold-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">Nom</label>
                <input type="text" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} className="w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-gold-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">Mot de passe</label>
                <input type="password" required minLength={8} value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} className="w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-gold-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">Rôle</label>
                <select value={createForm.role} onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })} className="w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-gold-500 outline-none">
                  {ROLES.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}
                </select>
              </div>
              <button type="submit" disabled={createMutation.isPending} className="w-full py-2.5 rounded-xl bg-gold-500 hover:bg-gold-600 text-white text-sm font-medium transition-all disabled:opacity-50">
                {createMutation.isPending ? 'Création...' : 'Créer l\'admin'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingAdmin && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800/60 shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Modifier l'admin</h2>
              <button onClick={() => { setEditingAdmin(null); setError(''); }} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            {error && <div className="mb-4 p-3 rounded-xl bg-red-500/10 text-red-400 text-sm">{error}</div>}
            <div className="mb-4 text-sm text-slate-500">{editingAdmin.email}</div>
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              updateMutation.mutate({
                id: editingAdmin.id,
                data: {
                  role: formData.get('role') as string,
                  active: formData.get('active') === 'true',
                  name: formData.get('name') as string,
                },
              });
            }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">Nom</label>
                <input type="text" name="name" defaultValue={editingAdmin.name} className="w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-gold-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">Rôle</label>
                <select name="role" defaultValue={editingAdmin.role} className="w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-gold-500 outline-none">
                  {ROLES.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">Statut</label>
                <select name="active" defaultValue={String(editingAdmin.active)} className="w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-gold-500 outline-none">
                  <option value="true">Actif</option>
                  <option value="false">Inactif</option>
                </select>
              </div>
              <button type="submit" disabled={updateMutation.isPending} className="w-full py-2.5 rounded-xl bg-gold-500 hover:bg-gold-600 text-white text-sm font-medium transition-all disabled:opacity-50">
                {updateMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
