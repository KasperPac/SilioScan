// ============================================================
// PlcService.test.ts
//
// Tests PlcService in isolation by mocking react-native-tcp-socket.
// The mock socket is a simple EventEmitter with a write() spy.
//
// Timer strategy:
//   jest.useFakeTimers({ doNotFake: ['setImmediate','nextTick'] })
//   → setTimeout/setInterval are fake (controllable)
//   → setImmediate is real (so tick() and mock onConnect resolve)
//
// MockSocket.destroy() emits 'close' synchronously to prevent
// cross-test leakage via real-setImmediate deferred events.
// ============================================================

import { EventEmitter } from 'events';
import { PlcService, ConnectionState } from '../src/services/PlcService';
import { encode } from '../src/services/FrameCodec';
import {
  encodeGinValidation,
  encodeSignoffAck,
  encodeHeartbeatReply,
  encodeBatchRecipe,
  decodeGinScan,
  decodeIngredientSignoff,
  decodeHeartbeat,
} from '../src/services/ProtocolCodec';
import {
  GinValidationMsg,
  SignoffAckMsg,
  BatchRecipeMsg,
  HeartbeatReplyMsg,
} from '../src/types/protocol';

// ── Mock react-native-tcp-socket ──────────────────────────────

class MockSocket extends EventEmitter {
  write = jest.fn();
  // Synchronous destroy — avoids cross-test leakage via deferred setImmediate 'close'
  destroy = jest.fn(function (this: MockSocket) {
    this.emit('close');
  });
}

let mockSocket: MockSocket;

jest.mock('react-native-tcp-socket', () => ({
  createConnection: jest.fn((_opts: unknown, onConnect: () => void) => {
    mockSocket = new MockSocket();
    setImmediate(onConnect);
    return mockSocket;
  }),
}));

// ── Helpers ───────────────────────────────────────────────────

/** Wrap a payload in a framed buffer and feed it into PlcService as inbound TCP data. */
function injectFrame(payload: Buffer): void {
  mockSocket.emit('data', encode(payload));
}

/** Strip the STX+LEN frame header and return the raw payload from write() call N. */
function getWrittenPayload(callIndex = 0): Buffer {
  const frame: Buffer = mockSocket.write.mock.calls[callIndex][0];
  return frame.subarray(3); // STX(1) + LEN(2) = 3 bytes
}

/** Advance fake timers and inject a PONG for every HEARTBEAT written since clearIndex. */
function ackHeartbeats(fromWriteIndex: number): void {
  const calls = mockSocket.write.mock.calls;
  for (let i = fromWriteIndex; i < calls.length; i++) {
    const payload = calls[i][0].subarray(3);
    if (payload[0] === 0x10) {
      const seq = payload.readUInt16BE(1);
      injectFrame(encodeHeartbeatReply({ msgType: 0x90, seqNum: seq }));
    }
  }
}

/** Wait one event-loop tick (lets setImmediate callbacks fire). */
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

/** Build a matching SignoffAck for a pending signoff request. */
function makeSignoffAck(seqNum: number, ingredientIndex: number): SignoffAckMsg {
  return { msgType: 0x82, seqNum, ingredientIndex, accepted: true, rejectReason: '' };
}

// ── Tests ─────────────────────────────────────────────────────

