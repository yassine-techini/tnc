import { Stack, useRouter } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '../stores/auth';
import Loader from '../components/Loader';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { networkMonitor } from '../lib/network';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { OfflineBanner } from '../components/OfflineBanner';

// Initialize offline detection (wires into React Query's onlineManager)
networkMonitor.init();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 10, // 10 min — reduce refetches on slow networks
      gcTime: 1000 * 60 * 60,    // 1 hour — keep cache longer to avoid re-downloading
      retry: 1,                   // Only 1 retry (api client already retries 3x internally)
      refetchOnWindowFocus: false, // Don't refetch on focus — saves bandwidth
      refetchOnReconnect: 'always', // Do refetch when network comes back
    },
    mutations: {
      retry: 0, // Mutations use api client retries + idempotency keys
    },
  },
});

const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const LOCK_THRESHOLD = 60 * 1000; // Lock after 1 minute in background

function AppLockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [error, setError] = useState('');

  const authenticate = useCallback(async () => {
    setError('');
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Déverrouillez TNC Trading',
        cancelLabel: 'Annuler',
        fallbackLabel: 'Utiliser le code',
      });
      if (result.success) {
        onUnlock();
      } else {
        setError('Authentification échouée');
      }
    } catch {
      setError('Erreur d\'authentification');
    }
  }, [onUnlock]);

  useEffect(() => {
    authenticate();
  }, [authenticate]);

  return (
    <View style={lockStyles.container}>
      <View style={lockStyles.iconContainer}>
        <Ionicons name="lock-closed" size={48} color="#D4AF37" />
      </View>
      <Text style={lockStyles.title}>TNC Trading</Text>
      <Text style={lockStyles.subtitle}>Application verrouillée</Text>
      {error ? <Text style={lockStyles.error}>{error}</Text> : null}
      <TouchableOpacity style={lockStyles.button} onPress={authenticate} activeOpacity={0.8}>
        <Ionicons name="finger-print" size={24} color="#0F0F1A" />
        <Text style={lockStyles.buttonText}>Déverrouiller</Text>
      </TouchableOpacity>
    </View>
  );
}

const lockStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F1A', justifyContent: 'center', alignItems: 'center', padding: 24 },
  iconContainer: { marginBottom: 20 },
  title: { fontSize: 24, fontWeight: '800', color: '#D4AF37', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#9CA3AF', marginBottom: 32 },
  error: { fontSize: 14, color: '#EF4444', marginBottom: 16 },
  button: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#D4AF37', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 14 },
  buttonText: { fontSize: 16, fontWeight: '700', color: '#0F0F1A' },
});

function RootLayoutContent() {
  const { isLoading, isAuthenticated, logout } = useAuthStore();
  const router = useRouter();
  const backgroundTimestamp = useRef<number | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        // App went to background, store timestamp
        backgroundTimestamp.current = Date.now();
      } else if (nextAppState === 'active') {
        const authState = useAuthStore.getState();

        // Check if token is expired
        if (authState.isTokenExpired && authState.isTokenExpired()) {
          logout();
          router.replace('/(auth)/login');
          return;
        }

        // Check for inactivity timeout
        if (backgroundTimestamp.current !== null) {
          const elapsedTime = Date.now() - backgroundTimestamp.current;

          if (elapsedTime >= SESSION_TIMEOUT) {
            logout();
            router.replace('/(auth)/login');
            backgroundTimestamp.current = null;
            return;
          }

          // Lock app if user was away > LOCK_THRESHOLD and biometric is enabled
          if (elapsedTime >= LOCK_THRESHOLD && authState.isAuthenticated) {
            const biometricEnabled = await SecureStore.getItemAsync('tnc_biometric_enabled');
            const hasBiometric = await LocalAuthentication.hasHardwareAsync();
            if (biometricEnabled === 'true' && hasBiometric) {
              setIsLocked(true);
            }
          }

          backgroundTimestamp.current = null;
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [logout, router]);

  // Update activity on any touch
  const handleTouch = () => {
    const authState = useAuthStore.getState();
    if (authState.updateActivity) {
      authState.updateActivity();
    }
  };

  if (isLoading) {
    return <Loader />;
  }

  // Show lock screen overlay when locked
  if (isLocked && isAuthenticated) {
    return <AppLockScreen onUnlock={() => setIsLocked(false)} />;
  }

  return (
    <View
      style={{ flex: 1 }}
      onStartShouldSetResponderCapture={() => {
        handleTouch();
        return false; // Don't capture the touch, let it propagate
      }}
    >
      <StatusBar style="light" />
      <OfflineBanner />
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: '#1A1A2E',
          },
          headerTintColor: '#fff',
          headerTitleStyle: {
            fontWeight: 'bold',
          },
          contentStyle: {
            backgroundColor: '#0F0F1A',
          },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(kyc)" options={{ headerShown: false }} />
        <Stack.Screen name="(wallet)" options={{ headerShown: false }} />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RootLayoutContent />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
