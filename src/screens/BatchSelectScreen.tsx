import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { handtipService, BatchSummary } from '../services/HandtipService';
import { useBatchStore } from '../store/batchStore';
import { usePickingStore } from '../store/pickingStore';

export default function BatchSelectScreen(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingBatch, setLoadingBatch] = useState<number | null>(null);

  const { loadFromSql } = useBatchStore();
  const { reset: resetPicking } = usePickingStore();

  const fetchBatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBatches(await handtipService.getBatches());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load batches');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBatches(); }, [fetchBatches]);

  const handleSelect = useCallback(async (item: BatchSummary) => {
    setLoadingBatch(item.batch);
    setError(null);
    try {
      const detail = await handtipService.getBatch(item.batch);
      loadFromSql(item.batch, detail);
      resetPicking();
      navigation.navigate('Picking');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load batch');
    } finally {
      setLoadingBatch(null);
    }
  }, [loadFromSql, resetPicking, navigation]);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Select Batch</Text>
        <Pressable
          onPress={fetchBatches}
          disabled={loading}
          style={({ pressed }) => [styles.refreshButton, pressed && styles.refreshButtonPressed]}
        >
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4f78c7" />
          <Text style={styles.loadingText}>Loading batches…</Text>
        </View>
      ) : batches.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No batches available</Text>
          <Pressable
            onPress={fetchBatches}
            style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={batches}
          keyExtractor={(item) => String(item.batch)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const busy = loadingBatch === item.batch;
            const done = item.handtip_complete;
            return (
              <Pressable
                onPress={() => handleSelect(item)}
                disabled={loadingBatch !== null}
                style={({ pressed }) => [
                  styles.row,
                  done && styles.rowDone,
                  pressed && !busy && styles.rowPressed,
                  busy && styles.rowBusy,
                ]}
              >
                <View style={styles.rowLeft}>
                  <View style={styles.rowTitleRow}>
                    <Text style={[styles.rowCode, done && styles.rowCodeDone]}>{item.code}</Text>
                    {done && <Text style={styles.rowDoneTag}>Handtip done</Text>}
                  </View>
                  <Text style={[styles.rowDescription, done && styles.rowTextDone]}>{item.description}</Text>
                  <Text style={[styles.rowDate, done && styles.rowTextDone]}>Due: {item.required_date_formatted}</Text>
                </View>
                <View style={styles.rowRight}>
                  {busy
                    ? <ActivityIndicator size="small" color="#4f78c7" />
                    : <Text style={[styles.rowArrow, done && styles.rowArrowDone]}>›</Text>
                  }
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1a2744',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  title: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '800',
  },
  refreshButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  refreshButtonPressed: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  refreshText: {
    color: '#a8bcd8',
    fontSize: 15,
    fontWeight: '700',
  },
  errorBanner: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 80, 60, 0.15)',
  },
  errorText: {
    color: '#ff6b5b',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    color: '#a8bcd8',
    fontSize: 16,
  },
  emptyText: {
    color: '#a8bcd8',
    fontSize: 18,
    fontWeight: '600',
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#4f78c7',
  },
  retryButtonPressed: {
    backgroundColor: '#3d62ae',
  },
  retryText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  list: {
    padding: 12,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  rowPressed: {
    backgroundColor: '#f0f4fb',
  },
  rowBusy: {
    opacity: 0.7,
  },
  rowLeft: {
    flex: 1,
    gap: 3,
  },
  rowCode: {
    color: '#1a2744',
    fontSize: 17,
    fontWeight: '800',
  },
  rowDescription: {
    color: '#2f3b52',
    fontSize: 15,
    fontWeight: '500',
  },
  rowDate: {
    color: '#8899bb',
    fontSize: 13,
    marginTop: 2,
  },
  rowRight: {
    width: 32,
    alignItems: 'center',
  },
  rowArrow: {
    color: '#4f78c7',
    fontSize: 28,
    fontWeight: '300',
  },
  rowTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowDone: {
    backgroundColor: '#f0f2f7',
  },
  rowCodeDone: {
    color: '#7a8aaa',
  },
  rowDoneTag: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: '#8899bb',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  rowTextDone: {
    color: '#9aabbf',
  },
  rowArrowDone: {
    color: '#b0c0d8',
  },
});
