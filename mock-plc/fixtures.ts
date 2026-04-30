// ============================================================
// fixtures.ts — Sample batch data for mock PLC server
// ============================================================

import { BatchRecipeMsg } from '../src/types/protocol';

// ── Primary test batch ────────────────────────────────────────
// 4 ingredients, uses valid GINs starting with "1"
// GINs starting with anything else → FAIL (per mock server rule)

export const FIXTURE_BATCH_RECIPE: BatchRecipeMsg = {
  msgType: 0x80,
  seqNum: 1,
  productCode: 'PF-2001',
  batchNo: 'B-20260320-001',
  productDescription: 'Premium Dog Kibble',
  ingredientCount: 4,
  ingredients: [
    { ingredientName: 'Wheat Flour',    requiredBags: 6, signedOff: false },
    { ingredientName: 'Soy Meal',       requiredBags: 4, signedOff: false },
    { ingredientName: 'Bone Meal',      requiredBags: 2, signedOff: false },
    { ingredientName: 'Vitamin Premix', requiredBags: 2, signedOff: false },
  ],
};

// ── Valid GINs (start with "1") ───────────────────────────────
// Use these when testing happy path:
//   Wheat Flour  → 100001, 100002, 100003
//   Soy Meal     → 100010, 100011
//   Bone Meal    → 100020
//   Vitamin Pre  → 100030

export const VALID_GINS: Record<string, string[]> = {
  'Wheat Flour':    ['100001', '100002', '100003'],
  'Soy Meal':       ['100010', '100011'],
  'Bone Meal':      ['100020'],
  'Vitamin Premix': ['100030'],
};

// ── Invalid GINs (do NOT start with "1") ─────────────────────
// Use these when testing rejection path:
export const INVALID_GINS = ['900001', '500001', '200001', 'ABC999'];

// ── Secondary test batch (single ingredient) ─────────────────
export const FIXTURE_BATCH_RECIPE_SMALL: BatchRecipeMsg = {
  msgType: 0x80,
  seqNum: 2,
  productCode: 'CF-1001',
  batchNo: 'B-20260320-002',
  productDescription: 'Cat Food Standard',
  ingredientCount: 1,
  ingredients: [
    { ingredientName: 'Fish Meal', requiredBags: 3, signedOff: false },
  ],
};
