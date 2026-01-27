import { Stack } from 'expo-router';

export default function KycLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0F0F1A' },
        headerTintColor: '#D4AF37',
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: '#0F0F1A' },
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: 'Verification KYC' }}
      />
      <Stack.Screen
        name="personal-info"
        options={{ title: 'Informations personnelles' }}
      />
      <Stack.Screen
        name="document-type"
        options={{ title: 'Type de document' }}
      />
      <Stack.Screen
        name="camera"
        options={{
          title: 'Prise de photo',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="review"
        options={{ title: 'Verification' }}
      />
    </Stack>
  );
}
