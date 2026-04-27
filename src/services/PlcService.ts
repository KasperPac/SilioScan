// ============================================================
// PlcService.ts — Singleton TCP client for Omron PLC comms
// ARCHITECTURE.md §3, §8.3
//
// Design notes:
//   • connect(ip, port) / disconnect() — explicit lifecycle
//   • Auto-reconnect: exponential backoff 1s→2s→4s→8s→16s→30s cap
//   • Heartbeat: PING every 5 s; if no PONG within 3 s → mark dead
//   • Request/response correlation via seqNum (uint16, wrapping)
//   • PLC-pushed messages fire named events ('batchRecipe')
//   • All state transitions fire 'connectionChange'
// ============================================================

import EventEmitter from 'events';
import TcpSocket from 'react-native-tcp-socket';
import { encode, FrameDecoder } from './FrameCodec';
import {
  parseMessage,
  encodeHeartbeat,
  encodeGinScan,
  encodeIngredientSignoff,
} from './ProtocolCodec';
import {
  MSG_TYPE,
  BatchRecipeMsg,
  GinValidationMsg,
  SignoffAckMsg,
  HeartbeatReplyMsg,
  GinScanMsg,
  IngredientSignoffMsg,
} from '../types/protocol';

// ── Constants ────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 5_000;
const HEARTBEAT_TIMEOUT_MS  = 3_000;
const REQUEST_TIMEOUT_MS    = 10_000;
const RECONNECT_BASE_MS     = 1_000;
const RECONNECT_MAX_MS      = 30_000;

// ── Types ────────────────────────────────────────────────────

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

type PendingEntry<T> = {
  resolve: (value: T) => void;
  reject:  (reason: Error) => void;
  timer:   ReturnType<typeof setTimeout>;
};

// Params for sendIngredientSignoff — service fills in msgType + seqNum
export type SignoffParams = Omit<IngredientSignoffMsg, 'msgType' | 'seqNum'>;

// ── Events ───────────────────────────────────────────────────
//
// 'connectionChange'  (state: ConnectionState)
// 'batchRecipe'       (msg: BatchRecipeMsg)
//
// (EventEmitter also emits 'error' for unexpected parse failures)

// ── PlcService ───────────────────────────────────────────────

export class PlcService extends EventEmitter {
  // Connection
  private _state: ConnectionState = 'disconnected';
  private socket: ReturnType<typeof TcpSocket.createConnection> | null = null;
  private decoder = new FrameDecoder();
  private host = '';
  private port = 0;
  private destroyed = false;

  // Reconnect
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Heartbeat
  private heartbeatTimer:  ReturnType<typeof setInterval> | null = null;
  private pongTimer:       ReturnType<typeof setTimeout>  | null = null;
  private lastPingSeq = -1;

  // Sequence + pending request map
  private seqCounter = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pending = new Map<number, PendingEntry<any>>();

  // ── Public API ─────────────────────────────────────────────

  get connectionState(): ConnectionState {
    return this._state;
  }

  connect(ip: string, port: number): void {
    this.host = ip;
    this.port = port;
    this.destroyed = false;
    this.reconnectAttempts = 0;
    this._openSocket();
  }

  disconnect(): void {
    this.destroyed = true;
    this._cleanup();
    this._rejectAllPending(new Error('Disconnected by user'));
    this._setState('disconnected');
  }

  /**
   * Send a GIN barcode scan.
   * Resolves with GIN_VALIDATION when the PLC responds.
   * Rejects on timeout (10 s) or connection loss.
   */
  sendGinScan(ingredientIndex: number, gin: string): Promise<GinValidationMsg> {
    return this._request<GinValidationMsg>((seq) => {
      const msg: GinScanMsg = { msgType: 0x01, seqNum: seq, ingredientIndex, gin };
      this._send(encodeGinScan(msg));
    });
  }

  /**
   * Send an ingredient sign-off (triggered by NFC tap).
   * Resolves with SIGNOFF_ACK when the PLC responds.
   * Rejects on timeout (10 s) or connection loss.
   */
  sendIngredientSignoff(params: SignoffParams): Promise<SignoffAckMsg> {
    return this._request<SignoffAckMsg>((seq) => {
      const msg: IngredientSignoffMsg = { msgType: 0x02, seqNum: seq, ...params };
      this._send(encodeIngredientSignoff(msg));
    });
  }

