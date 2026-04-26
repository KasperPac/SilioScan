import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { IngredientGinEntry } from '../store/batchStore';

interface Props {
  entries: IngredientGinEntry[];
  /** Placeholder text shown when no GINs scanned yet. */
  emptyLabel?: string;
}

export default function GinList({ entries, emptyLabel = '— scan GIN barcode —' }: Props): React.JSX.Element {
  if (entries.length === 0) {
    return (
      <View style={styles.emptyRow}>
        <Text style={styles.emptyText}>{emptyLabel}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {entries.map((entry, i) => (
        <View key={`${entry.gin}-${i}`} style={styles.row}>
          <View style={styles.checkBadge}>
            <Text style={styles.checkIcon}>✓</Text>
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.ginText}>GIN  {entry.gin}</Text>
          </View>
          <Text style={styles.bagText}>{entry.bagCount} {entry.bagCount === 1 ? 'bag' : 'bags'}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#eaf4ee',
    borderRadius: 8,
    marginBottom: 6,
  },
  checkBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1f9d55',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkIcon: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  rowBody: {
    flex: 1,
  },
  ginText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a2744',
    letterSpacing: 0.5,
  },
  bagText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1f9d55',
  },
  emptyRow: {
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#d0d7e5',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  emptyText: {
    color: '#8899bb',
    fontSize: 15,
    fontStyle: 'italic',
  },
});
