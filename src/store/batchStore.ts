// ============================================================
// batchStore.ts — full recipe state (ARCHITECTURE.md §7)
// Populated from PLC BATCH_RECIPE push; tracks per-ingredient
// GIN entries and sign-off status.
// ============================================================

import { create } from 'zustand';
import { BatchRecipeMsg } from '../types/protocol';

// ── Types ────────────────────────────────────────────────────

/** One validated GIN scan that contributed bags to an ingredient. */
export interface IngredientGinEntry {
  gin: string;
  bagCount: number;
  validated: boolean;
}

/** Live progress state for one ingredient in the active batch. */
export interface IngredientProgress {
  name: string;
  requiredBags: number;
  collectedBags: number;
  ginEntries: IngredientGinEntry[];
  signedOff: boolean;
  operatorId: string | null;
}

// ── Store ────────────────────────────────────────────────────

interface BatchState {
  productCode: string;
  batchNo: string;
  description: string;
  ingredients: IngredientProgress[];
  batchStatus: 'idle' | 'active' | 'complete';

  /** Populate store from an incoming BATCH_RECIPE PLC message. */
  setBatchRecipe: (recipe: BatchRecipeMsg) => void;

  /** Add a validated GIN entry (with bag count) for one ingredient. */
  updateIngredientProgress: (index: number, entry: IngredientGinEntry) => void;

  /** Mark ingredient as signed off with the operator's NFC UID. */
  signOffIngredient: (index: number, operatorId: string) => void;

  /** Returns true when every ingredient has been signed off. */
  isBatchComplete: () => boolean;

  /** Clear all state ready for the next batch. */
  reset: () => void;
}

const EMPTY: Omit<BatchState,
  'setBatchRecipe' | 'updateIngredientProgress' | 'signOffIngredient' | 'isBatchComplete' | 'reset'
> = {
  productCode: '',
  batchNo: '',
  description: '',
  ingredients: [],
  batchStatus: 'idle',
};

export const useBatchStore = create<BatchState>()((set, get) => ({
  ...EMPTY,

  setBatchRecipe: (recipe) => {
    const ingredients = recipe.ingredients.map((ing) => ({
      name: ing.ingredientName,
      requiredBags: ing.requiredBags,
      collectedBags: ing.signedOff ? ing.requiredBags : 0,
      ginEntries: [],
      signedOff: ing.signedOff,
      operatorId: null,
    }));
    const allDone = ingredients.length > 0 && ingredients.every((ing) => ing.signedOff);
    set({
      productCode: recipe.productCode,
      batchNo: recipe.batchNo,
      description: recipe.productDescription,
      batchStatus: allDone ? 'complete' : 'active',
      ingredients,
    });
  },

  updateIngredientProgress: (index, entry) =>
    set((state) => ({
      ingredients: state.ingredients.map((ing, i) =>
        i !== index
          ? ing
          : {
              ...ing,
              ginEntries: [...ing.ginEntries, entry],
              collectedBags: ing.collectedBags + entry.bagCount,
            },
      ),
    })),

  signOffIngredient: (index, operatorId) =>
    set((state) => {
      const ingredients = state.ingredients.map((ing, i) =>
        i !== index ? ing : { ...ing, signedOff: true, operatorId },
      );
      const allDone = ingredients.length > 0 && ingredients.every((ing) => ing.signedOff);
      return { ingredients, batchStatus: allDone ? 'complete' : 'active' };
    }),

  isBatchComplete: () => {
    const { ingredients, batchStatus } = get();
    return (
      batchStatus === 'active' &&
      ingredients.length > 0 &&
      ingredients.every((ing) => ing.signedOff)
    );
  },

  reset: () => set({ ...EMPTY }),
}));
