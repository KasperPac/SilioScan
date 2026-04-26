// ============================================================
// integration.test.ts — End-to-end protocol tests
//
// Spins up the mock PLC server on a random port and exercises the
// full message flow using a raw Node.js TCP socket + codec layer.
// No React Native involved — pure protocol-layer validation.
//
// Run:  npx jest __tests__/integration.test.ts
// ============================================================

import * as net from 'net';
import { encode, FrameDecoder } from '../src/services/FrameCodec';
import {
  parseMessage,
  encodeGinScan,
  encodeIngredientSignoff,
  encodeHeartbeat,
} from '../src/services/ProtocolCodec';
import {
  AnyMessage,
  MSG_TYPE,
  BatchRecipeMsg,
  GinValidationMsg,
  SignoffAckMsg,
} from '../src/types/protocol';
import { createMockPlcServer } from '../mock-plc/server';
import {
  FIXTURE_BATCH_RECIPE,
  VALID_GINS,
  INVALID_GINS,
} from '../mock-plc/fixtures';

// ── Helpers ───────────────────────────────────────────────────

/**
 * Queues inbound messages so tests can call mq.next() sequentially
 * without worrying about multiple payloads arriving in one TCP chunk.
 */
function createMessageQueue(socket: net.Socket, decoder: FrameDecoder) {
  const queue: AnyMessage[] = [];
  const waiting: Array<(msg: AnyMessage) => void> = [];

  socket.on('data', (chunk: Buffer) => {
    for (const payload of decoder.feed(chunk)) {
      const msg = parseMessage(payload);
      const resolve = waiting.shift();
      if (resolve) {
        resolve(msg);
      } else {
        queue.push(msg);
      }
    }
  });

  return {
    next(timeoutMs = 3000): Promise<AnyMessage> {
      return new Promise((resolve, reject) => {
        if (queue.length > 0) {
          resolve(queue.shift()!);
          return;
        }
        const timer = setTimeout(() => {
          const idx = waiting.indexOf(resolve);
          if (idx !== -1) waiting.splice(idx, 1);
          reject(new Error('message timeout'));
        }, timeoutMs);
        waiting.push((msg) => {
          clearTimeout(timer);
          resolve(msg);
        });
      });
    },
  };
}

function connectClient(port: number): Promise<{
  socket: net.Socket;
  mq: ReturnType<typeof createMessageQueue>;
}> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      const mq = createMessageQueue(socket, new FrameDecoder());
      resolve({ socket, mq });
    });
    socket.on('error', reject);
  });
}

// ── Suite ─────────────────────────────────────────────────────

