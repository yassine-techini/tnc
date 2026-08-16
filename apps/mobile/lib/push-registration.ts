/**
 * Device registration for push notifications.
 *
 * IMPORTANT — which token.
 * `getExpoPushTokenAsync()` returns an `ExponentPushToken[...]`, which is routed
 * through Expo's own push service. The API sends through **FCM HTTP v1
 * directly**, so an Expo token would be accepted here and then never deliver
 * anything. `getDevicePushTokenAsync()` is what returns the native FCM (Android)
 * or APNs (iOS) token the backend can actually address.
 *
 * Registration is best-effort: a user who declines notifications, or a build
 * without a projectId, must still be able to log in.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

export type PushPlatform = 'ios' | 'android' | 'web';

let lastRegisteredToken: string | null = null;

function currentPlatform(): PushPlatform {
  return Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
}

/**
 * Ask for permission if needed and return the native device token, or null when
 * push is unavailable (declined, simulator, unsupported platform).
 */
export async function getDeviceToken(): Promise<string | null> {
  try {
    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;

    if (!granted && existing.canAskAgain) {
      const asked = await Notifications.requestPermissionsAsync();
      granted = asked.granted;
    }
    if (!granted) return null;

    // Native token, NOT the Expo one — see the note at the top of this file.
    const devicePushToken = await Notifications.getDevicePushTokenAsync();
    return typeof devicePushToken.data === 'string' ? devicePushToken.data : null;
  } catch {
    // Simulators and misconfigured builds throw here; push simply stays off.
    return null;
  }
}

/**
 * Register this installation against the logged-in account. Safe to call on
 * every launch: the API upserts on the token, so repeated calls do not create
 * duplicate devices.
 */
export async function registerForPush(): Promise<boolean> {
  const token = await getDeviceToken();
  if (!token) return false;

  try {
    await api.registerDevice(token, currentPlatform());
    lastRegisteredToken = token;
    return true;
  } catch {
    // Never block a login on a notification-registration failure.
    return false;
  }
}

/**
 * Stop notifying this installation. Called on logout so the next person to use
 * the device does not receive the previous account's notifications.
 */
export async function unregisterForPush(): Promise<void> {
  const token = lastRegisteredToken ?? (await getDeviceToken());
  if (!token) return;
  try {
    await api.unregisterDevice(token);
  } catch {
    // Logout must proceed regardless.
  } finally {
    lastRegisteredToken = null;
  }
}
