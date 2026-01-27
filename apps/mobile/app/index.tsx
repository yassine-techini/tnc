import { Redirect } from 'expo-router';
import { useAuthStore } from '../stores/auth';
import { Loader } from '../components/Loader';

export default function Index() {
  const { isAuthenticated, isLoading } = useAuthStore();

  // Show loading while hydrating auth state from secure storage
  if (isLoading) {
    return <Loader message="Initialisation..." />;
  }

  // Redirect based on authentication status
  if (isAuthenticated) {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/(auth)/login" />;
}
