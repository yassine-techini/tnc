import { Stack, router } from 'expo-router';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { preventScreenCapture, allowScreenCapture } from '../../hooks/useSecurityCheck';
import { useThemeColors } from '../../stores/theme';

export default function WalletLayout() {
  const c = useThemeColors();

  useEffect(() => {
    preventScreenCapture();
    return () => { allowScreenCapture(); };
  }, []);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.background },
        headerTintColor: c.gold,
        headerTitleStyle: { fontWeight: '600', fontSize: 17 },
        contentStyle: { backgroundColor: c.background },
        headerLeft: () => {
          const colors = useThemeColors();
          return (
            <TouchableOpacity
              onPress={() => router.back()}
              style={{ marginRight: 8, padding: 4 }}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-back" size={22} color={colors.gold} />
            </TouchableOpacity>
          );
        },
        headerRight: () => {
          const colors = useThemeColors();
          return (
            <TouchableOpacity
              onPress={() => router.replace('/(tabs)')}
              style={{ padding: 4 }}
              activeOpacity={0.7}
            >
              <Ionicons name="home-outline" size={20} color={colors.textTertiary} />
            </TouchableOpacity>
          );
        },
      }}
    >
      <Stack.Screen
        name="deposit"
        options={{ title: 'Deposer' }}
      />
      <Stack.Screen
        name="withdraw"
        options={{ title: 'Retirer' }}
      />
      <Stack.Screen
        name="certificate"
        options={{ title: 'Certificat' }}
      />
      <Stack.Screen
        name="transactions"
        options={{ title: 'Historique' }}
      />
    </Stack>
  );
}
