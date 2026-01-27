import { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAdminStore } from '../stores/auth';

const navigation = [
  { name: 'Tableau de bord', href: '/', icon: '📊' },
  { name: 'Utilisateurs', href: '/users', icon: '👥' },
  { name: 'Vérification KYC', href: '/kyc', icon: '🪪' },
  { name: 'Transactions', href: '/transactions', icon: '💳' },
  { name: 'Stock Or', href: '/stock', icon: '🪙' },
  { name: 'Reconciliation', href: '/reconciliation', icon: '⚖️' },
  { name: 'Retraits', href: '/withdrawals', icon: '📤' },
];

const getPageTitle = (pathname: string) => {
  const route = navigation.find(n => n.href === pathname);
  return route?.name || 'Administration';
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAdminStore();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950">
      {/* Header */}
      <header className="h-16 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800/60 flex items-center justify-between px-6 z-20 sticky top-0">
        <div className="flex items-center gap-4">
          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 rounded-xl hover:bg-slate-800 transition-all"
          >
            <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>

          {/* Desktop collapse button */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="hidden lg:flex p-2 rounded-xl hover:bg-slate-800 transition-all text-slate-500 hover:text-slate-300"
            title={sidebarCollapsed ? 'Étendre le menu' : 'Réduire le menu'}
          >
            <svg className={`w-4 h-4 transition-transform duration-300 ${sidebarCollapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>

          <div className="hidden sm:block">
            <h1 className="text-sm font-semibold text-white">
              {getPageTitle(location.pathname)}
            </h1>
            <p className="text-[11px] text-slate-500">TNC Trading Admin</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Notification bell */}
          <button className="relative p-2.5 rounded-xl hover:bg-slate-800 transition-all text-slate-500 hover:text-slate-300">
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </button>

          <div className="w-px h-6 bg-slate-800" />

          <div className="flex items-center gap-3">
            <div className="hidden md:block text-right">
              <p className="text-xs font-medium text-slate-300">{user?.email}</p>
              <p className="text-[10px] text-slate-600">{user?.role === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin'}</p>
            </div>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-gold-500 to-gold-700 flex items-center justify-center shadow-lg shadow-gold-500/10">
              <span className="text-white font-bold text-sm">
                {user?.email?.charAt(0).toUpperCase()}
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Mobile menu overlay */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 lg:hidden animate-fade-in"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={`
            fixed lg:relative inset-y-0 left-0 z-40 lg:z-0
            ${sidebarCollapsed ? 'lg:w-[72px]' : 'lg:w-[260px]'}
            ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
            w-[260px] bg-slate-950 border-r border-slate-800/60 flex flex-col
            transition-all duration-300 ease-in-out
            pt-16 lg:pt-0
          `}
        >
          {/* Logo */}
          <div className={`p-5 border-b border-slate-800/60 ${sidebarCollapsed ? 'lg:px-3 lg:py-4' : ''}`}>
            <div className={`flex items-center gap-3 ${sidebarCollapsed ? 'lg:justify-center' : ''}`}>
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gold-500 to-gold-700 flex items-center justify-center flex-shrink-0 shadow-lg shadow-gold-500/20">
                <span className="text-white font-extrabold text-base">T</span>
              </div>
              <div className={`${sidebarCollapsed ? 'lg:hidden' : ''}`}>
                <h1 className="text-base font-bold text-white tracking-tight">TNC Admin</h1>
                <p className="text-[10px] text-slate-600 font-medium uppercase tracking-widest">Back-office</p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4 space-y-1">
            {navigation.map((item) => (
              <NavLink
                key={item.href}
                to={item.href}
                end={item.href === '/'}
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200
                  ${isActive
                    ? 'bg-gold-500/10 text-gold-500 font-medium'
                    : 'text-slate-500 hover:bg-slate-800/60 hover:text-slate-200'
                  }
                  ${sidebarCollapsed ? 'lg:justify-center lg:px-2' : ''}
                  `
                }
                title={sidebarCollapsed ? item.name : undefined}
              >
                <span className="text-lg flex-shrink-0">{item.icon}</span>
                <span className={`text-[13px] ${sidebarCollapsed ? 'lg:hidden' : ''}`}>{item.name}</span>
              </NavLink>
            ))}
          </nav>

          {/* User section */}
          <div className={`p-3 border-t border-slate-800/60 ${sidebarCollapsed ? 'lg:px-2' : ''}`}>
            <div className={`flex items-center gap-3 mb-3 px-2 ${sidebarCollapsed ? 'lg:justify-center lg:px-0' : ''}`}>
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-gold-500 to-gold-700 flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold text-xs">
                  {user?.email?.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className={`flex-1 min-w-0 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
                <p className="text-xs font-medium text-slate-300 truncate">{user?.email}</p>
                <p className="text-[10px] text-slate-600">{user?.role}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium
                text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200
                ${sidebarCollapsed ? 'lg:p-2.5' : ''}`}
              title={sidebarCollapsed ? 'Déconnexion' : undefined}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className={`${sidebarCollapsed ? 'lg:hidden' : ''}`}>Déconnexion</span>
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto flex flex-col scrollbar-thin">
          <div className="flex-1 p-4 md:p-6 lg:p-8 animate-fade-in">
            {children}
          </div>

          {/* Footer */}
          <footer className="border-t border-slate-800/40 px-6 py-3">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-600">
              <p>&copy; {new Date().getFullYear()} TNC Trading - Burkina Faso</p>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Système opérationnel
                </span>
                <span>v1.0.0</span>
              </div>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
