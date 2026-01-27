import { Stack } from 'expo-router';

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#1A1A2E' },
        headerTintColor: '#fff',
        headerBackTitle: 'Retour',
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Paramètres' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="price-alerts" options={{ title: 'Alertes de prix' }} />
      <Stack.Screen name="about" options={{ title: 'À propos' }} />
    </Stack>
  );
}
