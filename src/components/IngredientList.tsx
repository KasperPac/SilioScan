import React from 'react';
import {
  FlatList,
  ListRenderItem,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { IngredientProgress as IngredientState } from '../store/batchStore';

type IngredientListProps = {
  ingredients: IngredientState[];
  selectedIndex: number;
  onSelect: (index: number) => void;
};

export default function IngredientList({
  ingredients,
  selectedIndex,
  onSelect,
}: IngredientListProps): React.JSX.Element {
  const renderItem: ListRenderItem<IngredientState> = ({ item, index }) => {
    const isSelected = index === selectedIndex;
    const isComplete = item.collectedBags >= item.requiredBags;

    return (
      <Pressable
        onPress={() => onSelect(index)}
        style={({ pressed }) => [
          styles.row,
          isSelected && styles.rowSelected,
          pressed && styles.rowPressed,
        ]}
      >
        <View style={styles.rowMain}>
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.counts}>
            {item.collectedBags}/{item.requiredBags} bags
          </Text>
        </View>

        <View style={styles.rowMeta}>
          <View
            style={[
              styles.badge,
              isComplete ? styles.badgeComplete : styles.badgePending,
            ]}
          >
            <Text style={styles.badgeText}>
              {isComplete ? 'Complete' : 'In Progress'}
            </Text>
          </View>

          {item.signedOff ? <Text style={styles.checkmark}>✓</Text> : null}
        </View>
      </Pressable>
    );
  };

  return (
    <FlatList
      data={ingredients}
      keyExtractor={(_, index) => `ingredient-${index}`}
      renderItem={renderItem}
      extraData={selectedIndex}
      contentContainerStyle={styles.listContent}
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingVertical: 4,
  },
  row: {
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#d7dce5',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowSelected: {
    backgroundColor: '#dbe8ff',
  },
  rowPressed: {
    opacity: 0.9,
  },
  rowMain: {
    flex: 1,
    paddingRight: 12,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a2744',
  },
  counts: {
    marginTop: 4,
    fontSize: 14,
    color: '#5b6577',
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgePending: {
    backgroundColor: '#e8edf5',
  },
  badgeComplete: {
    backgroundColor: '#d8f2df',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1a2744',
  },
  checkmark: {
    marginLeft: 10,
    fontSize: 18,
    fontWeight: '700',
    color: '#1f9d55',
  },
});
