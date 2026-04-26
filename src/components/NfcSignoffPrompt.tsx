import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type NfcSignoffPromptProps = {
  visible: boolean;
  ingredientName: string;
  onCancel: () => void;
};

export default function NfcSignoffPrompt({
  visible,
  ingredientName,
  onCancel,
}: NfcSignoffPromptProps): React.JSX.Element {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return undefined;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();

    return () => {
      animation.stop();
      pulse.setValue(0);
    };
  }, [pulse, visible]);

  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.14],
  });

  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0.9],
  });

  return (
    <Modal transparent visible={visible} animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>TAP NFC TAG TO SIGN OFF</Text>
          <Text style={styles.ingredientName}>{ingredientName}</Text>

          <View style={styles.iconWrap}>
            <Animated.View
              style={[
                styles.pulseRing,
                {
                  opacity: pulseOpacity,
                  transform: [{ scale: pulseScale }],
                },
              ]}
            />
            <View style={styles.iconCore}>
              <Text style={styles.iconText}>NFC</Text>
            </View>
          </View>

          <Pressable onPress={onCancel} style={({ pressed }) => [
            styles.cancelButton,
            pressed && styles.cancelButtonPressed,
          ]}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(7, 15, 32, 0.72)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#1a2744',
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
  },
  ingredientName: {
    marginTop: 12,
    fontSize: 20,
    fontWeight: '600',
    color: '#dbe8ff',
    textAlign: 'center',
  },
  iconWrap: {
    width: 180,
    height: 180,
    marginTop: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: '#4db6ff',
  },
  iconCore: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1a2744',
    letterSpacing: 1,
  },
  cancelButton: {
    marginTop: 32,
    minWidth: 180,
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  cancelButtonPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  cancelButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
});
