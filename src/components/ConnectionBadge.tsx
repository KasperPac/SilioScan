import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

type ConnectionBadgeProps = {
  status: ConnectionStatus;
};

const STATUS_CONFIG: Record<
  ConnectionStatus,
  { label: string; dotColor: string; backgroundColor: string; textColor: string }
> = {
  connected: {
    label: 'Connected',
    dotColor: '#1f9d55',
    backgroundColor: 'rgba(31, 157, 85, 0.15)',
    textColor: '#0f6b39',
  },
  connecting: {
    label: 'Connecting...',
    dotColor: '#d98e04',
    backgroundColor: 'rgba(217, 142, 4, 0.15)',
    textColor: '#8a5d00',
  },
  disconnected: {
    label: 'Disconnected',
    dotColor: '#c0392b',
    backgroundColor: 'rgba(192, 57, 43, 0.15)',
    textColor: '#8f251b',
  },
};

export default function ConnectionBadge({
  status,
}: ConnectionBadgeProps): React.JSX.Element {
  const config = STATUS_CONFIG[status];
  const { bottom } = useSafeAreaInsets();

  return (
    <View style={[styles.container, { backgroundColor: config.backgroundColor, bottom: bottom + 12 }]}>
      <View style={[styles.dot, { backgroundColor: config.dotColor }]} />
      <Text style={[styles.label, { color: config.textColor }]}>{config.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
});
