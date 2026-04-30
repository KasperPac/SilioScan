import {
  decodeBatchRecipe,
  decodeGinScan,
  decodeGinValidation,
  decodeHeartbeat,
  decodeHeartbeatReply,
  decodeIngredientSignoff,
  decodeSignoffAck,
  encodeBatchRecipe,
  encodeGinScan,
  encodeGinValidation,
  encodeHeartbeat,
  encodeHeartbeatReply,
  encodeIngredientSignoff,
  encodeSignoffAck,
} from '../src/services/ProtocolCodec';
import type {
  BatchRecipeMsg,
  GinScanMsg,
  GinValidationMsg,
  HeartbeatMsg,
  HeartbeatReplyMsg,
  IngredientSignoffMsg,
  SignoffAckMsg,
} from '../src/types/protocol';

function fixedAscii(value: string, length: number): string {
  return value.slice(0, length);
}

function expectFieldPadding(buf: Buffer, offset: number, fieldLength: number, valueLength: number): void {
  for (let i = valueLength; i < fieldLength; i++) {
    expect(buf[offset + i]).toBe(0);
  }
}

describe('ProtocolCodec round-trip coverage', () => {
  test('BATCH_RECIPE round-trips with 4 ingredients and preserves field boundaries', () => {
    const msg: BatchRecipeMsg = {
      msgType: 0x80,
      seqNum: 0x1234,
      productCode: 'PRODUCT-CODE-12345',
      batchNo: 'BATCH-2026-03-21-001',
      productDescription: 'Description that is definitely longer than thirty-two bytes',
      ingredientCount: 4,
      ingredients: [
        { ingredientName: 'Ingredient 01 Name Is Longer Than 32 Bytes', requiredBags: 0x0102, signedOff: false },
        { ingredientName: 'Ingredient 02', requiredBags: 3, signedOff: false },
        { ingredientName: 'Ingredient 03', requiredBags: 4, signedOff: false },
        { ingredientName: 'Ingredient 04', requiredBags: 5, signedOff: false },
      ],
    };

    const encoded = encodeBatchRecipe(msg);
    const decoded = decodeBatchRecipe(encoded);

    expect(encoded[0]).toBe(0x80);
    expect(encoded[1]).toBe(0x12);
    expect(encoded[2]).toBe(0x34);
    expect(encoded[67]).toBe(4);
    expect(encoded[100]).toBe(0x01);
    expect(encoded[101]).toBe(0x02);
    expect(encoded.toString('ascii', 3, 19).replace(/\0.*$/, '')).toBe(fixedAscii(msg.productCode, 16));
    expect(encoded.toString('ascii', 19, 35).replace(/\0.*$/, '')).toBe(fixedAscii(msg.batchNo, 16));
    expect(encoded.toString('ascii', 35, 67).replace(/\0.*$/, '')).toBe(fixedAscii(msg.productDescription, 32));
    expect(decoded).toEqual({
      ...msg,
      productCode: fixedAscii(msg.productCode, 16),
      batchNo: fixedAscii(msg.batchNo, 16),
      productDescription: fixedAscii(msg.productDescription, 32),
      ingredients: [
        { ingredientName: fixedAscii(msg.ingredients[0].ingredientName, 32), requiredBags: 0x0102, signedOff: false },
        msg.ingredients[1],
        msg.ingredients[2],
        msg.ingredients[3],
      ],
    });
    expectFieldPadding(encoded, 68 + 48, 32, msg.ingredients[1].ingredientName.length);
  });

  test('GIN_SCAN round-trips with a full-length GIN and uses big-endian seqNum', () => {
    const msg: GinScanMsg = {
      msgType: 0x01,
      seqNum: 0xabcd,
      ingredientIndex: 7,
      gin: '1234567890ABCDEF',
    };

    const encoded = encodeGinScan(msg);
    const decoded = decodeGinScan(encoded);

    expect(encoded[0]).toBe(0x01);
    expect(encoded[1]).toBe(0xab);
    expect(encoded[2]).toBe(0xcd);
    expect(encoded[3]).toBe(7);
    expect(encoded.toString('ascii', 4, 20)).toBe(msg.gin);
    expect(decoded).toEqual(msg);
  });

  test('GIN_VALIDATION pass round-trips with null padding in rejectReason', () => {
    const msg: GinValidationMsg = {
      msgType: 0x81,
      seqNum: 0x0102,
      gin: 'PASS-RESULT-GIN-',
      valid: true,
      ingredientName: 'Wheat Flour',
      rejectReason: '',
    };

    const encoded = encodeGinValidation(msg);
    const decoded = decodeGinValidation(encoded);

    expect(encoded[0]).toBe(0x81);
    expect(encoded[1]).toBe(0x01);
    expect(encoded[2]).toBe(0x02);
    expect(encoded[19]).toBe(0x01);
    expectFieldPadding(encoded, 20 + msg.ingredientName.length, 32 - msg.ingredientName.length, 0);
    expectFieldPadding(encoded, 52, 32, 0);
    expect(decoded).toEqual(msg);
  });

  test('GIN_VALIDATION fail round-trips and truncates strings at field boundaries', () => {
    const msg: GinValidationMsg = {
      msgType: 0x81,
      seqNum: 0x0203,
      gin: 'FAIL-RESULT-GIN-TOO-LONG',
      valid: false,
      ingredientName: 'Ingredient Name Beyond Thirty-Two Bytes Here',
      rejectReason: 'Reject reason that is intentionally far longer than thirty-two bytes',
    };

    const encoded = encodeGinValidation(msg);
    const decoded = decodeGinValidation(encoded);

    expect(encoded[19]).toBe(0x00);
    expect(decoded).toEqual({
      ...msg,
      gin: fixedAscii(msg.gin, 16),
      ingredientName: fixedAscii(msg.ingredientName, 32),
      rejectReason: fixedAscii(msg.rejectReason, 32),
    });
  });

  test('INGREDIENT_SIGNOFF round-trips with 3 GIN entries, padding, truncation, and big-endian bag counts', () => {
    const msg: IngredientSignoffMsg = {
      msgType: 0x02,
      seqNum: 0x4567,
      ingredientIndex: 2,
      operatorId: 'OPERATOR-ID-12345',
      ginCount: 3,
      ginEntries: [
        { gin: 'GIN-ENTRY-0000001', bagCount: 0x0304 },
        { gin: 'GIN-ENTRY-2', bagCount: 5 },
        { gin: 'GIN-ENTRY-THREE-TOO-LONG', bagCount: 6 },
      ],
    };

    const encoded = encodeIngredientSignoff(msg);
    const decoded = decodeIngredientSignoff(encoded);

    expect(encoded[0]).toBe(0x02);
    expect(encoded[1]).toBe(0x45);
    expect(encoded[2]).toBe(0x67);
    expect(encoded[20]).toBe(3);
    expect(encoded[37]).toBe(0x03);
    expect(encoded[38]).toBe(0x04);
    expectFieldPadding(encoded, 21 + 20 + msg.ginEntries[1].gin.length, 16 - msg.ginEntries[1].gin.length, 0);
    expect(decoded).toEqual({
      ...msg,
      operatorId: fixedAscii(msg.operatorId, 16),
      ginEntries: [
        { gin: fixedAscii(msg.ginEntries[0].gin, 16), bagCount: msg.ginEntries[0].bagCount },
        msg.ginEntries[1],
        { gin: fixedAscii(msg.ginEntries[2].gin, 16), bagCount: 6 },
      ],
    });
  });

  test('SIGNOFF_ACK accepted round-trips with null-padded rejectReason', () => {
    const msg: SignoffAckMsg = {
      msgType: 0x82,
      seqNum: 0x1112,
      ingredientIndex: 3,
      accepted: true,
      rejectReason: '',
    };

    const encoded = encodeSignoffAck(msg);
    const decoded = decodeSignoffAck(encoded);

    expect(encoded[0]).toBe(0x82);
    expect(encoded[1]).toBe(0x11);
    expect(encoded[2]).toBe(0x12);
    expect(encoded[3]).toBe(3);
    expect(encoded[4]).toBe(0x01);
    expectFieldPadding(encoded, 5, 32, 0);
    expect(decoded).toEqual(msg);
  });

  test('SIGNOFF_ACK rejected round-trips and truncates rejectReason to 32 bytes', () => {
    const msg: SignoffAckMsg = {
      msgType: 0x82,
      seqNum: 0x1314,
      ingredientIndex: 4,
      accepted: false,
      rejectReason: 'This reject reason is much longer than thirty-two characters',
    };

    const encoded = encodeSignoffAck(msg);
    const decoded = decodeSignoffAck(encoded);

    expect(encoded[4]).toBe(0x00);
    expect(decoded).toEqual({
      ...msg,
      rejectReason: fixedAscii(msg.rejectReason, 32),
    });
  });

  test('PING round-trips and stores seqNum in big-endian byte order', () => {
    const msg: HeartbeatMsg = {
      msgType: 0x10,
      seqNum: 0x0a0b,
    };

    const encoded = encodeHeartbeat(msg);
    const decoded = decodeHeartbeat(encoded);

    expect(encoded).toEqual(Buffer.from([0x10, 0x0a, 0x0b]));
    expect(decoded).toEqual(msg);
  });

  test('PONG round-trips and stores seqNum in big-endian byte order', () => {
    const msg: HeartbeatReplyMsg = {
      msgType: 0x90,
      seqNum: 0x0c0d,
    };

    const encoded = encodeHeartbeatReply(msg);
    const decoded = decodeHeartbeatReply(encoded);

    expect(encoded).toEqual(Buffer.from([0x90, 0x0c, 0x0d]));
    expect(decoded).toEqual(msg);
  });
});
