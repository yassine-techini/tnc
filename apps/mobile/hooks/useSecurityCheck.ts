import { useEffect, useState } from 'react';

interface SecurityCheckResult {
  isSecure: boolean;
  warnings: string[];
  isDevMode: boolean;
}

export function useSecurityCheck(): SecurityCheckResult {
  const [result, setResult] = useState<SecurityCheckResult>({
    isSecure: true,
    warnings: [],
    isDevMode: __DEV__,
  });

  useEffect(() => {
    const warnings: string[] = [];

    if (__DEV__) {
      warnings.push('Mode developpement actif');
    }

    setResult({
      isSecure: warnings.length === 0,
      warnings,
      isDevMode: __DEV__,
    });
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