describe('PlcService', () => {
  let svc: PlcService;

  beforeEach(() => {
    // Keep setImmediate/nextTick real; fake setTimeout/setInterval
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    svc = new PlcService();

    // Restore the default createConnection implementation before every test.
    // jest.clearAllMocks() only clears call history, NOT mockImplementation overrides.
    // Without this, the backoff test's override leaks into subsequent tests, causing
    // onConnect to never fire and leaving the service stuck in 'connecting' state.
    const TcpSocket = require('react-native-tcp-socket');
    TcpSocket.createConnection.mockImplementation(
      (_opts: unknown, onConnect: () => void) => {
        mockSocket = new MockSocket();
        setImmediate(onConnect);
        return mockSocket;
      },
    );
  });

  afterEach(() => {
    svc.disconnect();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // ── Connection state ────────────────────────────────────────

  describe('connection lifecycle', () => {
    test('initial state is disconnected', () => {
      expect(svc.connectionState).toBe('disconnected');
    });

    test('state goes connecting → connected on successful open', async () => {
      const states: ConnectionState[] = [];
      svc.on('connectionChange', (s: ConnectionState) => states.push(s));

      svc.connect('192.168.1.1', 8500);
      expect(states).toEqual(['connecting']);

      await tick(); // onConnect fires
      expect(states).toEqual(['connecting', 'connected']);
      expect(svc.connectionState).toBe('connected');
    });

    test('emits connectionChange → disconnected when socket closes', async () => {
      const states: ConnectionState[] = [];
      svc.on('connectionChange', (s: ConnectionState) => states.push(s));

      svc.connect('192.168.1.1', 8500);
      await tick();

      mockSocket.emit('close');
      expect(states).toContain('disconnected');
    });

    test('disconnect() sets state to disconnected immediately', async () => {
      svc.connect('192.168.1.1', 8500);
      await tick();
      svc.disconnect();
      expect(svc.connectionState).toBe('disconnected');
    });
  });

  // ── Reconnect ───────────────────────────────────────────────

  describe('auto-reconnect', () => {
    test('schedules reconnect after unexpected close', async () => {
      const TcpSocket = require('react-native-tcp-socket');
      svc.connect('192.168.1.1', 8500);
      await tick();

      mockSocket.emit('close');

      jest.advanceTimersByTime(999);
      expect(TcpSocket.createConnection).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1); // 1000 ms — first reconnect fires
      expect(TcpSocket.createConnection).toHaveBeenCalledTimes(2);
    });

    test('exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s', async () => {
      // Override createConnection so reconnects never call onConnect.
      // This prevents reconnectAttempts from resetting between iterations,
      // allowing the backoff to grow monotonically.
      const TcpSocket = require('react-native-tcp-socket');
      let isFirstConnect = true;
      TcpSocket.createConnection.mockImplementation(
        (_opts: unknown, onConnect: () => void) => {
          mockSocket = new MockSocket();
          if (isFirstConnect) {
            isFirstConnect = false;
            setImmediate(onConnect); // initial connect succeeds
          }
          // Subsequent reconnects: onConnect never fires → reconnectAttempts never resets
          return mockSocket;
        },
      );

      svc.connect('192.168.1.1', 8500);
      await tick(); // initial connect

      const expectedDelays = [1000, 2000, 4000, 8000, 16000, 30000];

      for (const delay of expectedDelays) {
        mockSocket.emit('close'); // trigger _scheduleReconnect
        jest.advanceTimersByTime(delay - 1);
        const callsBefore = TcpSocket.createConnection.mock.calls.length;
        jest.advanceTimersByTime(1); // reconnect timer fires
        expect(TcpSocket.createConnection.mock.calls.length).toBeGreaterThan(callsBefore);
        // Do NOT await tick() — keep onConnect from firing and resetting reconnectAttempts
      }
    });

    test('disconnect() stops reconnect loop', async () => {
      const TcpSocket = require('react-native-tcp-socket');
      svc.connect('192.168.1.1', 8500);
      await tick();

      mockSocket.emit('close');
      svc.disconnect();

      jest.advanceTimersByTime(5000);
      expect(TcpSocket.createConnection).toHaveBeenCalledTimes(1);
    });
  });

  // ── Heartbeat ───────────────────────────────────────────────

  describe('heartbeat', () => {
    test('sends HEARTBEAT every 5 s after connect', async () => {
      svc.connect('192.168.1.1', 8500);
      await tick();
      mockSocket.write.mockClear();

      // First heartbeat
      jest.advanceTimersByTime(5000);
      expect(mockSocket.write).toHaveBeenCalledTimes(1);
      expect(getWrittenPayload(0)[0]).toBe(0x10);

      // ACK the first PONG before the 3 s timeout kills the socket
      ackHeartbeats(0);

      // Second heartbeat
      jest.advanceTimersByTime(5000);
      expect(mockSocket.write).toHaveBeenCalledTimes(2);
      expect(getWrittenPayload(1)[0]).toBe(0x10);
    });

    test('HEARTBEAT seqNum increments each time', async () => {
      svc.connect('192.168.1.1', 8500);
      await tick();
      mockSocket.write.mockClear();

      jest.advanceTimersByTime(5000);
      const seq1 = decodeHeartbeat(getWrittenPayload(0)).seqNum;
      ackHeartbeats(0);

      jest.advanceTimersByTime(5000);
      const seq2 = decodeHeartbeat(getWrittenPayload(1)).seqNum;

      expect(seq2).toBe(seq1 + 1);
    });

    test('destroys socket if no PONG within 3 s', async () => {
      svc.connect('192.168.1.1', 8500);
      await tick();

      jest.advanceTimersByTime(5000); // heartbeat sent
      jest.advanceTimersByTime(3000); // pong timeout fires → _markDead

      expect(mockSocket.destroy).toHaveBeenCalled();
    });

    test('does NOT destroy socket when PONG arrives in time', async () => {
      svc.connect('192.168.1.1', 8500);
      await tick();

      jest.advanceTimersByTime(5000);
      ackHeartbeats(0); // inject PONG within 3 s window

      jest.advanceTimersByTime(2999); // just before pong timeout
      expect(mockSocket.destroy).not.toHaveBeenCalled();
    });

    test('ignores PONG with wrong seqNum', async () => {
      svc.connect('192.168.1.1', 8500);
      await tick();

      jest.advanceTimersByTime(5000);
      const pingSeq = decodeHeartbeat(getWrittenPayload(0)).seqNum;

      // Wrong seq — pong timer NOT cleared
      injectFrame(encodeHeartbeatReply({ msgType: 0x90, seqNum: pingSeq + 1 } as HeartbeatReplyMsg));

      jest.advanceTimersByTime(3000);
      expect(mockSocket.destroy).toHaveBeenCalled();
    });

    test('stops heartbeat on disconnect', async () => {
      svc.connect('192.168.1.1', 8500);
      await tick();
      svc.disconnect();
      mockSocket.write.mockClear();

      jest.advanceTimersByTime(10000);
      expect(mockSocket.write).not.toHaveBeenCalled();
    });
  });

  // ── batchRecipe event ───────────────────────────────────────

  describe("'batchRecipe' event", () => {
    test('fires when BATCH_RECIPE arrives', async () => {
      svc.connect('192.168.1.1', 8500);
      await tick();

      const recipe: BatchRecipeMsg = {
        msgType: 0x80,
        seqNum: 1,
        productCode: 'PF-2001',
        batchNo: 'B-001',
        productDescription: 'Test Product',
        ingredientCount: 1,
        ingredients: [{ ingredientName: 'Test Ingredient', requiredBags: 3 }],
      };

      const received = jest.fn();
      svc.on('batchRecipe', received);
      injectFrame(encodeBatchRecipe(recipe));

      expect(received).toHaveBeenCalledTimes(1);
      expect(received.mock.calls[0][0]).toMatchObject({
        productCode: 'PF-2001',
        batchNo: 'B-001',
        ingredientCount: 1,
      });
    });
  });

  // ── sendGinScan ─────────────────────────────────────────────

  describe('sendGinScan()', () => {
    test('sends correctly encoded GIN_SCAN frame', async () => {
      svc.connect('192.168.1.1', 8500);
      await tick();
      mockSocket.write.mockClear();

      const promise = svc.sendGinScan(0, '100001');

      const sent = decodeGinScan(getWrittenPayload(0));
      expect(sent.msgType).toBe(0x01);
      expect(sent.ingredientIndex).toBe(0);
      expect(sent.gin).toBe('100001');

      // Resolve to avoid unhandled rejection in afterEach
      injectFrame(encodeGinValidation({
        msgType: 0x81, seqNum: sent.seqNum,
        gin: '100001', valid: true, ingredientName: 'Wheat Flour', rejectReason: '',
      }));
      await promise;
    });

    test('resolves with GIN_VALIDATION when PLC responds', async () => {
      svc.connect('192.168.1.1', 8500);
      await tick();
      mockSocket.write.mockClear();

      const promise = svc.sendGinScan(0, '100001');
      const seq = decodeGinScan(getWrittenPayload(0)).seqNum;

      injectFrame(encodeGinValidation({
        msgType: 0x81, seqNum: seq,
        gin: '100001', valid: true,
        ingredientName: 'Wheat Flour', rejectReason: '',
      }));

      const result = await promise;
      expect(result.valid).toBe(true);
      expect(result.gin).toBe('100001');
      expect(result.ingredientName).toBe('Wheat Flour');
    });

    test('resolves with FAIL validation on invalid GIN', async () => {
      svc.connect('192.168.1.1', 8500);
      await tick();
      mockSocket.write.mockClear();

      const promise = svc.sendGinScan(0, '999999');
      const seq = decodeGinScan(getWrittenPayload(0)).seqNum;

      injectFrame(encodeGinValidation({
        msgType: 0x81, seqNum: seq,
        gin: '999999', valid: false,
        ingredientName: 'Wheat Flour', rejectReason: 'Unknown GIN',
      }));

      const result = await promise;
      expect(result.valid).toBe(false);
      expect(result.rejectReason).toBe('Unknown GIN');
    });

    test('rejects if not connected', async () => {
      await expect(svc.sendGinScan(0, '100001')).rejects.toThrow('Not connected');
    });

    test('rejects on request timeout (10 s)', async () => {
      svc.connect('192.168.1.1', 8500);
      await tick();
      mockSocket.write.mockClear();

      const promise = svc.sendGinScan(0, '100001');

      // Advance to t=5s: heartbeat fires. ACK it before the 3s pong timer expires.
      jest.advanceTimersByTime(5000);
      ackHeartbeats(1); // write[0]=GIN_SCAN, write[1]=HEARTBEAT

      // Advance remaining 5s to reach REQUEST_TIMEOUT_MS=10s
      jest.advanceTimersByTime(5000);

      await expect(promise).rejects.toThrow('timed out');
    });

    test('rejects in-flight request when socket closes', async () => {
      svc.connect('192.168.1.1', 8500);
      await tick();

      const promise = svc.sendGinScan(0, '100001');
      mockSocket.emit('close');

      await expect(promise).rejects.toThrow('Connection closed');
    });

    test('seqNum increments across successive calls', async () => {
      svc.connect('192.168.1.1', 8500);
      await tick();
      mockSocket.write.mockClear();

      const p1 = svc.sendGinScan(0, '100001');
      const p2 = svc.sendGinScan(0, '100002');

      const seq1 = decodeGinScan(getWrittenPayload(0)).seqNum;
      const seq2 = decodeGinScan(getWrittenPayload(1)).seqNum;
      expect(seq2).toBe(seq1 + 1);

      // Resolve both to avoid afterEach leakage
      injectFrame(encodeGinValidation({ msgType: 0x81, seqNum: seq1, gin: '100001', valid: true, ingredientName: '', rejectReason: '' }));
      injectFrame(encodeGinValidation({ msgType: 0x81, seqNum: seq2, gin: '100002', valid: true, ingredientName: '', rejectReason: '' }));
      await p1;
      await p2;
    });
  });

  // ── sendIngredientSignoff ────────────────────────────────────

  describe('sendIngredientSignoff()', () => {
    test('sends correctly encoded INGREDIENT_SIGNOFF frame', async () => {
      svc.connect('192.168.1.1', 8500);
      await tick();
      mockSocket.write.mockClear();

      const promise = svc.sendIngredientSignoff({
        ingredientIndex: 1,
        operatorId: 'OP-001',
        ginCount: 2,
        ginEntries: [
          { gin: '100010', bagCount: 2 },
          { gin: '100011', bagCount: 2 },
        ],
      });

      const sent = decodeIngredientSignoff(getWrittenPayload(0));
      expect(sent.msgType).toBe(0x02);
      expect(sent.ingredientIndex).toBe(1);
      expect(sent.operatorId).toBe('OP-001');
      expect(sent.ginCount).toBe(2);
      expect(sent.ginEntries[0].gin).toBe('100010');

      // Resolve to avoid unhandled rejection in afterEach
      injectFrame(encodeSignoffAck(makeSignoffAck(sent.seqNum, 1)));
      await promise;
    });

    test('resolves with SIGNOFF_ACK when PLC responds', async () => {
      svc.connect('192.168.1.1', 8500);
      await tick();
      mockSocket.write.mockClear();

      const promise = svc.sendIngredientSignoff({
        ingredientIndex: 0,
        operatorId: 'OP-001',
        ginCount: 1,
        ginEntries: [{ gin: '100001', bagCount: 3 }],
      });

      const seq = decodeIngredientSignoff(getWrittenPayload(0)).seqNum;
      injectFrame(encodeSignoffAck({
        msgType: 0x82, seqNum: seq,
        ingredientIndex: 0, accepted: true, rejectReason: '',
      }));

      const result = await promise;
      expect(result.accepted).toBe(true);
      expect(result.ingredientIndex).toBe(0);
    });

    test('resolves with rejected ACK', async () => {
      svc.connect('192.168.1.1', 8500);
      await tick();
      mockSocket.write.mockClear();

      const promise = svc.sendIngredientSignoff({
        ingredientIndex: 0,
        operatorId: 'OP-001',
        ginCount: 1,
        ginEntries: [{ gin: '100001', bagCount: 1 }],
      });

      const seq = decodeIngredientSignoff(getWrittenPayload(0)).seqNum;
      injectFrame(encodeSignoffAck({
        msgType: 0x82, seqNum: seq,
        ingredientIndex: 0, accepted: false, rejectReason: 'Bag count mismatch',
      }));

      const result = await promise;
      expect(result.accepted).toBe(false);
      expect(result.rejectReason).toBe('Bag count mismatch');
    });

    test('rejects if not connected', async () => {
      await expect(
        svc.sendIngredientSignoff({
          ingredientIndex: 0, operatorId: '',
          ginCount: 1, ginEntries: [{ gin: '100001', bagCount: 1 }],
        }),
      ).rejects.toThrow('Not connected');
    });
  });

  // ── Fragmented TCP data ─────────────────────────────────────

  describe('frame reassembly over TCP', () => {
    test('handles response split across two data events', async () => {
      svc.connect('192.168.1.1', 8500);
      await tick();
      mockSocket.write.mockClear();

      const promise = svc.sendGinScan(0, '100001');
      const seq = decodeGinScan(getWrittenPayload(0)).seqNum;

      const full = encode(encodeGinValidation({
        msgType: 0x81, seqNum: seq,
        gin: '100001', valid: true,
        ingredientName: 'Wheat Flour', rejectReason: '',
      }));

      // Split at byte 4 (mid-payload)
      mockSocket.emit('data', full.subarray(0, 4));
      mockSocket.emit('data', full.subarray(4));

      const result = await promise;
      expect(result.valid).toBe(true);
    });
  });
});
