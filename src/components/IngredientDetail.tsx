// ============================================================
// IngredientDetail.tsx — detail panel for the active ingredient
// Shows progress, scanned GINs, bag count selector, camera scanner.
// Phase-driven rendering: content changes with pickingStore phase.
// ============================================================

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { IngredientProgress } from '../store/batchStore';
import type { PickingPhase } from '../store/pickingStore';
import type { ScannerMode } from '../store/settingsStore';
import BagCountSelector from './BagCountSelector';
import CameraScanner from './CameraScanner';
import GinList from './GinList';

interface Props {
  ingredient: IngredientProgress;
  phase: PickingPhase;
  pendingGin: string | null;
  scannerMode: ScannerMode;
  onBagCountSelected: (count: number) => void;
}

export default function IngredientDetail({
  ingredient,
  phase,
  pendingGin,
  scannerMode,
  onBagCountSelected,
}: Props): React.JSX.Element {
  const { name, requiredBags, collectedBags, ginEntries } = ingredient;
  const progressPct = requiredBags > 0 ? Math.min(1, collectedBags / requiredBags) : 0;
  const bagsRemaining = Math.max(0, requiredBags - collectedBags);
  const maxSelectable = Math.min(5, bagsRemaining);

  const showCamera =
    (scannerMode === 'camera' || scannerMode === 'auto') &&
    (phase === 'AWAITING_SCAN' || phase === 'GIN_INVALID');

  return (
    <View style={styles.container}>
      {/* ── Header ──────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={2}>{name.toUpperCase()}</Text>
        <Text style={styles.bagsNeeded}>{requiredBags} bags needed</Text>
      </View>

      {/* ── Progress bar ────────────────────────────────────── */}
      <View style={styles.progressSection}>
        <Text style={styles.progressLabel}>
          Collected:{' '}
          <Text style={collectedBags >= requiredBags ? styles.progressDone : styles.progressCount}>
            {collectedBags} / {requiredBags}
          </Text>
          {' '}bags
        </Text>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${progressPct * 100}%` },
              collectedBags >= requiredBags && styles.progressFillDone,
            ]}
          />
        </View>
      </View>

      {/* ── Scanned GINs ───────────────────────────────────── */}
      <GinList entries={ginEntries} />

      {/* ── Phase-specific action area ───────────────────────  */}

      {/* Awaiting scan — show camera if in camera mode */}
      {showCamera && (
        <CameraScanner active={phase === 'AWAITING_SCAN'} />
      )}

      {/* Awaiting scan — HW mode hint */}
      {phase === 'AWAITING_SCAN' && scannerMode === 'hardware' && (
        <View style={styles.hwHint}>
          <Text style={styles.hwHintText}>Scan next GIN barcode with scanner</Text>
        </View>
      )}

      {/* Validating — spinner */}
      {phase === 'VALIDATING' && (
        <View style={styles.validating}>
          <ActivityIndicator color="#FF9800" size="large" />
          <Text style={styles.validatingText}>
            Validating{pendingGin ? `  GIN ${pendingGin}` : ''}…
          </Text>
        </View>
      )}

      {/* Bag count selector */}
      {phase === 'AWAITING_BAG_COUNT' && (
        <View style={styles.bagCountSection}>
          <Text style={styles.bagCountLabel}>
            Bags for GIN {pendingGin}:
          </Text>
          <BagCountSelector maxSelectable={maxSelectable} onSelect={onBagCountSelected} />
        </View>
      )}

      {/* Ready for signoff — prompt (the modal overlay handles the NFC UI) */}
      {(phase === 'READY_FOR_SIGNOFF' || phase === 'NFC_SIGNING') && (
        <View style={styles.signoffPrompt}>
          <Text style={styles.signoffPromptText}>
            {phase === 'NFC_SIGNING' ? 'Waiting for NFC sign-off…' : 'All bags collected — tap NFC tag to sign off'}
          </Text>
        </View>
      )}

      {/* Signed off confirmation */}
      {phase === 'SIGNED_OFF' && (
        <View style={styles.signedOff}>
          <Text style={styles.signedOffIcon}>✓</Text>
          <Text style={styles.signedOffText}>Ingredient signed off</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    padding: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  name: {
    flex: 1,
    fontSize: 20,
    fontWeight: '800',
    color: '#1a2744',
    lineHeight: 26,
    marginRight: 12,
  },
  bagsNeeded: {
    fontSize: 14,
    fontWeight: '600',
    color: '#5b6577',
    paddingTop: 4,
  },
  progressSection: {
    marginBottom: 10,
  },
  progressLabel: {
    fontSize: 14,
    color: '#5b6577',
    marginBottom: 6,
  },
  progressCount: {
    fontWeight: '700',
    color: '#1a2744',
  },
  progressDone: {
    fontWeight: '700',
    color: '#1f9d55',
  },
  progressTrack: {
    height: 10,
    backgroundColor: '#e4eaf5',
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#2d6aff',
    borderRadius: 5,
  },
  progressFillDone: {
    backgroundColor: '#1f9d55',
  },
  validating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff8e6',
    borderRadius: 10,
    padding: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#ffe08a',
  },
  validatingText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#8a6200',
    flex: 1,
  },
  bagCountSection: {
    marginTop: 12,
  },
  bagCountLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a2744',
    marginBottom: 10,
  },
  hwHint: {
    marginTop: 10,
    padding: 12,
    backgroundColor: '#f0f4ff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#c5d5f5',
  },
  hwHintText: {
    fontSize: 14,
    color: '#3a5a9a',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  signoffPrompt: {
    marginTop: 12,
    padding: 14,
    backgroundColor: '#e8f5e9',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#4CAF50',
    alignItems: 'center',
  },
  signoffPromptText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1b5e20',
    textAlign: 'center',
  },
  signedOff: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#e8f5e9',
    borderRadius: 12,
    padding: 16,
  },
  signedOffIcon: {
    fontSize: 28,
    color: '#1f9d55',
    fontWeight: '800',
  },
  signedOffText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1f9d55',
  },
});
