/**
 * Network monitor for offline detection and mutation queueing.
 * Uses @react-native-community/netinfo when available, falls back to navigator.onLine.
 */

import { onlineManager } from '@tanstack/react-query';

type NetworkListener = (isOnline: boolean) => void;

class NetworkMonitor {
  private listeners: NetworkListener[] = [];
  private _isOnline = true;

  get isOnline() {
    return this._isOnline;
  }

  /**
   * Initialize with React Query's onlineManager.
   * Call this once in _layout.tsx.
   */
  init() {
    // Try to use NetInfo if available (installed as peer dep)
    try {
      // Dynamic import to avoid hard crash if not installed
      const NetInfo = require('@react-native-community/netinfo');
      NetInfo.addEventListener((state: { isConnected: boolean | null }) => {
        const online = state.isConnected !== false;
        this.setOnline(online);
      });
    } catch {
      // Fallback: no NetInfo, just assume online
      // React Query will handle fetch errors gracefully
      console.warn('NetInfo not available, using online-only mode');
    }

    // Wire into React Query's online manager
    onlineManager.setEventListener((setOnline) => {
      const unsubscribe = this.subscribe(setOnline);
      return unsubscribe;
    });
  }

  private setOnline(online: boolean) {
    if (this._isOnline !== online) {
      this._isOnline = online;
      this.listeners.forEach((fn) => fn(online));
    }
  }

  subscribe(listener: NetworkListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((fn) => fn !== listener);
    };
  }
}

export const networkMonitor = new NetworkMonitor();
