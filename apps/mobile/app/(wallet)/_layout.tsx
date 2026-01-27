import { Stack, router } from 'expo-router';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function WalletLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0F0F1A' },
        headerTintColor: '#D4AF37',
        headerTitleStyle: { fontWeight: '600', fontSize: 17 },
        contentStyle: { backgroundColor: '#0F0F1A' },
        headerLeft: () => (
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ marginRight: 8, padding: 4 }}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={22} color="#D4AF37" />
          </TouchableOpacity>
        ),
        headerRight: () => (
          <TouchableOpacity
            onPress={() => router.replace('/(tabs)')}
            style={{ padding: 4 }}
            activeOpacity={0.7}
          >
            <Ionicons name="home-outline" size={20} color="#9CA3AF" />
          </TouchableOpacity>
        ),
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
    </Stack>
  );
}
