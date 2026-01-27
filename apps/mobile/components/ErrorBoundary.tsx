import React, { Component, type ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <View style={styles.container}>
          <View style={styles.iconContainer}>
            <Ionicons name="alert-circle" size={56} color="#EF4444" />
          </View>
          <Text style={styles.title}>Oups, une erreur est survenue</Text>
          <Text style={styles.message}>
            L'application a rencontré un problème inattendu.
          </Text>
          {__DEV__ && this.state.error && (
            <Text style={styles.debug} numberOfLines={5}>
              {this.state.error.message}
            </Text>
          )}
          <TouchableOpacity style={styles.button} onPress={this.handleReset} activeOpacity={0.8}>
            <Ionicons name="refresh" size={20} color="#0F0F1A" />
            <Text style={styles.buttonText}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F1A',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  iconContainer: {
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    color: '#9CA3AF',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  debug: {
    fontSize: 12,
    color: '#6B7280',
    fontFamily: 'monospace',
    backgroundColor: '#1A1A2E',
    padding: 12,
    borderRadius: 8,
    marginBottom: 24,
    width: '100%',
    overflow: 'hidden',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#D4AF37',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F0F1A',
  },
});
