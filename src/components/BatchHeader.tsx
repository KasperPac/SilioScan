import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type BatchHeaderProps = {
  productCode: string;
  batchNo: string;
  description: string;
  onSettings: () => void;
};

export default function BatchHeader({
  productCode,
  batchNo,
  description,
  onSettings,
}: BatchHeaderProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.codes} numberOfLines={1}>
          {productCode}{'  |  '}{batchNo}
        </Text>
        {!!description && (
          <Text style={styles.description} numberOfLines={1}>{description}</Text>
        )}
      </View>
      <Pressable
        onPress={onSettings}
        hitSlop={12}
        style={({ pressed }) => [styles.settingsButton, pressed && styles.settingsButtonPressed]}
        accessibilityLabel="Open settings"
      >
        <Text style={styles.settingsIcon}>⚙</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a2744',
    paddingTop: 10,
    paddingBottom: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#253a6a',
    flexDirection: 'row',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    marginRight: 8,
  },
  codes: {
    color: '#a8bcd8',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  description: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  settingsButton: {
    padding: 6,
    borderRadius: 8,
  },
  settingsButtonPressed: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  settingsIcon: {
    fontSize: 20,
    color: '#a8bcd8',
  },
});
