import { Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { useAuthStore } from './stores/auth';
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

// Public pages (lazy loaded)
const Landing = lazy(() => import('./pages/Landing'));
const Login = lazy(() => import('./pages/auth/Login'));
const Register = lazy(() => import('./pages/auth/Register'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'));
const VerifyEmail = lazy(() => import('./pages/auth/VerifyEmail'));
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword'));

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
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <Routes>
        {/* Public routes */}
        <Route element={<PublicLayout />}>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/reset-password" element={<ResetPassword />} />
        </Route>

        {/* Protected routes */}
        <Route element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/marketplace" element={<Marketplace />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/kyc" element={<KYC />} />
          <Route path="/settings" element={<Settings />} />
        </Route>

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}

export default App;
