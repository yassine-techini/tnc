/**
 * Route preloading utilities for faster navigation
 * Preloads page chunks on hover/focus for instant navigation
 */

import { QueryClient } from '@tanstack/react-query';
import api from './api';
import { queryKeys, staleTimes } from './query-keys';

// Map of routes to their dynamic import functions
const routePreloaders: Record<string, () => Promise<unknown>> = {
  '/dashboard': () => import('../pages/Dashboard'),
  '/marketplace': () => import('../pages/Marketplace'),
  '/wallet': () => import('../pages/Wallet'),
  '/transactions': () => import('../pages/Transactions'),
  '/analytics': () => import('../pages/Analytics'),
  '/profile': () => import('../pages/Profile'),
  '/kyc': () => import('../pages/KYC'),
  '/settings': () => import('../pages/Settings'),
  '/': () => import('../pages/Landing'),
  '/login': () => import('../pages/auth/Login'),
  '/register': () => import('../pages/auth/Register'),
};

// Cache to track preloaded routes
const preloadedRoutes = new Set<string>();

/**
 * Preload a route's chunk
 * Only preloads once per route per session
 */
export function preloadRoute(path: string): void {
  const normalizedPath = path.split('?')[0];
  if (preloadedRoutes.has(normalizedPath)) return;

  const preloader = routePreloaders[normalizedPath];
  if (preloader) {
    preloadedRoutes.add(normalizedPath);
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => preloader());
    } else {
      setTimeout(() => preloader(), 100);
    }
  }
}

/**
 * Event handlers for preloading on hover/focus
 */
export function handlePreloadHover(path: string) {
  return () => preloadRoute(path);
}

/**
 * Preload critical routes after initial page load
 */
export function preloadCriticalRoutes(): void {
  const criticalRoutes = ['/dashboard', '/marketplace', '/wallet'];

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => {
      criticalRoutes.forEach(route => {
        const preloader = routePreloaders[route];
        if (preloader && !preloadedRoutes.has(route)) {
          preloadedRoutes.add(route);
          preloader();
        }
      });
    });
  }
}

// ---- React Query data prefetching ----

export function prefetchDashboard(queryClient: QueryClient, token: string) {
  queryClient.prefetchQuery({
    queryKey: queryKeys.price,
    queryFn: () => api.getPrice(),
    staleTime: staleTimes.price,
  });
  queryClient.prefetchQuery({
    queryKey: queryKeys.wallet,
    queryFn: () => api.getWallet(token),
    staleTime: staleTimes.wallet,
  });
}

export function prefetchMarketplace(queryClient: QueryClient) {
  queryClient.prefetchQuery({
    queryKey: queryKeys.price,
    queryFn: () => api.getPrice(),
    staleTime: staleTimes.price,
  });
  queryClient.prefetchQuery({
    queryKey: queryKeys.stock,
    queryFn: () => api.getStock(),
    staleTime: staleTimes.stock,
  });
}

export function prefetchWallet(queryClient: QueryClient, token: string) {
  queryClient.prefetchQuery({
    queryKey: queryKeys.wallet,
    queryFn: () => api.getWallet(token),
    staleTime: staleTimes.wallet,
  });
}