describe('Mock PLC — integration', () => {
  let server: net.Server;
  let port: number;

  beforeAll((done) => {
    server = createMockPlcServer();
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as net.AddressInfo).port;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  // ── BATCH_RECIPE push ──────────────────────────────────────

  test('server pushes BATCH_RECIPE after connect', async () => {
    const { socket, mq } = await connectClient(port);
    try {
      const msg = await mq.next();
      expect(msg.msgType).toBe(MSG_TYPE.BATCH_RECIPE);

      const recipe = msg as BatchRecipeMsg;
      expect(recipe.productCode).toBe(FIXTURE_BATCH_RECIPE.productCode);
      expect(recipe.batchNo).toBe(FIXTURE_BATCH_RECIPE.batchNo);
      expect(recipe.productDescription).toBe(FIXTURE_BATCH_RECIPE.productDescription);
      expect(recipe.ingredientCount).toBe(FIXTURE_BATCH_RECIPE.ingredientCount);
      expect(recipe.ingredients).toHaveLength(FIXTURE_BATCH_RECIPE.ingredientCount);
      expect(recipe.ingredients[0].ingredientName).toBe('Wheat Flour');
      expect(recipe.ingredients[0].requiredBags).toBe(6);
    } finally {
      socket.destroy();
    }
  });

  // ── GIN_SCAN ───────────────────────────────────────────────

  test('valid GIN returns GIN_VALIDATION with valid=true', async () => {
    const { socket, mq } = await connectClient(port);
    try {
      await mq.next(); // consume BATCH_RECIPE

      const gin = VALID_GINS['Wheat Flour'][0]; // '100001'
      socket.write(encode(encodeGinScan({
        msgType: 0x01, seqNum: 10, ingredientIndex: 0, gin,
      })));

      const msg = await mq.next();
      expect(msg.msgType).toBe(MSG_TYPE.GIN_VALIDATION);
      const result = msg as GinValidationMsg;
      expect(result.seqNum).toBe(10);
      expect(result.gin).toBe(gin);
      expect(result.valid).toBe(true);
      expect(result.rejectReason).toBe('');
      expect(result.ingredientName).toBe('Wheat Flour');
    } finally {
      socket.destroy();
    }
  });

  test('invalid GIN returns GIN_VALIDATION with valid=false', async () => {
    const { socket, mq } = await connectClient(port);
    try {
      await mq.next(); // consume BATCH_RECIPE

      const gin = INVALID_GINS[0]; // '900001'
      socket.write(encode(encodeGinScan({
        msgType: 0x01, seqNum: 11, ingredientIndex: 0, gin,
      })));

      const msg = await mq.next();
      expect(msg.msgType).toBe(MSG_TYPE.GIN_VALIDATION);
      const result = msg as GinValidationMsg;
      expect(result.seqNum).toBe(11);
      expect(result.gin).toBe(gin);
      expect(result.valid).toBe(false);
      expect(result.rejectReason).not.toBe('');
    } finally {
      socket.destroy();
    }
  });

  test('seqNum is echoed back in GIN_VALIDATION', async () => {
    const { socket, mq } = await connectClient(port);
    try {
      await mq.next();

      const seq = 0x1234;
      socket.write(encode(encodeGinScan({
        msgType: 0x01, seqNum: seq, ingredientIndex: 1, gin: '100010',
      })));

      const msg = await mq.next();
      expect((msg as GinValidationMsg).seqNum).toBe(seq);
    } finally {
      socket.destroy();
    }
  });

  test('GIN validation uses correct ingredient name for ingredientIndex', async () => {
    const { socket, mq } = await connectClient(port);
    try {
      await mq.next();

      // ingredientIndex 2 → 'Bone Meal'
      socket.write(encode(encodeGinScan({
        msgType: 0x01, seqNum: 1, ingredientIndex: 2, gin: '100020',
      })));

      const msg = await mq.next();
      expect((msg as GinValidationMsg).ingredientName).toBe('Bone Meal');
    } finally {
      socket.destroy();
    }
  });

  // ── INGREDIENT_SIGNOFF ─────────────────────────────────────

  test('INGREDIENT_SIGNOFF returns SIGNOFF_ACK accepted=true', async () => {
    const { socket, mq } = await connectClient(port);
    try {
      await mq.next();

      socket.write(encode(encodeIngredientSignoff({
        msgType: 0x02,
        seqNum: 20,
        ingredientIndex: 0,
        operatorId: 'OP-001',
        ginCount: 1,
        ginEntries: [{ gin: VALID_GINS['Wheat Flour'][0], bagCount: 6 }],
      })));

      const msg = await mq.next();
      expect(msg.msgType).toBe(MSG_TYPE.SIGNOFF_ACK);
      const ack = msg as SignoffAckMsg;
      expect(ack.seqNum).toBe(20);
      expect(ack.ingredientIndex).toBe(0);
      expect(ack.accepted).toBe(true);
    } finally {
      socket.destroy();
    }
  });

  test('INGREDIENT_SIGNOFF with multiple GIN entries is accepted', async () => {
    const { socket, mq } = await connectClient(port);
    try {
      await mq.next();

      socket.write(encode(encodeIngredientSignoff({
        msgType: 0x02,
        seqNum: 21,
        ingredientIndex: 0,
        operatorId: 'DEADBEEF01234567',
        ginCount: 3,
        ginEntries: [
          { gin: '100001', bagCount: 2 },
          { gin: '100002', bagCount: 2 },
          { gin: '100003', bagCount: 2 },
        ],
      })));

      const msg = await mq.next();
      const ack = msg as SignoffAckMsg;
      expect(ack.msgType).toBe(MSG_TYPE.SIGNOFF_ACK);
      expect(ack.accepted).toBe(true);
    } finally {
      socket.destroy();
    }
  });

  // ── HEARTBEAT ──────────────────────────────────────────────

  test('HEARTBEAT returns HEARTBEAT_REPLY with matching seqNum', async () => {
    const { socket, mq } = await connectClient(port);
    try {
      // Send heartbeat immediately — reply arrives before 500ms BATCH_RECIPE timer
      const seq = 99;
      socket.write(encode(encodeHeartbeat({ msgType: 0x10, seqNum: seq })));

      const msg = await mq.next();
      expect(msg.msgType).toBe(MSG_TYPE.HEARTBEAT_REPLY);
      expect(msg.seqNum).toBe(seq);
    } finally {
      socket.destroy();
    }
  });

  // ── Full workflow ──────────────────────────────────────────

  test('full workflow: connect → receive batch → scan GIN → signoff', async () => {
    const { socket, mq } = await connectClient(port);
    try {
      // Step 1: receive BATCH_RECIPE
      const batchMsg = await mq.next();
      expect(batchMsg.msgType).toBe(MSG_TYPE.BATCH_RECIPE);
      expect((batchMsg as BatchRecipeMsg).ingredientCount).toBe(4);

      // Step 2: scan valid GIN for ingredient 0 (Wheat Flour)
      socket.write(encode(encodeGinScan({
        msgType: 0x01, seqNum: 1, ingredientIndex: 0, gin: '100001',
      })));
      const ginMsg = await mq.next();
      expect(ginMsg.msgType).toBe(MSG_TYPE.GIN_VALIDATION);
      expect((ginMsg as GinValidationMsg).valid).toBe(true);

      // Step 3: sign off ingredient 0
      socket.write(encode(encodeIngredientSignoff({
        msgType: 0x02,
        seqNum: 2,
        ingredientIndex: 0,
        operatorId: 'OPERATOR01',
        ginCount: 1,
        ginEntries: [{ gin: '100001', bagCount: 6 }],
      })));
      const ackMsg = await mq.next();
      expect(ackMsg.msgType).toBe(MSG_TYPE.SIGNOFF_ACK);
      expect((ackMsg as SignoffAckMsg).accepted).toBe(true);
      expect((ackMsg as SignoffAckMsg).ingredientIndex).toBe(0);
    } finally {
      socket.destroy();
    }
  });

  test('two consecutive GIN scans are handled independently', async () => {
    const { socket, mq } = await connectClient(port);
    try {
      await mq.next(); // consume BATCH_RECIPE

      socket.write(encode(encodeGinScan({ msgType: 0x01, seqNum: 1, ingredientIndex: 0, gin: '100001' })));
      socket.write(encode(encodeGinScan({ msgType: 0x01, seqNum: 2, ingredientIndex: 1, gin: '900001' })));

      const r1 = await mq.next() as GinValidationMsg;
      const r2 = await mq.next() as GinValidationMsg;

      expect(r1.seqNum).toBe(1);
      expect(r1.valid).toBe(true);

      expect(r2.seqNum).toBe(2);
      expect(r2.valid).toBe(false);
    } finally {
      socket.destroy();
    }
  });
});
