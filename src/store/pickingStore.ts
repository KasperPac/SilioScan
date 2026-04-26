// ============================================================
// pickingStore.ts — active ingredient state machine (ARCHITECTURE.md §7)
//
// State machine:
//   IDLE
//     └─ selectIngredient() ──────────────────────────────────────────┐
//                                                                      │
//   AWAITING_SCAN ◄────────────────────────── (more bags needed) ◄────┘
//     └─ onGinScanned(gin) ─────┐
//                               │
//   VALIDATING                  │
//     └─ onGinValidated() ──────┴──► GIN_INVALID ──► (back to AWAITING_SCAN)
//                               │
//                               ▼
//   AWAITING_BAG_COUNT
//     └─ onBagCountSelected(n) ─┬──► AWAITING_SCAN   (more bags still needed)
//                               └──► READY_FOR_SIGNOFF (all bags collected)
//
//   READY_FOR_SIGNOFF
//     └─ onNfcTapped(operatorId) ──► NFC_SIGNING
//
//   NFC_SIGNING
//     └─ onSignoffAck(result) ──► SIGNED_OFF         (accepted)
//                             └──► READY_FOR_SIGNOFF  (rejected — re-tap)
//
// Guards (silently ignored if violated):
//   • onGinScanned     — blocked unless AWAITING_SCAN
//   • onGinValidated   — blocked unless VALIDATING
//   • onBagCountSelected — blocked unless AWAITING_BAG_COUNT
//   • onNfcTapped      — blocked unless READY_FOR_SIGNOFF
//   • onSignoffAck     — blocked unless NFC_SIGNING
// ============================================================

import { create } from 'zustand';
import { GinValidationMsg, SignoffAckMsg } from '../types/protocol';
import { useBatchStore } from './batchStore';

// ── Types ────────────────────────────────────────────────────

export type PickingPhase =
  | 'IDLE'
  | 'AWAITING_SCAN'
  | 'VALIDATING'
  | 'GIN_VALID'
  | 'GIN_INVALID'
  | 'AWAITING_BAG_COUNT'
  | 'READY_FOR_SIGNOFF'
  | 'NFC_SIGNING'
  | 'SIGNED_OFF';

// ── Store ────────────────────────────────────────────────────

interface PickingState {
  phase: PickingPhase;
  activeIngredientIndex: number | null;

  /** GIN currently being validated or just validated (cleared after bag count). */
  pendingGin: string | null;

  /** NFC UID captured during NFC_SIGNING — sent with INGREDIENT_SIGNOFF. */
  pendingOperatorId: string | null;

  /** Populated when phase = GIN_INVALID. */
  rejectReason: string | null;

  /** Mirrors batchStore collectedBags for the active ingredient. Kept here
   *  to determine AWAITING_SCAN vs READY_FOR_SIGNOFF without reading batchStore
   *  in every render. Updated by selectIngredient() and onBagCountSelected(). */
  collectedBags: number;

  /** Required bags for the active ingredient (read from batchStore on select). */
  requiredBags: number;

  // ── Actions ──────────────────────────────────────────────

  /** Choose an ingredient to work on — resets scan state, reads bag counts
   *  from batchStore to know when READY_FOR_SIGNOFF. */
  selectIngredient: (index: number) => void;

  /** Call when the operator scans a GIN barcode. Transitions AWAITING_SCAN →
   *  VALIDATING. Blocked in any other phase (double-scan guard). */
  onGinScanned: (gin: string) => void;

  /** Call when PlcService resolves sendGinScan(). Transitions VALIDATING →
   *  AWAITING_BAG_COUNT (valid) or GIN_INVALID (invalid). */
  onGinValidated: (result: GinValidationMsg) => void;

  /** Call when operator selects a bag count. Adds the bag count to the
   *  running total and transitions to AWAITING_SCAN (more needed) or
   *  READY_FOR_SIGNOFF (all bags collected). */
  onBagCountSelected: (count: number) => void;

  /** Call when NFC tag read fires. Transitions READY_FOR_SIGNOFF → NFC_SIGNING. */
  onNfcTapped: (operatorId: string) => void;

  /** Call when PlcService resolves sendIngredientSignoff(). Transitions
   *  NFC_SIGNING → SIGNED_OFF (accepted) or back to READY_FOR_SIGNOFF (rejected). */
  onSignoffAck: (result: SignoffAckMsg) => void;

  /** Escape hatch — force a specific phase (use sparingly, e.g. error recovery). */
  setPhase: (phase: PickingPhase) => void;

  /** Return to IDLE, clear all transient state. */
  reset: () => void;
}

const IDLE_STATE: Pick<PickingState,
  'phase' | 'activeIngredientIndex' | 'pendingGin' | 'pendingOperatorId' |
  'rejectReason' | 'collectedBags' | 'requiredBags'
> = {
  phase: 'IDLE',
  activeIngredientIndex: null,
  pendingGin: null,
  pendingOperatorId: null,
  rejectReason: null,
  collectedBags: 0,
  requiredBags: 0,
};

export const usePickingStore = create<PickingState>()((set, get) => ({
  ...IDLE_STATE,

  selectIngredient: (index) => {
    const ingredient = useBatchStore.getState().ingredients[index];
    const collectedBags = ingredient?.collectedBags ?? 0;
    const requiredBags = ingredient?.requiredBags ?? 0;
    // If all bags already collected (e.g. operator re-selects after NFC cancel),
    // go straight to READY_FOR_SIGNOFF instead of AWAITING_SCAN.
    const allCollected = requiredBags > 0 && collectedBags >= requiredBags;
    set({
      activeIngredientIndex: index,
      phase: allCollected ? 'READY_FOR_SIGNOFF' : 'AWAITING_SCAN',
      pendingGin: null,
      pendingOperatorId: null,
      rejectReason: null,
      collectedBags,
      requiredBags,
    });
  },

  onGinScanned: (gin) => {
    if (get().phase !== 'AWAITING_SCAN') return; // guard: block during VALIDATING, etc.
    set({ phase: 'VALIDATING', pendingGin: gin });
  },

  onGinValidated: (result) => {
    if (get().phase !== 'VALIDATING') return;
    if (result.valid) {
      set({ phase: 'AWAITING_BAG_COUNT', rejectReason: null });
    } else {
      set({ phase: 'GIN_INVALID', rejectReason: result.rejectReason || null });
    }
  },

  onBagCountSelected: (count) => {
    const { phase, collectedBags, requiredBags } = get();
    if (phase !== 'AWAITING_BAG_COUNT') return; // guard: must have a valid GIN first
    const newCollected = collectedBags + count;
    const allCollected = newCollected >= requiredBags;
    set({
      collectedBags: newCollected,
      pendingGin: null,
      phase: allCollected ? 'READY_FOR_SIGNOFF' : 'AWAITING_SCAN',
    });
  },

  onNfcTapped: (operatorId) => {
    if (get().phase !== 'READY_FOR_SIGNOFF') return; // guard
    set({ phase: 'NFC_SIGNING', pendingOperatorId: operatorId });
  },

  onSignoffAck: (result) => {
    if (get().phase !== 'NFC_SIGNING') return;
    if (result.accepted) {
      set({ phase: 'SIGNED_OFF' });
    } else {
      // PLC rejected — let operator re-tap NFC
      set({ phase: 'READY_FOR_SIGNOFF', rejectReason: result.rejectReason || null });
    }
  },

  setPhase: (phase) => set({ phase }),

  reset: () => set({ ...IDLE_STATE }),
}));
