// ============================================================
// mock-plc/server.ts — Node.js TCP server simulating Omron PLC
// ARCHITECTURE.md §3, §8.4
//
// Run:  npx ts-node mock-plc/server.ts
//       npx ts-node --project tsconfig.node.json mock-plc/server.ts
//
// GIN validation rule (mirrors real PLC DB for testing):
//   PASS  → GIN starts with "1"  (e.g. "100001", "123456")
//   FAIL  → anything else        (e.g. "900001", "ABC", "")
// ============================================================

import * as net from 'net';
import { encode, FrameDecoder } from '../src/services/FrameCodec';
import {
  parseMessage,
  encodeBatchRecipe,
  encodeGinValidation,
  encodeSignoffAck,
  encodeHeartbeatReply,
} from '../src/services/ProtocolCodec';
import { FIXTURE_BATCH_RECIPE } from './fixtures';
import {
  AnyMessage,
  GinScanMsg,
  IngredientSignoffMsg,
  HeartbeatMsg,
} from '../src/types/protocol';

const PORT = 8500;
const BATCH_PUSH_DELAY_MS = 500;

// ── GIN validation ────────────────────────────────────────────

function validateGin(
  gin: string,
  ingredientIndex: number,
): { valid: boolean; rejectReason: string } {
  if (!gin.startsWith('1')) {
    return { valid: false, rejectReason: `GIN ${gin} not found in ingredient database` };
  }
  return { valid: true, rejectReason: '' };
}

// ── Message logger ────────────────────────────────────────────

const DIRECTION = { rx: '  RX ←', tx: '  TX →' } as const;

function log(dir: keyof typeof DIRECTION, msg: AnyMessage): void {
  const label = `0x${msg.msgType.toString(16).toUpperCase().padStart(2, '0')}`;
  const name = MSG_TYPE_NAMES[msg.msgType] ?? 'UNKNOWN';
  console.log(`[mock-plc] ${DIRECTION[dir]} ${label} ${name.padEnd(20)} seq=${msg.seqNum}`);
}

const MSG_TYPE_NAMES: Record<number, string> = {
  0x01: 'GIN_SCAN',
  0x02: 'INGREDIENT_SIGNOFF',
  0x10: 'HEARTBEAT',
  0x80: 'BATCH_RECIPE',
  0x81: 'GIN_VALIDATION',
  0x82: 'SIGNOFF_ACK',
  0x90: 'HEARTBEAT_REPLY',
};

// ── Server ────────────────────────────────────────────────────

export function createMockPlcServer(): net.Server {
const server = net.createServer((socket) => {
  const remote = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`\n[mock-plc] Client connected: ${remote}`);

  const decoder = new FrameDecoder();

  function send(payload: Buffer): void {
    socket.write(encode(payload));
  }

  // Push BATCH_RECIPE shortly after connect (simulates HMI selecting batch)
  const pushTimer = setTimeout(() => {
    const recipe = { ...FIXTURE_BATCH_RECIPE };
    console.log(
      `[mock-plc] Pushing BATCH_RECIPE — ${recipe.productCode} / ${recipe.batchNo}` +
      ` (${recipe.ingredientCount} ingredients)`,
    );
    const payload = encodeBatchRecipe(recipe);
    log('tx', recipe);
    send(payload);
  }, BATCH_PUSH_DELAY_MS);

  socket.on('data', (chunk: Buffer) => {
    const payloads = decoder.feed(chunk);

    for (const payload of payloads) {
      let msg: AnyMessage;
      try {
        msg = parseMessage(payload);
      } catch (e) {
        console.error('[mock-plc] Parse error:', e);
        continue;
      }

      log('rx', msg);

      switch (msg.msgType) {
        // ── GIN_SCAN (0x01) ──────────────────────────────────
        case 0x01: {
          const m = msg as GinScanMsg;
          const ingredientName =
            FIXTURE_BATCH_RECIPE.ingredients[m.ingredientIndex]?.ingredientName ?? '';
          const { valid, rejectReason } = validateGin(m.gin, m.ingredientIndex);

          console.log(
            `[mock-plc]       GIN="${m.gin}" ingredient[${m.ingredientIndex}]="${ingredientName}"` +
            ` → ${valid ? 'PASS ✓' : `FAIL — ${rejectReason}`}`,
          );

          const response = encodeGinValidation({
            msgType: 0x81,
            seqNum: m.seqNum,
            gin: m.gin,
            valid,
            ingredientName,
            rejectReason,
          });
          log('tx', { msgType: 0x81, seqNum: m.seqNum } as AnyMessage);
          send(response);
          break;
        }

        // ── INGREDIENT_SIGNOFF (0x02) ─────────────────────────
        case 0x02: {
          const m = msg as IngredientSignoffMsg;
          const ingredientName =
            FIXTURE_BATCH_RECIPE.ingredients[m.ingredientIndex]?.ingredientName ?? '';

          console.log(
            `[mock-plc]       ingredient[${m.ingredientIndex}]="${ingredientName}"` +
            ` operatorId="${m.operatorId}" ginCount=${m.ginCount}`,
          );
          m.ginEntries.forEach((e, i) =>
            console.log(`[mock-plc]         GIN[${i}]: "${e.gin}" ${e.bagCount} bag(s)`),
          );

          const response = encodeSignoffAck({
            msgType: 0x82,
            seqNum: m.seqNum,
            ingredientIndex: m.ingredientIndex,
            accepted: true,
            rejectReason: '',
          });
          log('tx', { msgType: 0x82, seqNum: m.seqNum } as AnyMessage);
          send(response);
          break;
        }

        // ── HEARTBEAT / PING (0x10) ───────────────────────────
        case 0x10: {
          const m = msg as HeartbeatMsg;
          const response = encodeHeartbeatReply({ msgType: 0x90, seqNum: m.seqNum });
          log('tx', { msgType: 0x90, seqNum: m.seqNum } as AnyMessage);
          send(response);
          break;
        }

        default:
          console.warn(`[mock-plc] Unhandled msgType: 0x${msg.msgType.toString(16)}`);
      }
    }
  });

  socket.on('close', () => {
    clearTimeout(pushTimer);
    decoder.reset();
    console.log(`[mock-plc] Client disconnected: ${remote}\n`);
  });

  socket.on('error', (err) => {
    console.error(`[mock-plc] Socket error (${remote}):`, err.message);
  });
});
  return server;
}

if (require.main === module) {
  const srv = createMockPlcServer();
  srv.on('error', (err) => {
    console.error('[mock-plc] Server error:', err.message);
    process.exit(1);
  });
  srv.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(50));
    console.log(`[mock-plc] Listening on port ${PORT}`);
    console.log('[mock-plc] GIN rule: starts with "1" → PASS, else → FAIL');
    console.log('='.repeat(50));
  });
}
