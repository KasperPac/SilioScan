import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useConnectionStore } from '../store/connectionStore';
import ConnectionBadge from './ConnectionBadge';

type BatchHeaderProps = {
  productCode: string;
  batchNo: string;
  description: string;
};

export default function BatchHeader({
  productCode,
  batchNo,
  description,
}: BatchHeaderProps): React.JSX.Element {
  const status = useConnectionStore((s) => s.status);

  return (
    <View style={styles.container}>
      {/* ConnectionBadge is absolutely positioned — sits top-left of this container */}
      <ConnectionBadge status={status} />

      <View style={styles.content}>
        <Text style={styles.codes} numberOfLines={1}>
          {productCode}{'  |  '}{batchNo}
        </Text>
        {!!description && (
          <Text style={styles.description} numberOfLines={1}>{description}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a2744',
    paddingTop: 8,
    paddingBottom: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#253a6a',
  },
  // Indent content so it clears the absolute-positioned ConnectionBadge
  content: {
    marginLeft: 120,
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
});
