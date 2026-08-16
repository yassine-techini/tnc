import { Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore, startInactivityMonitor } from './stores/auth';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import api from './lib/api';

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

// Smart root: authenticated → dashboard, otherwise → landing page
function RootPage() {
  const { isAuthenticated, _hasHydrated } = useAuthStore();
  if (!_hasHydrated) return <PageLoader />;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <Landing />;
}

// Landing page (lazy loaded)
const Landing = lazy(() => import('./pages/landing/Landing'));

// Public pages (lazy loaded)
const Login = lazy(() => import('./pages/auth/Login'));
const Register = lazy(() => import('./pages/auth/Register'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'));
const VerifyEmail = lazy(() => import('./pages/auth/VerifyEmail'));
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword'));
const VerifyCertificate = lazy(() => import('./pages/VerifyCertificate'));
const VerifyReserve = lazy(() => import('./pages/VerifyReserve'));

// Protected pages (lazy loaded)
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Marketplace = lazy(() => import('./pages/Marketplace'));
const Wallet = lazy(() => import('./pages/Wallet'));
const Transactions = lazy(() => import('./pages/Transactions'));
const Lease = lazy(() => import('./pages/Lease'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Profile = lazy(() => import('./pages/Profile'));
const KYC = lazy(() => import('./pages/KYC'));
const Settings = lazy(() => import('./pages/Settings'));
const ProducerConsignments = lazy(() => import('./pages/ProducerConsignments'));
const ProducerProfile = lazy(() => import('./pages/ProducerProfile'));

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

/**
 * Producer-only guard, nested inside ProtectedRoute (so the user is already
 * authenticated here). The API is the real boundary — /producer/* answers 403
 * NOT_A_PRODUCER regardless — this just stops an investor landing on a screen
 * that can only fail for them.
 */
function ProducerRoute({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: ['profile-role'],
    queryFn: () => api.getProfile(),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <PageLoader />;
  if (data?.data?.role !== 'producer') return <Navigate to="/dashboard" replace />;
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
          {/* Reserve verification is public: that is the point of an attestation. */}
          <Route path="/reserve" element={<VerifyReserve />} />
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
          <Route path="/lease" element={<ErrorBoundary><Lease /></ErrorBoundary>} />
          <Route path="/transactions" element={<ErrorBoundary><Transactions /></ErrorBoundary>} />
          <Route path="/analytics" element={<ErrorBoundary><Analytics /></ErrorBoundary>} />
          <Route path="/profile" element={<ErrorBoundary><Profile /></ErrorBoundary>} />
          <Route path="/kyc" element={<ErrorBoundary><KYC /></ErrorBoundary>} />
          <Route path="/consignments" element={<ProducerRoute><ErrorBoundary><ProducerConsignments /></ErrorBoundary></ProducerRoute>} />
          <Route path="/producer-profile" element={<ProducerRoute><ErrorBoundary><ProducerProfile /></ErrorBoundary></ProducerRoute>} />
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
