/**
 * Origin position capture for a gold lot.
 *
 * A device fix is evidence; a zone typed by a human is a declaration. This
 * module only ever returns the former — the manual fallback lives in the screen
 * and is submitted as a declared zone, never as a measured position.
 *
 * `expo-location` is loaded through an indirect specifier so the app compiles
 * and runs before the dependency is installed: refusing permission and lacking
 * the module lead to the same place, which is the manual entry the flow needs
 * anyway.
 */

export interface DevicePosition {
  lat: number;
  lng: number;
  /** Metres. Useful to tell a rough network fix from a real GPS one. */
  accuracy: number | null;
}

export type PositionOutcome =
  | { status: 'ok'; position: DevicePosition }
  | { status: 'denied' }
  | { status: 'unavailable'; reason: string };

/**
 * Ask for permission and take a reading. Never throws: on any failure the
 * caller falls back to the declared zone.
 */
export async function captureOrigin(): Promise<PositionOutcome> {
  let Location: Record<string, unknown> | null = null;
  try {
    const moduleName = 'expo-location';
    Location = (await import(/* @vite-ignore */ moduleName)) as unknown as Record<string, unknown>;
  } catch {
    return { status: 'unavailable', reason: 'Module de géolocalisation indisponible' };
  }
  if (!Location) return { status: 'unavailable', reason: 'Module de géolocalisation indisponible' };

  try {
    const requestPermission = Location.requestForegroundPermissionsAsync as () => Promise<{
      granted: boolean;
    }>;
    const getPosition = Location.getCurrentPositionAsync as (o: unknown) => Promise<{
      coords: { latitude: number; longitude: number; accuracy: number | null };
    }>;

    const permission = await requestPermission();
    if (!permission.granted) return { status: 'denied' };

    const reading = await getPosition({ accuracy: 4 /* Location.Accuracy.High */ });
    return {
      status: 'ok',
      position: {
        lat: reading.coords.latitude,
        lng: reading.coords.longitude,
        accuracy: reading.coords.accuracy,
      },
    };
  } catch (error) {
    // No signal, airplane mode, emulator without a mock location: all end up in
    // manual entry rather than blocking the declaration.
    return { status: 'unavailable', reason: error instanceof Error ? error.message : 'Position indisponible' };
  }
}

/** Short, human-readable rendering of a fix, for the confirmation line. */
export function formatPosition(p: DevicePosition): string {
  const accuracy = p.accuracy != null ? ` (±${Math.round(p.accuracy)} m)` : '';
  return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}${accuracy}`;
}
