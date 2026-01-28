import { Outlet, Link } from 'react-router-dom';
import { ThemeToggle } from '@tnc-trading/ui';

export default function PublicLayout() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 dark:border-slate-800">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/login" className="flex items-center gap-2">
            <div className="w-10 h-10 bg-gold-500 rounded-lg flex items-center justify-center">
              <span className="text-slate-900 font-bold text-xl">T</span>
            </div>
            <span className="text-xl font-bold text-slate-900 dark:text-white">TNC Trading</span>
          </Link>

          <nav className="flex items-center gap-4">
            <ThemeToggle />
            <Link to="/login" className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors">
              Connexion
            </Link>
            <Link to="/register" className="btn-primary">
              Créer un compte
            </Link>
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main>
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 py-8 mt-auto">
        <div className="container mx-auto px-4 text-center text-slate-500 dark:text-slate-400 text-sm">
          <p>© 2025 TNC Trading. Tous droits réservés.</p>
          <p className="mt-2">Plateforme en cours d'agrement - Partenariat Etat du Burkina Faso</p>
        </div>
      </footer>
    </div>
  );
}
