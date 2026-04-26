import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type BagCountSelectorProps = {
  maxSelectable: number;
  onSelect: (count: number) => void;
};

const COUNTS = [1, 2, 3, 4, 5];

export default function BagCountSelector({
  maxSelectable,
  onSelect,
}: BagCountSelectorProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      {COUNTS.map((count) => {
        const disabled = count > maxSelectable;

        return (
          <Pressable
            key={count}
            onPress={() => onSelect(count)}
            disabled={disabled}
            style={({ pressed }) => [
              styles.button,
              disabled && styles.buttonDisabled,
              pressed && !disabled && styles.buttonPressed,
            ]}
          >
            <Text
              style={[
                styles.label,
                disabled && styles.labelDisabled,
              ]}
            >
              {count}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  button: {
    minWidth: 60,
    minHeight: 60,
    borderRadius: 10,
    backgroundColor: '#1a2744',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  buttonPressed: {
    backgroundColor: '#2a3d66',
  },
  buttonDisabled: {
    backgroundColor: '#c6cfdd',
  },
  label: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
  },
  labelDisabled: {
    color: '#7a8496',
  },
});
