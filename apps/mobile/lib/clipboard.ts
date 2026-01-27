/**
 * Secure clipboard handling
 * Auto-clears clipboard after a timeout when copying sensitive data.
 */

import * as Clipboard from 'expo-clipboard';

const CLIPBOARD_CLEAR_DELAY_MS = 30_000; // 30 seconds

let clearTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Copy sensitive data to clipboard and auto-clear after 30 seconds.
 * Use for backup codes, 2FA secrets, wallet addresses, etc.
 */
export async function secureCopy(text: string): Promise<void> {
  // Clear any pending timer
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }

  await Clipboard.setStringAsync(text);

  // Schedule auto-clear
  clearTimer = setTimeout(async () => {
    try {
      // Only clear if clipboard still contains our data
      const current = await Clipboard.getStringAsync();
      if (current === text) {
        await Clipboard.setStringAsync('');
      }
    } catch {
      // Clipboard access may fail silently
    }
    clearTimer = null;
  }, CLIPBOARD_CLEAR_DELAY_MS);
}

/**
 * Immediately clear the clipboard.
 */
export async function clearClipboard(): Promise<void> {
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
  try {
    await Clipboard.setStringAsync('');
  } catch {
    // Ignore
  }
}
