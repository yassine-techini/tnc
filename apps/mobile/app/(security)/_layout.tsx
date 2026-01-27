import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { preventScreenCapture, allowScreenCapture } from '../../hooks/useSecurityCheck';

export default function SecurityLayout() {
  useEffect(() => {
    preventScreenCapture();
    return () => { allowScreenCapture(); };
  }, []);

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
        options={{ title: 'Securite' }}
      />
      <Stack.Screen
        name="two-factor"
        options={{ title: 'Authentification 2FA' }}
      />
      <Stack.Screen
        name="change-password"
        options={{ title: 'Changer le mot de passe' }}
      />
    </Stack>
  );
}
