// ============================================================
// PickingScreen.tsx — Main operator workflow screen
// ARCHITECTURE.md §2, §4, §7
//
// Orchestrates the full ingredient-picking loop:
//   Select ingredient → Scan GIN → Validate → Select bags
//   → (repeat until all bags collected) → NFC sign-off → PLC ACK
//
// Services wired:
//   PlcService   — BATCH_RECIPE push, GIN_SCAN req, INGREDIENT_SIGNOFF req
//   ScannerService — hardware or camera barcode events
//   NfcService   — tag UID read for sign-off
//
// Stores consumed:
//   batchStore   — full recipe + progress
//   pickingStore — active-ingredient state machine
//   settingsStore — scanner mode
// ============================================================

import React, { useCallback, useEffect, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import BatchHeader from '../components/BatchHeader';
import ConnectionBadge from '../components/ConnectionBadge';
import IngredientDetail from '../components/IngredientDetail';
import IngredientList from '../components/IngredientList';
import NfcSignoffPrompt from '../components/NfcSignoffPrompt';
import ValidationOverlay from '../components/ValidationOverlay';
import {
  NfcReadCancelledError,
  nfcService,
} from '../services/NfcService';
import { plcService } from '../services/PlcService';
import { handtipService, parseUserCode } from '../services/HandtipService';
import { scannerService } from '../services/ScannerService';
import { useBatchStore } from '../store/batchStore';
import { useConnectionStore } from '../store/connectionStore';
import { usePickingStore } from '../store/pickingStore';
import { useSettingsStore } from '../store/settingsStore';
import type { BatchRecipeMsg, GinValidationMsg, SignoffAckMsg } from '../types/protocol';
import { vibrateFail, vibrateSignoff, vibrateSuccess } from '../utils/audio';

// ── Component ─────────────────────────────────────────────────

export default function PickingScreen(): React.JSX.Element {
  // ── Store reads ──────────────────────────────────────────────
  const {
    productCode, batchNo, description,
    ingredients, batchStatus, sqlBatch,
    setBatchRecipe, updateIngredientProgress, signOffIngredient,
  } = useBatchStore();

  const {
    phase, activeIngredientIndex, pendingGin, rejectReason,
    selectIngredient, onGinScanned, onGinValidated,
    onBagCountSelected, onNfcTapped, onSignoffAck, reset: resetPicking,
    setPhase,
  } = usePickingStore();

  const { status, setStatus } = useConnectionStore();
  const { scannerMode } = useSettingsStore();

  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const openSettings = useCallback(() => navigation.navigate('Settings'), [navigation]);

  // ── Refs ──────────────────────────────────────────────────────
  // Tracks whether the current NFC read is still relevant
  const nfcActiveRef = useRef(false);
  const detailScrollRef = useRef<ScrollView>(null);

  // ── PlcService events ─────────────────────────────────────────

  useEffect(() => {
    const onBatchRecipe = (recipe: BatchRecipeMsg) => {
      setBatchRecipe(recipe);
      resetPicking();
    };

    const onConnectionChange = (state: string) => {
      setStatus(state as 'disconnected' | 'connecting' | 'connected');
    };

    plcService.on('batchRecipe', onBatchRecipe);
    plcService.on('connectionChange', onConnectionChange);

    return () => {
      plcService.off('batchRecipe', onBatchRecipe);
      plcService.off('connectionChange', onConnectionChange);
    };
  }, [setBatchRecipe, resetPicking, setStatus]);

  // ── Scanner events ────────────────────────────────────────────

  useEffect(() => {
    const unsubscribe = scannerService.onBarcode(handleGinScanned);
    return unsubscribe;
    // handleGinScanned reads phase/activeIngredientIndex via store getState()
    // — stable ref, no deps needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── NFC lifecycle ─────────────────────────────────────────────

  useEffect(() => {
    nfcService.startListening().catch(() => {});
    return () => { nfcService.stopListening(); };
  }, []);

  // Trigger NFC read when entering READY_FOR_SIGNOFF
  useEffect(() => {
    if (phase !== 'READY_FOR_SIGNOFF') return;

    nfcActiveRef.current = true;

    nfcService.readTag()
      .then((uid) => {
        if (!nfcActiveRef.current) return;
        handleNfcTagRead(uid);
      })
      .catch((err) => {
        if (!nfcActiveRef.current) return;
        if (err instanceof NfcReadCancelledError) return;
        // Unexpected NFC error — stay in READY_FOR_SIGNOFF so operator can retry
        console.warn('[NFC] readTag error:', err);
      });

    return () => {
      nfcActiveRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Auto-advance after SIGNED_OFF: brief delay then reset to IDLE
  useEffect(() => {
    if (phase !== 'SIGNED_OFF') return;
    const timer = setTimeout(() => {
      resetPicking();
    }, 1400);
    return () => clearTimeout(timer);
  }, [phase, resetPicking]);

  // ── Action handlers ───────────────────────────────────────────

  /**
   * Called by ScannerService whenever a barcode arrives (HW or camera).
   * Reads current phase from store synchronously — no stale closure.
   * SQL batches: accept GINs immediately (no PLC validation needed).
   * PLC batches: validate via PlcService as before.
   */
  const handleGinScanned = useCallback(async (gin: string) => {
    const { phase: currentPhase, activeIngredientIndex: idx } =
      usePickingStore.getState();

    if (currentPhase !== 'AWAITING_SCAN' || idx === null) return;

    const { sqlBatch: batch } = useBatchStore.getState();

    if (batch !== null) {
      // SQL path — GINs are recorded on sign-off, accept immediately
      onGinScanned(gin);
      const syntheticValid: GinValidationMsg = {
        msgType: 0x81, seqNum: 0, gin, valid: true, ingredientName: '', rejectReason: '',
      };
      onGinValidated(syntheticValid);
      vibrateSuccess();
    } else {
      // PLC path
      if (plcService.connectionState !== 'connected') return;
      onGinScanned(gin);
      try {
        const result: GinValidationMsg = await plcService.sendGinScan(idx, gin);
        onGinValidated(result);
        if (result.valid) vibrateSuccess();
        else vibrateFail();
      } catch {
        vibrateFail();
        selectIngredient(idx);
      }
    }
  }, [onGinScanned, onGinValidated, selectIngredient]);

  /**
   * Called when operator selects a bag count for the last validated GIN.
   * Updates batchStore (persists the GIN entry) then advances state machine.
   */
  const handleBagCountSelected = useCallback((count: number) => {
    const { pendingGin: gin, activeIngredientIndex: idx } =
      usePickingStore.getState();
    if (gin === null || idx === null) return;

    updateIngredientProgress(idx, { gin, bagCount: count, validated: true });
    onBagCountSelected(count);
    vibrateSuccess();
  }, [updateIngredientProgress, onBagCountSelected]);

  /**
   * Called when NFC tag UID is read successfully.
   * SQL batches: look up operator in DB, record GINs + complete via API.
   * PLC batches: fire INGREDIENT_SIGNOFF as before.
   */
  const handleNfcTagRead = useCallback(async (uid: string) => {
    const { activeIngredientIndex: idx } = usePickingStore.getState();
    if (idx === null) return;

    const ingredient = useBatchStore.getState().ingredients[idx];
    if (!ingredient) return;

    const { sqlBatch: batch } = useBatchStore.getState();

    if (batch !== null) {
      // SQL path
      onNfcTapped(uid);
      try {
        const userCode = parseUserCode(uid);
        const user = await handtipService.lookupUser(userCode);

        // Record every GIN entry for this ingredient (positions are 1-based)
        await Promise.all(
          ingredient.ginEntries.map((entry, i) =>
            handtipService.recordGin(batch, {
              indexNumber: i + 1,
              ingredientIndex: ingredient.sqlIndexNumber!,
              gin: entry.gin,
              bagsAdded: entry.bagCount,
            }),
          ),
        );

        await handtipService.markIngredientComplete(batch, ingredient.sqlIndexNumber!);

        const ack: SignoffAckMsg = {
          msgType: 0x82, seqNum: 0, ingredientIndex: idx, accepted: true, rejectReason: '',
        };
        onSignoffAck(ack);
        vibrateSignoff();
        signOffIngredient(idx, user.user_name);

        // Fire batch signoff when all ingredients are done
        const { batchStatus } = useBatchStore.getState();
        if (batchStatus === 'complete') {
          await handtipService.signoff(batch, {
            userCode: user.user_code,
            userLevel: user.user_level,
            userName: user.user_name,
          });
        }
      } catch {
        vibrateFail();
        setPhase('READY_FOR_SIGNOFF');
      }
    } else {
      // PLC path
      onNfcTapped(uid);
      try {
        const result = await plcService.sendIngredientSignoff({
          ingredientIndex: idx,
          operatorId: uid,
          ginCount: ingredient.ginEntries.length,
          ginEntries: ingredient.ginEntries.map((e) => ({
            gin: e.gin,
            bagCount: e.bagCount,
          })),
        });

        onSignoffAck(result);

        if (result.accepted) {
          vibrateSignoff();
          signOffIngredient(idx, uid);
        } else {
          vibrateFail();
        }
      } catch {
        vibrateFail();
        setPhase('READY_FOR_SIGNOFF');
      }
    }
  }, [onNfcTapped, onSignoffAck, signOffIngredient, setPhase]);

  /**
   * Cancel NFC sign-off — stops listening and returns to IDLE
   * so operator can re-select the ingredient.
   */
  const handleNfcCancel = useCallback(() => {
    nfcActiveRef.current = false;
    nfcService.stopListening();
    nfcService.startListening().catch(() => {}); // re-arm for next use
    resetPicking();
  }, [resetPicking]);

  /**
   * Dismiss GIN_INVALID overlay — returns to AWAITING_SCAN.
   */
  const handleValidationDismiss = useCallback(() => {
    const { activeIngredientIndex: idx } = usePickingStore.getState();
    if (idx !== null) selectIngredient(idx);
  }, [selectIngredient]);

  // ── Derived values ────────────────────────────────────────────

  const activeIngredient =
    activeIngredientIndex !== null ? ingredients[activeIngredientIndex] : null;

  const showNfcPrompt =
    phase === 'READY_FOR_SIGNOFF' || phase === 'NFC_SIGNING';

  const showValidationOverlay = phase === 'GIN_INVALID';

  // ── Render ────────────────────────────────────────────────────

  // Batch complete
  if (batchStatus === 'complete') {
    return (
      <SafeAreaView style={styles.root}>
        <BatchCompletePanel
          productCode={productCode}
          batchNo={batchNo}
          description={description}
          ingredients={ingredients}
          onNextBatch={() => navigation.navigate('BatchSelect')}
        />
        <ConnectionBadge status={status} />
      </SafeAreaView>
    );
  }

  // No batch loaded — navigate to BatchSelect
  if (batchStatus === 'idle') {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.waiting}>
          <Text style={styles.waitingTitle}>No batch loaded</Text>
          <Pressable
            onPress={() => navigation.navigate('BatchSelect')}
            style={({ pressed }) => [styles.selectBatchButton, pressed && styles.selectBatchButtonPressed]}
          >
            <Text style={styles.selectBatchText}>Select Batch</Text>
          </Pressable>
        </View>
        <ConnectionBadge status={status} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      {/* ── Fixed header ──────────────────────────────────── */}
      <BatchHeader
        productCode={productCode}
        batchNo={batchNo}
        description={description}
        onSettings={openSettings}
      />

      {/* ── Main content ──────────────────────────────────── */}
      <View style={styles.body}>
        {/* Ingredient list — upper portion */}
        <View style={styles.listPane}>
          <IngredientList
            ingredients={ingredients}
            selectedIndex={activeIngredientIndex ?? -1}
            onSelect={selectIngredient}
          />
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Ingredient detail — lower portion */}
        <ScrollView
          ref={detailScrollRef}
          style={styles.detailPane}
          contentContainerStyle={styles.detailContent}
          keyboardShouldPersistTaps="handled"
        >
          {activeIngredient ? (
            <IngredientDetail
              ingredient={activeIngredient}
              phase={phase}
              pendingGin={pendingGin}
              scannerMode={scannerMode}
              onBagCountSelected={handleBagCountSelected}
              onManualGin={handleGinScanned}
              onInputFocus={() => setTimeout(() => detailScrollRef.current?.scrollToEnd({ animated: true }), 100)}
            />
          ) : (
            <View style={styles.noSelection}>
              <Text style={styles.noSelectionText}>
                Tap an ingredient above to begin
              </Text>
            </View>
          )}
        </ScrollView>
      </View>

      {/* ── Overlays ───────────────────────────────────────── */}

      <ValidationOverlay
        visible={showValidationOverlay}
        gin={pendingGin ?? ''}
        valid={false}
        ingredientName={activeIngredient?.name ?? ''}
        rejectReason={rejectReason ?? ''}
        onDismiss={handleValidationDismiss}
      />

      <NfcSignoffPrompt
        visible={showNfcPrompt}
        ingredientName={activeIngredient?.name ?? ''}
        onCancel={handleNfcCancel}
      />

      <DisconnectOverlay status={status} />
      <ConnectionBadge status={status} />
    </SafeAreaView>
  );
}

// ── Disconnect overlay ────────────────────────────────────────
// Covers the picking UI when connection is lost mid-workflow, blocking
// scans and making the situation obvious to the operator.

interface DisconnectOverlayProps {
  status: ReturnType<typeof useConnectionStore.getState>['status'];
}

function DisconnectOverlay({ status }: DisconnectOverlayProps): React.JSX.Element | null {
  if (status === 'connected') return null;
  return (
    <View style={styles.disconnectOverlay}>
      <Text style={styles.disconnectTitle}>
        {status === 'connecting' ? 'RECONNECTING…' : 'CONNECTION LOST'}
      </Text>
      <Text style={styles.disconnectBody}>
        {status === 'connecting'
          ? 'Attempting to reconnect to PLC'
          : 'Check network — reconnecting automatically'}
      </Text>
    </View>
  );
}

// ── Batch complete panel ──────────────────────────────────────

interface BatchCompletePanelProps {
  productCode: string;
  batchNo: string;
  description: string;
  ingredients: ReturnType<typeof useBatchStore.getState>['ingredients'];
  onNextBatch: () => void;
}

function BatchCompletePanel({
  productCode, batchNo, description, ingredients, onNextBatch,
}: BatchCompletePanelProps): React.JSX.Element {
  return (
    <ScrollView contentContainerStyle={styles.completeContainer}>
      <Text style={styles.completeTitle}>BATCH COMPLETE</Text>
      <Text style={styles.completeCodes}>{productCode}  |  {batchNo}</Text>
      <Text style={styles.completeDescription}>{description}</Text>

      <View style={styles.completeDivider} />

      {ingredients.map((ing, i) => (
        <View key={i} style={styles.completeRow}>
          <Text style={styles.completeCheck}>✓</Text>
          <View style={styles.completeRowBody}>
            <Text style={styles.completeIngredientName}>{ing.name}</Text>
            <Text style={styles.completeIngredientMeta}>
              {ing.collectedBags} bags · {ing.ginEntries.length} GIN{ing.ginEntries.length !== 1 ? 's' : ''}
              {ing.operatorId ? `  ·  op: ${ing.operatorId}` : ''}
            </Text>
          </View>
        </View>
      ))}

      <View style={styles.completeDivider} />
      <Pressable
        onPress={onNextBatch}
        style={({ pressed }) => [styles.nextBatchButton, pressed && styles.nextBatchButtonPressed]}
      >
        <Text style={styles.nextBatchText}>Next Batch</Text>
      </Pressable>
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1a2744',
  },
  body: {
    flex: 1,
    backgroundColor: '#f4f6fb',
  },
  listPane: {
    maxHeight: '45%',
  },
  divider: {
    height: 3,
    backgroundColor: '#253a6a',
  },
  detailPane: {
    flex: 1,
  },
  detailContent: {
    flexGrow: 1,
  },
  noSelection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  noSelectionText: {
    color: '#8899bb',
    fontSize: 16,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  // Waiting for batch
  waiting: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#1a2744',
  },
  menuButton: {
    position: 'absolute',
    top: 16,
    left: 16,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'space-between',
  },
  menuButtonPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  menuLine: {
    height: 3,
    borderRadius: 2,
    backgroundColor: '#ffffff',
  },
  waitingTitle: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 20,
  },
  selectBatchButton: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: '#4f78c7',
  },
  selectBatchButtonPressed: {
    backgroundColor: '#3d62ae',
  },
  selectBatchText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  // Batch complete
  completeContainer: {
    padding: 24,
    backgroundColor: '#1a2744',
    flexGrow: 1,
  },
  completeTitle: {
    color: '#4CAF50',
    fontSize: 32,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 8,
  },
  completeCodes: {
    color: '#a8bcd8',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 4,
  },
  completeDescription: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  completeDivider: {
    height: 1,
    backgroundColor: '#2e4a7a',
    marginVertical: 16,
  },
  completeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  completeCheck: {
    color: '#4CAF50',
    fontSize: 20,
    fontWeight: '800',
    marginRight: 10,
    marginTop: 2,
  },
  completeRowBody: {
    flex: 1,
  },
  completeIngredientName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  completeIngredientMeta: {
    color: '#8899bb',
    fontSize: 13,
    marginTop: 2,
  },
  nextBatchButton: {
    marginTop: 8,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: '#4f78c7',
    alignItems: 'center',
  },
  nextBatchButtonPressed: {
    backgroundColor: '#3d62ae',
  },
  nextBatchText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  // Disconnect overlay
  disconnectOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(26, 39, 68, 0.93)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    zIndex: 50,
  },
  disconnectTitle: {
    color: '#FF6B35',
    fontSize: 28,
    fontWeight: '900',
    marginBottom: 12,
    textAlign: 'center',
  },
  disconnectBody: {
    color: '#a8bcd8',
    fontSize: 16,
    textAlign: 'center',
  },
});
