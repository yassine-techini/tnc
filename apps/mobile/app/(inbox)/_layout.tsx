import { Stack } from 'expo-router';

export default function InboxLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#1A1A2E' },
        headerTintColor: '#fff',
        headerBackTitle: 'Retour',
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  );
}
