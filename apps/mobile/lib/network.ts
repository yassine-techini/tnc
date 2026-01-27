/**
 * Network monitor for offline detection.
 * Uses @react-native-community/netinfo for reliable connectivity detection.
 * Wires into React Query's onlineManager so queries pause when offline.
 */

import { onlineManager } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';

type NetworkListener = (isOnline: boolean) => void;

class NetworkMonitor {
  private listeners: NetworkListener[] = [];
  private _isOnline = true;
  private _connectionType: string | null = null;

  get isOnline() {
    return this._isOnline;
  }

  /** Returns 'wifi', 'cellular', 'ethernet', etc. */
  get connectionType() {
    return this._connectionType;
  }

  /**
   * Initialize with React Query's onlineManager.
   * Call once in _layout.tsx.
   */
  init() {
    // Subscribe to NetInfo state changes
    NetInfo.addEventListener((state) => {
      const online = state.isConnected !== false && state.isInternetReachable !== false;
      this._connectionType = state.type;
      this.setOnline(online);
    });

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
