import { Stack } from 'expo-router';
import { useThemeColors } from '../../stores/theme';

export default function ProducerLayout() {
  const c = useThemeColors();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.gold,
        headerTitleStyle: { color: c.text },
        contentStyle: { backgroundColor: c.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Mes lots' }} />
      <Stack.Screen name="new" options={{ title: 'Nouveau lot' }} />
      <Stack.Screen name="[id]" options={{ title: 'Suivi du lot' }} />
      <Stack.Screen name="dispose" options={{ title: 'Répartir le lot' }} />
      <Stack.Screen name="profile" options={{ title: 'Mon dossier' }} />
    </Stack>
  );
}
