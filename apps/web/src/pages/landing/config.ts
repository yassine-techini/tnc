/**
 * Central configuration for landing page links.
 * Internal links use relative paths (react-router).
 * External links use full URLs.
 */
export const LINKS = {
  login: '/login',
  register: '/register',
  verify: '/verify',
  admin: 'https://bf-admin.tnc.trading',
  state: 'https://bf-state.tnc.trading',
  appStore: 'https://apps.apple.com/bf/app/tnc-trading/id0000000000',
  playStore: 'https://play.google.com/store/apps/details?id=com.tnc.trading',
};

/**
 * Detect if the user is on a mobile device and return the appropriate store link.
 */
export function getMobileStoreLink(): { store: 'ios' | 'android' | null; url: string } {
  if (typeof navigator === 'undefined') return { store: null, url: LINKS.login };

  const ua = navigator.userAgent.toLowerCase();

  if (/iphone|ipad|ipod/.test(ua)) {
    return { store: 'ios', url: LINKS.appStore };
  }

  if (/android/.test(ua)) {
    return { store: 'android', url: LINKS.playStore };
  }

  return { store: null, url: LINKS.login };
}

export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod|android/i.test(navigator.userAgent);
}
