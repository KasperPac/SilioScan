// ============================================================
// ProtocolCodec.ts — Binary serialize / deserialize for all
// PAC-Scanner message types (ARCHITECTURE.md §3.2)
//
// Rules enforced here:
//   • All strings are null-padded ASCII in fixed-width byte arrays
//   • All multi-byte integers are big-endian (uint16BE)
//   • Byte layouts match the Omron UDTs in §3.3 exactly
// ============================================================

import {
  MSG_TYPE,
  BatchRecipeMsg,
  GinValidationMsg,
  SignoffAckMsg,
  HeartbeatReplyMsg,
  GinScanMsg,
  IngredientSignoffMsg,
  HeartbeatMsg,
  IngredientRecord,
  GinEntry,
  AnyMessage,
} from '../types/protocol';

// ----------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------

function writeAscii(buf: Buffer, offset: number, str: string, len: number): void {
  buf.fill(0, offset, offset + len);
  const src = Buffer.from(str, 'ascii');
  src.copy(buf, offset, 0, Math.min(src.length, len));
}

function readAscii(buf: Buffer, offset: number, len: number): string {
  let result = '';
  for (let i = offset; i < offset + len; i++) {
    const byte = buf[i];
    if (byte === 0) break;
    result += String.fromCharCode(byte);
  }
  return result;
}

// ----------------------------------------------------------------
// BATCH_RECIPE (0x80) — PLC -> App
//
// Byte 0        : msgType
// Byte 1–2      : seqNum (uint16BE)
// Byte 3–18     : productCode (16 bytes)
// Byte 19–34    : batchNo (16 bytes)
// Byte 35–66    : productDescription (32 bytes)
// Byte 67       : ingredientCount
// Byte 68+      : ingredients × 48 bytes each
//                   [0–31]  ingredientName (32 bytes)
//                   [32–33] requiredBags (uint16BE)
//                   [34]    signedOff (0x00=no, 0x01=yes)
//                   [35–47] reserved (13 bytes)
// ----------------------------------------------------------------

const INGREDIENT_RECORD_SIZE = 48;
const BATCH_RECIPE_FIXED_SIZE = 68; // bytes before ingredient array

export function encodeBatchRecipe(msg: BatchRecipeMsg): Buffer {
  const count = msg.ingredients.length;
  const buf = Buffer.alloc(BATCH_RECIPE_FIXED_SIZE + count * INGREDIENT_RECORD_SIZE);

  buf[0] = MSG_TYPE.BATCH_RECIPE;
  buf.writeUInt16BE(msg.seqNum, 1);
  writeAscii(buf, 3, msg.productCode, 16);
  writeAscii(buf, 19, msg.batchNo, 16);
  writeAscii(buf, 35, msg.productDescription, 32);
  buf[67] = count;

  for (let i = 0; i < count; i++) {
    const base = BATCH_RECIPE_FIXED_SIZE + i * INGREDIENT_RECORD_SIZE;
    const ing = msg.ingredients[i];
    writeAscii(buf, base, ing.ingredientName, 32);
    buf.writeUInt16BE(ing.requiredBags, base + 32);
    buf.fill(0, base + 34, base + INGREDIENT_RECORD_SIZE); // reserved
  }

  return buf;
}

export function decodeBatchRecipe(payload: Buffer): BatchRecipeMsg {
  const ingredientCount = payload[67];
  const ingredients: IngredientRecord[] = [];

  for (let i = 0; i < ingredientCount; i++) {
    const base = BATCH_RECIPE_FIXED_SIZE + i * INGREDIENT_RECORD_SIZE;
    ingredients.push({
      ingredientName: readAscii(payload, base, 32),
      requiredBags: payload.readUInt16BE(base + 32),
      signedOff: payload[base + 34] === 0x01,
    });
  }

  return {
    msgType: 0x80,
    seqNum: payload.readUInt16BE(1),
    productCode: readAscii(payload, 3, 16),
    batchNo: readAscii(payload, 19, 16),
    productDescription: readAscii(payload, 35, 32),
    ingredientCount,
    ingredients,
  };
}

// ----------------------------------------------------------------
// GIN_VALIDATION (0x81) — PLC -> App
//
// Byte 0        : msgType
// Byte 1–2      : seqNum (uint16BE)
// Byte 3–18     : gin (16 bytes)
// Byte 19       : valid (0x00=FAIL, 0x01=PASS)
// Byte 20–51    : ingredientName (32 bytes)
// Byte 52–83    : rejectReason (32 bytes)
// ----------------------------------------------------------------

