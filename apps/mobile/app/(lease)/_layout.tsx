import { Stack } from 'expo-router';
import { useThemeColors } from '../../stores/theme';

export default function LeaseLayout() {
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
      <Stack.Screen name="index" options={{ title: "Location d'or" }} />
      <Stack.Screen name="open" options={{ title: 'Placer en location' }} />
      <Stack.Screen name="[id]" options={{ title: 'Ma position' }} />
    </Stack>
  );
}
