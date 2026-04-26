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
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
import { scannerService } from '../services/ScannerService';
import { useBatchStore } from '../store/batchStore';
import { useConnectionStore } from '../store/connectionStore';
import { usePickingStore } from '../store/pickingStore';
import { useSettingsStore } from '../store/settingsStore';
import type { BatchRecipeMsg, GinValidationMsg } from '../types/protocol';
import { vibrateFail, vibrateSignoff, vibrateSuccess } from '../utils/audio';

// ── Component ─────────────────────────────────────────────────

export default function PickingScreen(): React.JSX.Element {
  // ── Store reads ──────────────────────────────────────────────
  const {
    productCode, batchNo, description,
    ingredients, batchStatus,
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

  // ── Refs ──────────────────────────────────────────────────────
  // Tracks whether the current NFC read is still relevant
  const nfcActiveRef = useRef(false);

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
   */
  const handleGinScanned = useCallback(async (gin: string) => {
    if (plcService.connectionState !== 'connected') return;

    const { phase: currentPhase, activeIngredientIndex: idx } =
      usePickingStore.getState();

    if (currentPhase !== 'AWAITING_SCAN' || idx === null) return;

    onGinScanned(gin);

    try {
      const result: GinValidationMsg = await plcService.sendGinScan(idx, gin);
      onGinValidated(result);
      if (result.valid) vibrateSuccess();
      else vibrateFail();
    } catch {
      vibrateFail();
      // Comms error — return to AWAITING_SCAN by re-selecting the ingredient
      selectIngredient(idx);
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
   * Advances to NFC_SIGNING, fires INGREDIENT_SIGNOFF to PLC.
   */
  const handleNfcTagRead = useCallback(async (operatorId: string) => {
    const { activeIngredientIndex: idx } = usePickingStore.getState();
    if (idx === null) return;

    onNfcTapped(operatorId);

    const ingredient = useBatchStore.getState().ingredients[idx];
    if (!ingredient) return;

    try {
      const result = await plcService.sendIngredientSignoff({
        ingredientIndex: idx,
        operatorId,
        ginCount: ingredient.ginEntries.length,
        ginEntries: ingredient.ginEntries.map((e) => ({
          gin: e.gin,
          bagCount: e.bagCount,
        })),
      });

      onSignoffAck(result);

      if (result.accepted) {
        vibrateSignoff();
        signOffIngredient(idx, operatorId);
      } else {
        vibrateFail();
        // onSignoffAck already moved phase back to READY_FOR_SIGNOFF
        // which will re-trigger the NFC useEffect
      }
    } catch {
      vibrateFail();
      setPhase('READY_FOR_SIGNOFF'); // comms error — let operator re-tap
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

  // Batch complete — show summary overlay inline (Phase 3 will navigate)
  if (batchStatus === 'complete') {
    return (
      <SafeAreaView style={styles.root}>
        <BatchCompletePanel
          productCode={productCode}
          batchNo={batchNo}
          description={description}
          ingredients={ingredients}
        />
        <ConnectionBadge status={status} />
      </SafeAreaView>
    );
  }

  // No batch yet — waiting for PLC to push BATCH_RECIPE
  if (batchStatus === 'idle') {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.waiting}>
          <Text style={styles.waitingTitle}>Awaiting batch…</Text>
          <Text style={styles.waitingBody}>
            Select a batch on the HMI to begin.
          </Text>
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
}

function BatchCompletePanel({
  productCode, batchNo, description, ingredients,
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
              {ing.operatorId ? `  ·  op: ${ing.operatorId.slice(0, 8)}` : ''}
            </Text>
          </View>
        </View>
      ))}

      <View style={styles.completeDivider} />
      <Text style={styles.completeFooter}>Awaiting next batch…</Text>
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f4f6fb',
  },
  body: {
    flex: 1,
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
  waitingTitle: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 12,
  },
  waitingBody: {
    color: '#a8bcd8',
    fontSize: 16,
    textAlign: 'center',
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
  completeFooter: {
    color: '#8899bb',
    fontSize: 15,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: 8,
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
