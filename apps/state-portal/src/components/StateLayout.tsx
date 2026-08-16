import { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useStateStore } from '../stores/auth';
import { ThemeToggle } from '@tnc-trading/ui';

const navigation = [
  { name: 'Vue d\'ensemble', href: '/', icon: '📊' },
  { name: 'Stock d\'Or', href: '/stock', icon: '🪙' },
  { name: 'Traçabilité', href: '/tracabilite', icon: '🔗' },
  { name: 'Rapports', href: '/reports', icon: '📈' },
];

const getPageTitle = (pathname: string) => {
  const route = navigation.find(n => n.href === pathname);
  return route?.name || 'Portail État';
};

export default function StateLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useStateStore();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 dark:bg-slate-900">
      {/* Header */}
      <header className="h-16 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-4 z-20 sticky top-0">
        <div className="flex items-center gap-4">
          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 rounded-lg hover:bg-slate-700 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Desktop collapse button */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="hidden lg:flex p-2 rounded-lg hover:bg-slate-700 transition-colors"
            title={sidebarCollapsed ? 'Étendre le menu' : 'Réduire le menu'}
          >
            <svg className={`w-5 h-5 transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>

          <div className="flex items-center gap-2">
            <span className="text-xl">🏛️</span>
            <h1 className="text-lg font-semibold text-state-500 hidden sm:block">
              {getPageTitle(location.pathname)}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-state-500/10 border border-state-500/30 rounded-full">
            <span className="text-xs">🔒</span>
            <span className="text-xs text-state-400">Lecture seule</span>
          </div>
          <ThemeToggle />
          <span className="text-sm text-slate-500 dark:text-slate-400 hidden lg:block">{user?.ministry}</span>
          <div className="w-8 h-8 rounded-full bg-state-500/20 flex items-center justify-center">
            <span className="text-state-500 font-bold text-sm">
              {user?.email?.charAt(0).toUpperCase()}
            </span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Mobile menu overlay */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-30 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={`
            fixed lg:relative inset-y-0 left-0 z-40 lg:z-0
            ${sidebarCollapsed ? 'lg:w-20' : 'lg:w-72'}
            ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
            w-72 bg-slate-800 border-r border-slate-700 flex flex-col
            transition-all duration-300 ease-in-out
            pt-16 lg:pt-0
          `}
        >
          {/* Logo */}
          <div className={`p-4 border-b border-slate-700 ${sidebarCollapsed ? 'lg:px-2' : ''}`}>
            <div className={`flex items-center gap-3 ${sidebarCollapsed ? 'lg:justify-center' : ''}`}>
              <div className="w-12 h-12 bg-state-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                <span className="text-state-500 text-2xl">🏛️</span>
              </div>
              <div className={`${sidebarCollapsed ? 'lg:hidden' : ''}`}>
                <h1 className="text-lg font-bold text-state-500">Portail État</h1>
                <p className="text-xs text-slate-400">Burkina Faso</p>
              </div>
            </div>
          </div>

          {/* Navigation - Scrollable */}
          <nav className="flex-1 overflow-y-auto p-3 space-y-1">
            {navigation.map((item) => (
              <NavLink
                key={item.href}
                to={item.href}
                end={item.href === '/'}
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-3 rounded-lg transition-colors
                  ${isActive
                    ? 'bg-state-500/20 text-state-500'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  }
                  ${sidebarCollapsed ? 'lg:justify-center lg:px-2' : ''}
                  `
                }
                title={sidebarCollapsed ? item.name : undefined}
              >
                <span className="text-xl">{item.icon}</span>
                <span className={`${sidebarCollapsed ? 'lg:hidden' : ''}`}>{item.name}</span>
              </NavLink>
            ))}
          </nav>

          {/* User section */}
          <div className={`p-3 border-t border-slate-700 ${sidebarCollapsed ? 'lg:px-2' : ''}`}>
            <div className={`mb-3 p-3 bg-slate-900/50 rounded-lg ${sidebarCollapsed ? 'lg:p-2' : ''}`}>
              <div className={`flex items-center gap-3 ${sidebarCollapsed ? 'lg:justify-center' : ''}`}>
                <div className="w-10 h-10 rounded-full bg-state-500/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-state-500 font-bold">
                    {user?.email?.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className={`flex-1 min-w-0 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
                  <p className="text-xs text-slate-400">Connecté en tant que</p>
                  <p className="text-sm font-medium truncate">{user?.email}</p>
                  <p className="text-xs text-state-400">{user?.ministry}</p>
                </div>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className={`w-full btn-secondary text-sm flex items-center justify-center gap-2 ${sidebarCollapsed ? 'lg:p-2' : ''}`}
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
        <main className="flex-1 overflow-auto flex flex-col">
          <div className="flex-1 p-4 md:p-6 lg:p-8">
            {/* Info banner */}
            <div className="mb-6 p-3 bg-state-500/10 border border-state-500/30 rounded-lg lg:hidden">
              <div className="flex items-center gap-2 text-state-400 text-sm">
                <span>🔒</span>
                <span>Portail en lecture seule - Données officielles</span>
              </div>
            </div>
            {children}
          </div>

          {/* Footer */}
          <footer className="bg-slate-800 border-t border-slate-700 px-4 py-3">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-400">
              <p>&copy; {new Date().getFullYear()} Ministère des Mines et des Carrières - Burkina Faso</p>
              <p>Portail de Supervision TNC Trading v1.0.0</p>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
