// ============================================================
// protocol.ts — TypeScript mirrors of all Omron PLC UDTs
// All byte offsets match ARCHITECTURE.md Section 3.2 exactly.
// ============================================================

// ----------------------------------------------------------------
// Shared
// ----------------------------------------------------------------

export const MSG_TYPE = {
  // App -> PLC
  GIN_SCAN: 0x01,
  INGREDIENT_SIGNOFF: 0x02,
  HEARTBEAT: 0x10,
  // PLC -> App
  BATCH_RECIPE: 0x80,
  GIN_VALIDATION: 0x81,
  SIGNOFF_ACK: 0x82,
  HEARTBEAT_REPLY: 0x90,
} as const;

export type MsgType = (typeof MSG_TYPE)[keyof typeof MSG_TYPE];

// ----------------------------------------------------------------
// PLC -> App
// ----------------------------------------------------------------

/** One element of the ingredients array inside BATCH_RECIPE. 48 bytes. */
export interface IngredientRecord {
  ingredientName: string; // 32 bytes, null-padded ASCII
  requiredBags: number;   // UINT (uint16BE)
  signedOff: boolean;     // byte [34]: 0x01 = already signed off on PLC
  // 13 bytes reserved — not surfaced
}

/** BATCH_RECIPE (0x80) — PLC pushes when batch selected on HMI. */
export interface BatchRecipeMsg {
  msgType: 0x80;
  seqNum: number;
  productCode: string;        // 16 bytes
  batchNo: string;            // 16 bytes
  productDescription: string; // 32 bytes
  ingredientCount: number;    // 1–20
  ingredients: IngredientRecord[];
}

/** GIN_VALIDATION (0x81) — PLC responds after GIN_SCAN. */
export interface GinValidationMsg {
  msgType: 0x81;
  seqNum: number;
  gin: string;            // 16 bytes, echo back
  valid: boolean;         // 0x00 = FAIL, 0x01 = PASS
  ingredientName: string; // 32 bytes, confirmed name
  rejectReason: string;   // 32 bytes, populated on FAIL
}

/** SIGNOFF_ACK (0x82) — PLC responds after INGREDIENT_SIGNOFF. */
export interface SignoffAckMsg {
  msgType: 0x82;
  seqNum: number;
  ingredientIndex: number; // BYTE
  accepted: boolean;       // 0x00 = REJECTED, 0x01 = ACCEPTED
  rejectReason: string;    // 32 bytes, populated on REJECTED
}

/** HEARTBEAT_REPLY (0x90). */
export interface HeartbeatReplyMsg {
  msgType: 0x90;
  seqNum: number; // echoed back
}

// ----------------------------------------------------------------
// App -> PLC
// ----------------------------------------------------------------

/** GIN_SCAN (0x01) — App sends after operator scans barcode. */
export interface GinScanMsg {
  msgType: 0x01;
  seqNum: number;
  ingredientIndex: number; // BYTE
  gin: string;             // 16 bytes, null-padded ASCII
}

/** One entry in the INGREDIENT_SIGNOFF ginEntries array. 20 bytes. */
export interface GinEntry {
  gin: string;      // 16 bytes, null-padded ASCII
  bagCount: number; // UINT (uint16BE)
  // 2 bytes reserved — not surfaced
}

/** INGREDIENT_SIGNOFF (0x02) — App sends when operator taps NFC. */
export interface IngredientSignoffMsg {
  msgType: 0x02;
  seqNum: number;
  ingredientIndex: number; // BYTE
  operatorId: string;      // 16 bytes, NFC tag UID, null-padded
  ginCount: number;        // BYTE, 1–5
  ginEntries: GinEntry[];  // max 5
}

/** HEARTBEAT (0x10). */
export interface HeartbeatMsg {
  msgType: 0x10;
  seqNum: number;
}

// ----------------------------------------------------------------
// Union — all decoded messages
// ----------------------------------------------------------------

export type PlcMessage =
  | BatchRecipeMsg
  | GinValidationMsg
  | SignoffAckMsg
  | HeartbeatReplyMsg;

export type AppMessage =
  | GinScanMsg
  | IngredientSignoffMsg
  | HeartbeatMsg;

export type AnyMessage = PlcMessage | AppMessage;
