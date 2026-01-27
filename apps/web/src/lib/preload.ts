/**
 * Route preloading utilities for faster navigation
 * Preloads page chunks on hover/focus for instant navigation
 */

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
  // Normalize path
  const normalizedPath = path.split('?')[0];

  // Skip if already preloaded
  if (preloadedRoutes.has(normalizedPath)) return;

  // Get preloader for this route
  const preloader = routePreloaders[normalizedPath];

  if (preloader) {
    preloadedRoutes.add(normalizedPath);
    // Use requestIdleCallback if available for non-blocking preload
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => preloader());
    } else {
      // Fallback: preload after a short delay
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
 * Call this after the app has mounted
 */
export function preloadCriticalRoutes(): void {
  // Wait for idle time to preload critical routes
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
