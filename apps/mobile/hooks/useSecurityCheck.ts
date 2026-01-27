import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import Constants from 'expo-constants';

interface SecurityCheckResult {
  isSecure: boolean;
  warnings: string[];
  isDevMode: boolean;
  isRooted: boolean;
}

/** Check for common jailbreak/root indicators */
async function detectRootOrJailbreak(): Promise<boolean> {
  if (__DEV__) return false; // Skip in development

  try {
    if (Platform.OS === 'ios') {
      // Check for common jailbreak paths
      const jailbreakPaths = [
        '/Applications/Cydia.app',
        '/Library/MobileSubstrate/MobileSubstrate.dylib',
        '/bin/bash',
        '/usr/sbin/sshd',
        '/etc/apt',
        '/private/var/lib/apt/',
        '/usr/bin/ssh',
      ];
      for (const path of jailbreakPaths) {
        try {
          const info = await FileSystem.getInfoAsync(path);
          if (info.exists) return true;
        } catch {
          // Path not accessible — expected on non-jailbroken device
        }
      }
    }

    if (Platform.OS === 'android') {
      // Check for common root indicators
      const rootPaths = [
        '/system/app/Superuser.apk',
        '/system/xbin/su',
        '/system/bin/su',
        '/sbin/su',
        '/data/local/xbin/su',
        '/data/local/bin/su',
        '/data/local/su',
      ];
      for (const path of rootPaths) {
        try {
          const info = await FileSystem.getInfoAsync(path);
          if (info.exists) return true;
        } catch {
          // Expected on non-rooted device
        }
      }
    }
  } catch {
    // If check fails, assume safe
  }

  return false;
}

/** Check for debugger attachment */
function isDebuggerAttached(): boolean {
  if (__DEV__) return false;
  // expo-constants exposes debuggerHost when Metro is attached
  return !!(Constants.expoConfig?.hostUri || (Constants as any).debuggerHost);
}

export function useSecurityCheck(): SecurityCheckResult {
  const [result, setResult] = useState<SecurityCheckResult>({
    isSecure: true,
    warnings: [],
    isDevMode: __DEV__,
    isRooted: false,
  });

  useEffect(() => {
    const runChecks = async () => {
      const warnings: string[] = [];

      if (__DEV__) {
        warnings.push('Mode developpement actif');
      }

      const rooted = await detectRootOrJailbreak();
      if (rooted) {
        warnings.push('Appareil rooté/jailbreaké détecté');
      }

      if (isDebuggerAttached()) {
        warnings.push('Débogueur détecté');
      }

      setResult({
        isSecure: warnings.length === 0,
        warnings,
        isDevMode: __DEV__,
        isRooted: rooted,
      });
    };

    runChecks();
  }, []);

  return result;
}

// Screen capture protection stubs
// Install expo-screen-capture for full functionality:
// npx expo install expo-screen-capture
let screenCaptureModule: any = null;

try {
  screenCaptureModule = require('expo-screen-capture');
} catch {
  // Module not installed - functions will be no-ops
}

export async function preventScreenCapture(): Promise<void> {
  if (screenCaptureModule?.preventScreenCaptureAsync) {
    await screenCaptureModule.preventScreenCaptureAsync();
  }
}

export async function allowScreenCapture(): Promise<void> {
  if (screenCaptureModule?.allowScreenCaptureAsync) {
    await screenCaptureModule.allowScreenCaptureAsync();
  }
}