const GIN_VALIDATION_SIZE = 84;

export function encodeGinValidation(msg: GinValidationMsg): Buffer {
  const buf = Buffer.alloc(GIN_VALIDATION_SIZE);

  buf[0] = MSG_TYPE.GIN_VALIDATION;
  buf.writeUInt16BE(msg.seqNum, 1);
  writeAscii(buf, 3, msg.gin, 16);
  buf[19] = msg.valid ? 0x01 : 0x00;
  writeAscii(buf, 20, msg.ingredientName, 32);
  writeAscii(buf, 52, msg.rejectReason, 32);

  return buf;
}

export function decodeGinValidation(payload: Buffer): GinValidationMsg {
  return {
    msgType: 0x81,
    seqNum: payload.readUInt16BE(1),
    gin: readAscii(payload, 3, 16),
    valid: payload[19] === 0x01,
    ingredientName: readAscii(payload, 20, 32),
    rejectReason: readAscii(payload, 52, 32),
  };
}

// ----------------------------------------------------------------
// SIGNOFF_ACK (0x82) — PLC -> App
//
// Byte 0        : msgType
// Byte 1–2      : seqNum (uint16BE)
// Byte 3        : ingredientIndex
// Byte 4        : accepted (0x00=REJECTED, 0x01=ACCEPTED)
// Byte 5–36     : rejectReason (32 bytes)
// ----------------------------------------------------------------

const SIGNOFF_ACK_SIZE = 37;

export function encodeSignoffAck(msg: SignoffAckMsg): Buffer {
  const buf = Buffer.alloc(SIGNOFF_ACK_SIZE);

  buf[0] = MSG_TYPE.SIGNOFF_ACK;
  buf.writeUInt16BE(msg.seqNum, 1);
  buf[3] = msg.ingredientIndex;
  buf[4] = msg.accepted ? 0x01 : 0x00;
  writeAscii(buf, 5, msg.rejectReason, 32);

  return buf;
}

export function decodeSignoffAck(payload: Buffer): SignoffAckMsg {
  return {
    msgType: 0x82,
    seqNum: payload.readUInt16BE(1),
    ingredientIndex: payload[3],
    accepted: payload[4] === 0x01,
    rejectReason: readAscii(payload, 5, 32),
  };
}

// ----------------------------------------------------------------
// HEARTBEAT_REPLY (0x90) — PLC -> App
//
// Byte 0        : msgType
// Byte 1–2      : seqNum (uint16BE, echoed)
// ----------------------------------------------------------------

const HEARTBEAT_REPLY_SIZE = 3;

export function encodeHeartbeatReply(msg: HeartbeatReplyMsg): Buffer {
  const buf = Buffer.alloc(HEARTBEAT_REPLY_SIZE);
  buf[0] = MSG_TYPE.HEARTBEAT_REPLY;
  buf.writeUInt16BE(msg.seqNum, 1);
  return buf;
}

export function decodeHeartbeatReply(payload: Buffer): HeartbeatReplyMsg {
  return {
    msgType: 0x90,
    seqNum: payload.readUInt16BE(1),
  };
}

// ----------------------------------------------------------------
// GIN_SCAN (0x01) — App -> PLC
//
// Byte 0        : msgType
// Byte 1–2      : seqNum (uint16BE)
// Byte 3        : ingredientIndex
// Byte 4–19     : gin (16 bytes, null-padded ASCII)
// ----------------------------------------------------------------

const GIN_SCAN_SIZE = 20;

export function encodeGinScan(msg: GinScanMsg): Buffer {
  const buf = Buffer.alloc(GIN_SCAN_SIZE);
  buf[0] = MSG_TYPE.GIN_SCAN;
  buf.writeUInt16BE(msg.seqNum, 1);
  buf[3] = msg.ingredientIndex;
  writeAscii(buf, 4, msg.gin, 16);
  return buf;
}

export function decodeGinScan(payload: Buffer): GinScanMsg {
  return {
    msgType: 0x01,
    seqNum: payload.readUInt16BE(1),
    ingredientIndex: payload[3],
    gin: readAscii(payload, 4, 16),
  };
}