  // ── Socket lifecycle ───────────────────────────────────────

  private _openSocket(): void {
    this._setState('connecting');
    this.decoder.reset();

    this.socket = TcpSocket.createConnection(
      { host: this.host, port: this.port },
      () => {
        this.reconnectAttempts = 0;
        this._setState('connected');
        this._startHeartbeat();
      },
    );

    this.socket.on('data', (raw: Buffer | string) => {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as string, 'binary');
      const payloads = this.decoder.feed(chunk);
      for (const payload of payloads) {
        try {
          this._dispatch(payload);
        } catch (err) {
          this.emit('error', err);
        }
      }
    });

    this.socket.on('close', () => {
      this._stopHeartbeat();
      this._rejectAllPending(new Error('Connection closed'));
      this._setState('disconnected');
      if (!this.destroyed) this._scheduleReconnect();
    });

    this.socket.on('error', (_err: Error) => {
      // 'close' fires immediately after — handled there
    });
  }

  private _cleanup(): void {
    this._stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.destroy();
    this.socket = null;
  }

  private _setState(s: ConnectionState): void {
    if (this._state === s) return;
    this._state = s;
    this.emit('connectionChange', s);
  }

  // ── Message dispatch ───────────────────────────────────────

  private _dispatch(payload: Buffer): void {
    const msg = parseMessage(payload);

    switch (msg.msgType) {
      case MSG_TYPE.BATCH_RECIPE:
        this.emit('batchRecipe', msg as BatchRecipeMsg);
        break;

      case MSG_TYPE.GIN_VALIDATION:
      case MSG_TYPE.SIGNOFF_ACK:
        this._resolvePending((msg as GinValidationMsg | SignoffAckMsg).seqNum, msg);
        break;

      case MSG_TYPE.HEARTBEAT_REPLY: {
        const reply = msg as HeartbeatReplyMsg;
        if (reply.seqNum === this.lastPingSeq) {
          this._clearPongTimer();
        }
        break;
      }

      default:
        // Unknown msgType — already validated by parseMessage, won't reach here
        break;
    }
  }

  // ── Heartbeat ──────────────────────────────────────────────

  private _startHeartbeat(): void {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const seq = this._nextSeq();
      this.lastPingSeq = seq;
      this._send(encodeHeartbeat({ msgType: 0x10, seqNum: seq }));

      // Expect PONG within HEARTBEAT_TIMEOUT_MS
      this.pongTimer = setTimeout(() => {
        this.pongTimer = null;
        this._markDead();
      }, HEARTBEAT_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this._clearPongTimer();
  }

  private _clearPongTimer(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  /** Heartbeat timed out — destroy socket to trigger reconnect path. */
  private _markDead(): void {
    this._stopHeartbeat();
    this._rejectAllPending(new Error('Heartbeat timeout — PLC not responding'));
    this.socket?.destroy(); // fires 'close', which triggers reconnect
  }

  // ── Reconnect ──────────────────────────────────────────────

  private _scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts - 1),
      RECONNECT_MAX_MS,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._openSocket();
    }, delay);
  }

  // ── Request/response correlation ───────────────────────────

  private _request<T>(send: (seq: number) => void): Promise<T> {
    if (this._state !== 'connected') {
      return Promise.reject(new Error('Not connected'));
    }

    return new Promise<T>((resolve, reject) => {
      const seq = this._nextSeq();

      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`Request timed out (seqNum=${seq})`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(seq, { resolve, reject, timer });
      send(seq);
    });
  }

  private _resolvePending(seqNum: number, value: unknown): void {
    const entry = this.pending.get(seqNum);
    if (!entry) return;
    this.pending.delete(seqNum);
    clearTimeout(entry.timer);
    entry.resolve(value);
  }

  private _rejectAllPending(err: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  // ── Helpers ────────────────────────────────────────────────

  private _nextSeq(): number {
    this.seqCounter = (this.seqCounter + 1) & 0xffff;
    return this.seqCounter;
  }

  private _send(payload: Buffer): void {
    if (!this.socket) return; // silently no-op — socket may be null between reconnects
    this.socket.write(encode(payload));
  }
}

// ── Singleton ─────────────────────────────────────────────────
//
// One instance shared across the app.
// Call plcService.connect(ip, port) to start.

export const plcService = new PlcService();
