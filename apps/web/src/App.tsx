import { Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy, useEffect } from 'react';
import { useAuthStore, startInactivityMonitor } from './stores/auth';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

// Layouts (loaded eagerly as they're needed immediately)
import PublicLayout from './layouts/PublicLayout';
import AppLayout from './layouts/AppLayout';

// Loading fallback component
function PageLoader() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-gold-500"></div>
    </div>
  );
}

// Smart root: authenticated → dashboard, otherwise → login.
// The public landing page now lives in the standalone `apps/landing` deployment.
function RootPage() {
  const { isAuthenticated, _hasHydrated } = useAuthStore();
  if (!_hasHydrated) return <PageLoader />;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <Navigate to="/login" replace />;
}

// Public pages (lazy loaded)
const Login = lazy(() => import('./pages/auth/Login'));
const Register = lazy(() => import('./pages/auth/Register'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'));
const VerifyEmail = lazy(() => import('./pages/auth/VerifyEmail'));
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword'));
const VerifyCertificate = lazy(() => import('./pages/VerifyCertificate'));

// Protected pages (lazy loaded)
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Marketplace = lazy(() => import('./pages/Marketplace'));
const Wallet = lazy(() => import('./pages/Wallet'));
const Transactions = lazy(() => import('./pages/Transactions'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Profile = lazy(() => import('./pages/Profile'));
const KYC = lazy(() => import('./pages/KYC'));
const Settings = lazy(() => import('./pages/Settings'));

// Route guard component
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, _hasHydrated } = useAuthStore();

  // Wait for hydration from localStorage before making any decisions
  if (!_hasHydrated || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-gold-500"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function App() {
  useEffect(() => { startInactivityMonitor(); }, []);
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <Routes>
        {/* Landing page (standalone, no layout wrapper) */}
        <Route path="/" element={<RootPage />} />

        {/* Public routes */}
        <Route element={<PublicLayout />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify" element={<VerifyCertificate />} />
          <Route path="/verify/:code" element={<VerifyCertificate />} />
        </Route>

        {/* Protected routes - each with individual ErrorBoundary */}
        <Route element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }>
          <Route path="/dashboard" element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
          <Route path="/marketplace" element={<ErrorBoundary><Marketplace /></ErrorBoundary>} />
          <Route path="/wallet" element={<ErrorBoundary><Wallet /></ErrorBoundary>} />
          <Route path="/transactions" element={<ErrorBoundary><Transactions /></ErrorBoundary>} />
          <Route path="/analytics" element={<ErrorBoundary><Analytics /></ErrorBoundary>} />
          <Route path="/profile" element={<ErrorBoundary><Profile /></ErrorBoundary>} />
          <Route path="/kyc" element={<ErrorBoundary><KYC /></ErrorBoundary>} />
          <Route path="/settings" element={<ErrorBoundary><Settings /></ErrorBoundary>} />
        </Route>

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}

export default App;
