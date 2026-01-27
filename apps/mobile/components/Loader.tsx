import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing, ActivityIndicator } from 'react-native';

interface LoaderProps {
  message?: string;
  fullScreen?: boolean;
}

export function Loader({ message = 'Chargement...', fullScreen = true }: LoaderProps) {
  const pulseValue = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseValue, {
          toValue: 1.1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseValue, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    pulseAnimation.start();

    return () => {
      pulseAnimation.stop();
    };
  }, [pulseValue]);

  const content = (
    <View style={styles.content}>
      {/* Gold coin */}
      <Animated.View
        style={[
          styles.coin,
          {
            transform: [{ scale: pulseValue }],
          },
        ]}
      >
        <View style={styles.coinInner}>
          <Text style={styles.coinSymbol}>Au</Text>
        </View>
      </Animated.View>

      {/* Loading indicator */}
      <ActivityIndicator size="small" color="#D4AF37" style={styles.spinner} />

      {/* Message */}
      <Text style={styles.message}>{message}</Text>

      {/* Brand */}
      <Text style={styles.brand}>TNC TRADING</Text>
    </View>
  );

  if (fullScreen) {
    return <View style={styles.fullScreen}>{content}</View>;
  }

  return <View style={styles.container}>{content}</View>;
}

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
    backgroundColor: '#0F0F1A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    padding: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
  },
  coin: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#D4AF37',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  coinInner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#B8960C',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#E5C158',
  },
  coinSymbol: {
    fontSize: 32,
    fontWeight: '900',
    color: '#0F0F1A',
  },
  spinner: {
    marginBottom: 16,
  },
  message: {
    fontSize: 16,
    color: '#9CA3AF',
    marginBottom: 24,
  },
  brand: {
    fontSize: 14,
    color: '#D4AF37',
    fontWeight: '600',
    letterSpacing: 2,
  },
});

export default Loader;