// ----------------------------------------------------------------
// INGREDIENT_SIGNOFF (0x02) — App -> PLC
//
// Byte 0        : msgType
// Byte 1–2      : seqNum (uint16BE)
// Byte 3        : ingredientIndex
// Byte 4–19     : operatorId (16 bytes, null-padded)
// Byte 20       : ginCount (1–5)
// Byte 21+      : GIN entries × 20 bytes each
//                   [0–15]  gin (16 bytes, null-padded ASCII)
//                   [16–17] bagCount (uint16BE)
//                   [18–19] reserved
// ----------------------------------------------------------------

const GIN_ENTRY_SIZE = 20;
const SIGNOFF_FIXED_SIZE = 21; // bytes before ginEntries array

export function encodeIngredientSignoff(msg: IngredientSignoffMsg): Buffer {
  const count = msg.ginEntries.length;
  const buf = Buffer.alloc(SIGNOFF_FIXED_SIZE + count * GIN_ENTRY_SIZE);

  buf[0] = MSG_TYPE.INGREDIENT_SIGNOFF;
  buf.writeUInt16BE(msg.seqNum, 1);
  buf[3] = msg.ingredientIndex;
  writeAscii(buf, 4, msg.operatorId, 16);
  buf[20] = count;

  for (let i = 0; i < count; i++) {
    const base = SIGNOFF_FIXED_SIZE + i * GIN_ENTRY_SIZE;
    const entry = msg.ginEntries[i];
    writeAscii(buf, base, entry.gin, 16);
    buf.writeUInt16BE(entry.bagCount, base + 16);
    buf.fill(0, base + 18, base + GIN_ENTRY_SIZE); // reserved
  }

  return buf;
}

export function decodeIngredientSignoff(payload: Buffer): IngredientSignoffMsg {
  const ginCount = payload[20];
  const ginEntries: GinEntry[] = [];

  for (let i = 0; i < ginCount; i++) {
    const base = SIGNOFF_FIXED_SIZE + i * GIN_ENTRY_SIZE;
    ginEntries.push({
      gin: readAscii(payload, base, 16),
      bagCount: payload.readUInt16BE(base + 16),
    });
  }

  return {
    msgType: 0x02,
    seqNum: payload.readUInt16BE(1),
    ingredientIndex: payload[3],
    operatorId: readAscii(payload, 4, 16),
    ginCount,
    ginEntries,
  };
}

// ----------------------------------------------------------------
// HEARTBEAT (0x10) — App -> PLC
//
// Byte 0        : msgType
// Byte 1–2      : seqNum (uint16BE)
// ----------------------------------------------------------------

const HEARTBEAT_SIZE = 3;

export function encodeHeartbeat(msg: HeartbeatMsg): Buffer {
  const buf = Buffer.alloc(HEARTBEAT_SIZE);
  buf[0] = MSG_TYPE.HEARTBEAT;
  buf.writeUInt16BE(msg.seqNum, 1);
  return buf;
}

export function decodeHeartbeat(payload: Buffer): HeartbeatMsg {
  return {
    msgType: 0x10,
    seqNum: payload.readUInt16BE(1),
  };
}

// ----------------------------------------------------------------
// parseMessage — dispatch on msgType (byte 0)
// ----------------------------------------------------------------

export function parseMessage(payload: Buffer): AnyMessage {
  if (payload.length < 1) {
    throw new Error('Empty payload');
  }

  const msgType = payload[0];

  switch (msgType) {
    case MSG_TYPE.BATCH_RECIPE:
      return decodeBatchRecipe(payload);
    case MSG_TYPE.GIN_VALIDATION:
      return decodeGinValidation(payload);
    case MSG_TYPE.SIGNOFF_ACK:
      return decodeSignoffAck(payload);
    case MSG_TYPE.HEARTBEAT_REPLY:
      return decodeHeartbeatReply(payload);
    case MSG_TYPE.GIN_SCAN:
      return decodeGinScan(payload);
    case MSG_TYPE.INGREDIENT_SIGNOFF:
      return decodeIngredientSignoff(payload);
    case MSG_TYPE.HEARTBEAT:
      return decodeHeartbeat(payload);
    default:
      throw new Error(`Unknown msgType: 0x${msgType.toString(16).padStart(2, '0')}`);
  }
}
