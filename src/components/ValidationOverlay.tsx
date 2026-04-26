import React, { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

type ValidationOverlayProps = {
  visible: boolean;
  gin: string;
  valid: boolean;
  ingredientName: string;
  rejectReason: string;
  onDismiss: () => void;
};

export default function ValidationOverlay({
  visible,
  gin,
  valid,
  ingredientName,
  rejectReason,
  onDismiss,
}: ValidationOverlayProps): React.JSX.Element {
  useEffect(() => {
    if (!visible || !valid) {
      return undefined;
    }

    const timeoutId = setTimeout(() => {
      onDismiss();
    }, 1500);

    return () => clearTimeout(timeoutId);
  }, [onDismiss, valid, visible]);

  return (
    <Modal transparent visible={visible} animationType="fade">
      <View style={styles.overlay}>
        <View style={[styles.banner, valid ? styles.bannerValid : styles.bannerInvalid]}>
          <Text style={styles.icon}>{valid ? '✓' : '✕'}</Text>
          <Text style={styles.title}>{valid ? 'GIN VERIFIED' : 'GIN NOT VALID'}</Text>
          <Text style={styles.ginLabel}>GIN: {gin}</Text>

          {valid ? (
            <Text style={styles.detail}>{ingredientName}</Text>
          ) : (
            <>
              <Text style={styles.detail}>{ingredientName}</Text>
              <Text style={styles.reason}>{rejectReason}</Text>
              <Pressable onPress={onDismiss} style={({ pressed }) => [
                styles.actionButton,
                pressed && styles.actionButtonPressed,
              ]}>
                <Text style={styles.actionButtonText}>SCAN AGAIN</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  banner: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 18,
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: 'center',
  },
  bannerValid: {
    backgroundColor: '#1f9d55',
  },
  bannerInvalid: {
    backgroundColor: '#c0392b',
  },
  icon: {
    fontSize: 44,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
  },
  ginLabel: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  detail: {
    marginTop: 8,
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
  },
  reason: {
    marginTop: 12,
    fontSize: 16,
    color: '#ffffff',
    textAlign: 'center',
  },
  actionButton: {
    marginTop: 24,
    minWidth: 180,
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  actionButtonPressed: {
    opacity: 0.85,
  },
  actionButtonText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#c0392b',
  },
});
