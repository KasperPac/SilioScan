import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

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
    backgroundColor: 'rgba(31, 157, 85, 0.12)',
    textColor: '#0f6b39',
  },
  connecting: {
    label: 'Connecting...',
    dotColor: '#d98e04',
    backgroundColor: 'rgba(217, 142, 4, 0.12)',
    textColor: '#8a5d00',
  },
  disconnected: {
    label: 'Disconnected',
    dotColor: '#c0392b',
    backgroundColor: 'rgba(192, 57, 43, 0.12)',
    textColor: '#8f251b',
  },
};

export default function ConnectionBadge({
  status,
}: ConnectionBadgeProps): React.JSX.Element {
  const config = STATUS_CONFIG[status];

  return (
    <View style={[styles.container, { backgroundColor: config.backgroundColor }]}>
      <View style={[styles.dot, { backgroundColor: config.dotColor }]} />
      <Text style={[styles.label, { color: config.textColor }]}>{config.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
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
