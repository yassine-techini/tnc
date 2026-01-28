/**
 * Central configuration for all external links.
 * Update these when deploying to production domains.
 */
export const LINKS = {
  platform: 'https://tnc-trading-web.pages.dev',
  login: 'https://tnc-trading-web.pages.dev/login',
  register: 'https://tnc-trading-web.pages.dev/register',
  verify: 'https://tnc-trading-web.pages.dev/verify',
  admin: 'https://tnc-trading-admin.pages.dev',
  state: 'https://tnc-trading-state.pages.dev',
  appStore: '#', // TODO: replace with actual App Store link after publication
  playStore: '#', // TODO: replace with actual Play Store link after publication
};

/**
 * Detect if the user is on a mobile device and return the appropriate store link.
 */
export function getMobileStoreLink(): { store: 'ios' | 'android' | null; url: string } {
  if (typeof navigator === 'undefined') return { store: null, url: LINKS.platform };

  const ua = navigator.userAgent.toLowerCase();

  if (/iphone|ipad|ipod/.test(ua)) {
    return { store: 'ios', url: LINKS.appStore };
  }

  if (/android/.test(ua)) {
    return { store: 'android', url: LINKS.playStore };
  }

  return { store: null, url: LINKS.platform };
}

export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod|android/i.test(navigator.userAgent);
}
