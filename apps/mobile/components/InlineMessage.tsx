import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';

type MessageType = 'error' | 'success' | 'warning' | 'info';

interface InlineMessageProps {
  type: MessageType;
  message: string;
  onDismiss?: () => void;
  autoDismiss?: number; // ms, 0 = no auto dismiss
  /**
   * Ancre pour les parcours bout-en-bout. Le type est repris dans l'identifiant
   * (`message-erreur`, `message-succes`…) : un parcours qui verifie un refus ne
   * doit pas pouvoir se satisfaire d'une banniere de succes affichee au meme
   * endroit.
   */
  testID?: string;
}

/**
 * Identifiants ECRITS EN ENTIER, pas assembles a l'execution : le controle qui
 * verifie les parcours bout-en-bout les cherche tels quels dans les sources. Un
 * identifiant construit par interpolation serait introuvable, donc invérifiable.
 */
const TEST_ID: Record<MessageType, string> = {
  error: 'message-erreur',
  success: 'message-succes',
  warning: 'message-avertissement',
  info: 'message-info',
};

const CONFIG: Record<MessageType, { icon: React.ComponentProps<typeof Ionicons>['name']; bg: string; border: string; color: string; iconColor: string }> = {
  error: {
    icon: 'alert-circle',
    bg: 'rgba(239, 68, 68, 0.1)',
    border: 'rgba(239, 68, 68, 0.3)',
    color: '#FCA5A5',
    iconColor: '#EF4444',
  },
  success: {
    icon: 'checkmark-circle',
    bg: 'rgba(16, 185, 129, 0.1)',
    border: 'rgba(16, 185, 129, 0.3)',
    color: '#6EE7B7',
    iconColor: '#10B981',
  },
  warning: {
    icon: 'warning',
    bg: 'rgba(234, 179, 8, 0.1)',
    border: 'rgba(234, 179, 8, 0.3)',
    color: '#FDE68A',
    iconColor: '#EAB308',
  },
  info: {
    icon: 'information-circle',
    bg: 'rgba(59, 130, 246, 0.1)',
    border: 'rgba(59, 130, 246, 0.3)',
    color: '#93C5FD',
    iconColor: '#3B82F6',
  },
};

export default function InlineMessage({ type, message, onDismiss, autoDismiss = 5000, testID }: InlineMessageProps) {
  const config = CONFIG[type];

  useEffect(() => {
    if (autoDismiss > 0 && onDismiss) {
      const timer = setTimeout(onDismiss, autoDismiss);
      return () => clearTimeout(timer);
    }
  }, [autoDismiss, onDismiss]);

  return (
    <View
      testID={testID ?? TEST_ID[type]}
      style={[styles.container, { backgroundColor: config.bg, borderColor: config.border }]}
    >
      <Ionicons name={config.icon} size={20} color={config.iconColor} />
      <Text testID={`${testID ?? TEST_ID[type]}-texte`} style={[styles.message, { color: config.color }]}>{message}</Text>
      {onDismiss && (
        <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close" size={18} color={config.color} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    gap: 10,
    borderWidth: 1,
  },
  message: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
});
