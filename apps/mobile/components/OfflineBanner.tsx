import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { networkMonitor } from '../lib/network';

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(!networkMonitor.isOnline);
  const [fadeAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const unsubscribe = networkMonitor.subscribe((isOnline) => {
      setIsOffline(!isOnline);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: isOffline ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isOffline, fadeAnim]);

  if (!isOffline) return null;

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <Ionicons name="cloud-offline-outline" size={16} color="#FFF" />
      <Text style={styles.text}>Hors connexion</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#EF4444',
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  text: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
