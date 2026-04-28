import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

type BagCountSelectorProps = {
  bagsRemaining: number;
  onSelect: (count: number) => void;
};

export default function BagCountSelector({
  bagsRemaining,
  onSelect,
}: BagCountSelectorProps): React.JSX.Element {
  const [value, setValue] = useState('');

  const handleConfirm = () => {
    const count = parseInt(value, 10);
    if (!count || count < 1) return;
    if (count > bagsRemaining) {
      setValue(String(bagsRemaining));
      return;
    }
    onSelect(count);
    setValue('');
  };

  return (
    <View style={styles.container}>
      {/* Quick select — all remaining bags */}
      <Pressable
        style={({ pressed }) => [styles.quickButton, pressed && styles.quickButtonPressed]}
        onPress={() => onSelect(bagsRemaining)}
      >
        <Text style={styles.quickCount}>{bagsRemaining}</Text>
        <Text style={styles.quickLabel}>All remaining bags</Text>
      </Pressable>

      {/* Manual entry */}
      <View style={styles.manualRow}>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          placeholder="Other amount"
          placeholderTextColor="#7f8795"
          value={value}
          onChangeText={setValue}
          onSubmitEditing={handleConfirm}
          returnKeyType="done"
          maxLength={5}
        />
        <Pressable
          style={({ pressed }) => [styles.confirmButton, pressed && styles.confirmButtonPressed]}
          onPress={handleConfirm}
        >
          <Text style={styles.confirmText}>Confirm</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  quickButton: {
    backgroundColor: '#1a2744',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickButtonPressed: {
    backgroundColor: '#263960',
  },
  quickCount: {
    fontSize: 36,
    fontWeight: '800',
    color: '#ffffff',
    lineHeight: 40,
  },
  quickLabel: {
    fontSize: 13,
    color: '#a8bcd8',
    marginTop: 2,
  },
  manualRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    borderColor: '#c8d1df',
    borderRadius: 10,
    paddingHorizontal: 14,
    backgroundColor: '#f8faff',
    fontSize: 18,
    fontWeight: '700',
    color: '#1a2744',
    textAlign: 'center',
  },
  confirmButton: {
    height: 48,
    paddingHorizontal: 18,
    backgroundColor: '#4f78c7',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonPressed: {
    backgroundColor: '#3d62a8',
  },
  confirmText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});
