import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAdminStore, startInactivityMonitor } from './stores/auth';
import AdminLayout from './components/AdminLayout';
import { ErrorBoundary } from './components/ErrorBoundary';

const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Users = lazy(() => import('./pages/Users'));
const UserDetail = lazy(() => import('./pages/UserDetail'));
const Transactions = lazy(() => import('./pages/Transactions'));
const Stock = lazy(() => import('./pages/Stock'));
const Withdrawals = lazy(() => import('./pages/Withdrawals'));
const KycReview = lazy(() => import('./pages/KycReview'));
const Reconciliation = lazy(() => import('./pages/Reconciliation'));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAdminStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  useEffect(() => { startInactivityMonitor(); }, []);

  return (
    <ErrorBoundary>
    <BrowserRouter>
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-slate-950"><div className="w-8 h-8 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" /></div>}>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <AdminLayout>
                  <ErrorBoundary>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/users" element={<Users />} />
                    <Route path="/users/:id" element={<UserDetail />} />
                    <Route path="/kyc" element={<KycReview />} />
                    <Route path="/transactions" element={<Transactions />} />
                    <Route path="/stock" element={<Stock />} />
                    <Route path="/reconciliation" element={<Reconciliation />} />
                    <Route path="/withdrawals" element={<Withdrawals />} />
                  </Routes>
                  </ErrorBoundary>
                </AdminLayout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
