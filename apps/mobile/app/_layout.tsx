import { Stack, useRouter } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '../stores/auth';
import Loader from '../components/Loader';
import { useEffect, useRef } from 'react';
import { AppState, View } from 'react-native';
import { networkMonitor } from '../lib/network';

// Initialize offline detection (wires into React Query's onlineManager)
networkMonitor.init();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30,   // 30 minutes
      retry: 2,
    },
  },
});

const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

function RootLayoutContent() {
  const { isLoading, logout } = useAuthStore();
  const router = useRouter();
  const backgroundTimestamp = useRef<number | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        // App went to background, store timestamp
        backgroundTimestamp.current = Date.now();
      } else if (nextAppState === 'active') {
        // App came to foreground
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

  return (
    <View
      style={{ flex: 1 }}
      onStartShouldSetResponderCapture={() => {
        handleTouch();
        return false; // Don't capture the touch, let it propagate
      }}
    >
      <StatusBar style="light" />
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
    <QueryClientProvider client={queryClient}>
      <RootLayoutContent />
    </QueryClientProvider>
  );
}
