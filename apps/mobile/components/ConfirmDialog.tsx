import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
}

export default function ConfirmDialog({
  title,
  message,
  confirmText = 'Confirmer',
  cancelText = 'Annuler',
  onConfirm,
  onCancel,
  destructive = false,
}: ConfirmDialogProps) {
  return (
    <View style={styles.container}>
      <View style={[styles.iconBg, destructive && styles.iconBgDestructive]}>
        <Ionicons
          name={destructive ? 'warning' : 'help-circle'}
          size={28}
          color={destructive ? '#EF4444' : '#D4AF37'}
        />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel} activeOpacity={0.8}>
          <Text style={styles.cancelText}>{cancelText}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.confirmButton, destructive && styles.confirmButtonDestructive]}
          onPress={onConfirm}
          activeOpacity={0.8}
        >
          <Text style={[styles.confirmText, destructive && styles.confirmTextDestructive]}>
            {confirmText}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1A1A2E',
    borderRadius: 16,
    padding: 24,
    marginBottom: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
  },
  iconBg: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(212, 175, 55, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconBgDestructive: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    color: '#9CA3AF',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#374151',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  cancelText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  confirmButton: {
    flex: 1,
    backgroundColor: '#D4AF37',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  confirmButtonDestructive: {
    backgroundColor: '#EF4444',
  },
  confirmText: {
    color: '#0F0F1A',
    fontWeight: '700',
    fontSize: 15,
  },
  confirmTextDestructive: {
    color: '#fff',
  },
});
