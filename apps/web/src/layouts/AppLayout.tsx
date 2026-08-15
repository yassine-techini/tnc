import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../stores/auth';
import { preloadRoute, preloadCriticalRoutes } from '../lib/preload';
import { ThemeToggle } from '@tnc-trading/ui';
import api from '../lib/api';

const producerNavItem = { name: 'Mes lots', href: '/consignments', icon: '📦' };

const navigation = [
  { name: 'Tableau de bord', href: '/dashboard', icon: '📊' },
  { name: 'Marketplace', href: '/marketplace', icon: '💰' },
  { name: 'Portefeuille', href: '/wallet', icon: '👛' },
  { name: 'Transactions', href: '/transactions', icon: '📋' },
  { name: 'Analyses', href: '/analytics', icon: '📈' },
];

const secondaryNav = [
  { name: 'Profil', href: '/profile', icon: '👤' },
  { name: 'KYC', href: '/kyc', icon: '✓' },
  { name: 'Paramètres', href: '/settings', icon: '⚙️' },
];

const getPageTitle = (pathname: string) => {
  const allNav = [...navigation, ...secondaryNav];
  const route = allNav.find(n => n.href === pathname);
  return route?.name || 'TNC Trading';
};

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { data: profile } = useQuery({ queryKey: ['profile-role'], queryFn: () => api.getProfile(), staleTime: 5 * 60 * 1000 });
  const isProducer = profile?.data?.role === 'producer';
  const mainNav = isProducer ? [...navigation, producerNavItem] : navigation;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Preload critical routes after mount
  useEffect(() => {
    preloadCriticalRoutes();
  }, []);

  const isActive = (href: string) => location.pathname === href;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 dark:bg-slate-950">
      {/* Header */}
      <header className="h-16 bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl border-b border-slate-200 dark:border-slate-800/60 flex items-center justify-between px-6 z-20 sticky top-0">
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
            <p className="text-[11px] text-slate-500">TNC Trading</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* KYC Level badge */}
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-gold-500/10 border border-gold-500/20 rounded-xl">
            <span className="w-1.5 h-1.5 rounded-full bg-gold-500" />
            <span className="text-[11px] font-medium text-gold-400">KYC: {user?.kycLevel || 'BASIC'}</span>
          </div>

          <ThemeToggle />

          <div className="w-px h-6 bg-slate-800 dark:bg-slate-800 bg-slate-200" />

          <div className="flex items-center gap-3">
            <div className="hidden md:block text-right">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{user?.email}</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-600">{user?.kycLevel || 'BASIC'}</p>
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
            w-[260px] bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800/60 flex flex-col
            transition-all duration-300 ease-in-out
            pt-16 lg:pt-0
          `}
        >
          {/* Logo */}
          <div className={`p-5 border-b border-slate-200 dark:border-slate-800/60 ${sidebarCollapsed ? 'lg:px-3 lg:py-4' : ''}`}>
            <Link
              to="/dashboard"
              className={`flex items-center gap-3 ${sidebarCollapsed ? 'lg:justify-center' : ''}`}
              onClick={() => setMobileMenuOpen(false)}
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gold-500 to-gold-700 flex items-center justify-center flex-shrink-0 shadow-lg shadow-gold-500/20">
                <span className="text-white font-extrabold text-base">T</span>
              </div>
              <div className={`${sidebarCollapsed ? 'lg:hidden' : ''}`}>
                <h1 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">TNC Trading</h1>
                <p className="text-[10px] text-slate-400 dark:text-slate-600 font-medium uppercase tracking-widest">Or Souverain</p>
              </div>
            </Link>
          </div>

          {/* Main navigation */}
          <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4 space-y-1">
            {mainNav.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setMobileMenuOpen(false)}
                onMouseEnter={() => preloadRoute(item.href)}
                onFocus={() => preloadRoute(item.href)}
                className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200
                  ${isActive(item.href)
                    ? 'bg-gold-500/10 text-gold-500 font-medium'
                    : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-200'
                  }
                  ${sidebarCollapsed ? 'lg:justify-center lg:px-2' : ''}
                `}
                title={sidebarCollapsed ? item.name : undefined}
              >
                <span className="text-lg flex-shrink-0">{item.icon}</span>
                <span className={`text-[13px] ${sidebarCollapsed ? 'lg:hidden' : ''}`}>{item.name}</span>
              </Link>
            ))}

            <div className="pt-3 mt-3 border-t border-slate-200 dark:border-slate-800/60 space-y-1">
              {secondaryNav.map((item) => (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  onMouseEnter={() => preloadRoute(item.href)}
                  onFocus={() => preloadRoute(item.href)}
                  className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200
                    ${isActive(item.href)
                      ? 'bg-gold-500/10 text-gold-500 font-medium'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-200'
                    }
                    ${sidebarCollapsed ? 'lg:justify-center lg:px-2' : ''}
                  `}
                  title={sidebarCollapsed ? item.name : undefined}
                >
                  <span className="text-lg flex-shrink-0">{item.icon}</span>
                  <span className={`text-[13px] ${sidebarCollapsed ? 'lg:hidden' : ''}`}>{item.name}</span>
                </Link>
              ))}
            </div>
          </nav>

          {/* User section */}
          <div className={`p-3 border-t border-slate-200 dark:border-slate-800/60 ${sidebarCollapsed ? 'lg:px-2' : ''}`}>
            <div className={`flex items-center gap-3 mb-3 px-2 ${sidebarCollapsed ? 'lg:justify-center lg:px-0' : ''}`}>
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-gold-500 to-gold-700 flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold text-xs">
                  {user?.email?.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className={`flex-1 min-w-0 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
                <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">{user?.email}</p>
                <p className="text-[10px] text-slate-400 dark:text-slate-600">KYC: {user?.kycLevel || 'BASIC'}</p>
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
            <Outlet />
          </div>

          {/* Footer */}
          <footer className="border-t border-slate-200 dark:border-slate-800/40 px-6 py-3">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-400 dark:text-slate-600">
              <p>&copy; {new Date().getFullYear()} TNC Trading - Tokenisation d'Or Souveraine</p>
              <div className="flex items-center gap-4">
                <a href="#" className="hover:text-slate-400 transition-colors">Conditions</a>
                <a href="#" className="hover:text-slate-400 transition-colors">Confidentialité</a>
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
