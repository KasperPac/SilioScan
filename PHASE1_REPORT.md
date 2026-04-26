# PAC-Scanner — Phase 1 Completion Report

**Date:** 2026-03-20
**Project:** OMR-1708 — Rabar Animal Nutrition Plant
**Scope:** Phase 1 — Foundation, Protocol Layer, PLC Service, Mock PLC

---

## Summary

Phase 1 is complete. All deliverables have been implemented, tested, and verified. The test suite runs 105 tests across 4 suites with 0 failures.

---

## Deliverables

### 1. Project Scaffold

- React Native 0.84.1 bare workflow (TypeScript, no Expo)
- Full directory structure per ARCHITECTURE.md §6
- All dependencies installed:

| Package | Purpose |
|---|---|
| `zustand` | Global state |
| `@react-navigation/native` + `native-stack` | Screen navigation |
| `react-native-tcp-socket` | PLC TCP connection |
| `react-native-nfc-manager` | Operator NFC sign-off |
| `react-native-vision-camera` | Barcode scanning |
| `react-native-mmkv` | Persistent settings |

### 2. Binary Protocol Layer

#### `src/services/FrameCodec.ts`

STX (0x02) + uint16BE length prefix framing with full stream reassembly.

- `encode(payload: Buffer): Buffer` — wraps payload in frame
- `FrameDecoder.feed(chunk: Buffer): Buffer[]` — handles partial frames, multiple frames per chunk, garbage bytes before STX
- `FrameDecoder.reset()` — clears internal buffer on reconnect

#### `src/services/ProtocolCodec.ts`

All 7 message types serialized to/from Omron UDT byte layout (big-endian, null-padded ASCII):

| MsgType | Direction | Payload Size |
|---|---|---|
| `0x01` GIN_SCAN | App → PLC | 20 bytes |
| `0x02` INGREDIENT_SIGNOFF | App → PLC | 21 + N×20 bytes |
| `0x10` HEARTBEAT | App → PLC | 3 bytes |
| `0x80` BATCH_RECIPE | PLC → App | 68 + N×48 bytes |
| `0x81` GIN_VALIDATION | PLC → App | 84 bytes |
| `0x82` SIGNOFF_ACK | PLC → App | 37 bytes |
| `0x90` HEARTBEAT_REPLY | PLC → App | 3 bytes |

`parseMessage(payload: Buffer): AnyMessage` — dispatches to the correct decoder by msgType.

#### `src/types/protocol.ts`

TypeScript interfaces for all 7 message types, `MSG_TYPE` const enum, and union types (`AnyMessage`, `PlcMessage`, `AppMessage`).

### 3. PLC Service

#### `src/services/PlcService.ts`

Singleton TCP client with full lifecycle management:

| Feature | Detail |
|---|---|
| Connection | `connect(ip, port)` / `disconnect()` — explicit lifecycle |
| State | `'disconnected' \| 'connecting' \| 'connected'` via `connectionState` getter |
| Events | `'connectionChange'`, `'batchRecipe'` |
| Auto-reconnect | Exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s cap |
| Heartbeat | PING every 5 s; PONG expected within 3 s, else `_markDead()` |
| Request correlation | seqNum (uint16, wrapping) maps responses to pending Promises |
| `sendGinScan()` | Returns `Promise<GinValidationMsg>`, 10 s timeout |
| `sendIngredientSignoff()` | Returns `Promise<SignoffAckMsg>`, 10 s timeout |

### 4. Mock PLC Server

#### `mock-plc/server.ts`

Node.js TCP server simulating Omron PLC behaviour:

- Pushes `BATCH_RECIPE` 500 ms after client connects
- `GIN_SCAN` → `GIN_VALIDATION`: GIN starts with `"1"` → PASS, else FAIL
- `INGREDIENT_SIGNOFF` → `SIGNOFF_ACK`: always accepted
- `HEARTBEAT` → `HEARTBEAT_REPLY`
- Console logs every RX/TX frame with direction, msgType, and seqNum

Run with: `npx ts-node --project tsconfig.node.json mock-plc/server.ts`

#### `mock-plc/fixtures.ts`

Test data:

- `FIXTURE_BATCH_RECIPE` — 4 ingredients (Wheat Flour/6, Soy Meal/4, Bone Meal/2, Vitamin Premix/2)
- `FIXTURE_BATCH_RECIPE_SMALL` — 1 ingredient (Cat Food)
- `VALID_GINS` — GINs starting with `"1"` per ingredient
- `INVALID_GINS` — rejection test values

### 5. Zustand Stores

All stores use `create<T>()()` (double-call form required for TypeScript middleware inference):

| Store | Purpose |
|---|---|
| `src/store/batchStore.ts` | Active batch recipe from PLC |
| `src/store/pickingStore.ts` | Per-ingredient state machine (IDLE → SIGNED_OFF) |
| `src/store/connectionStore.ts` | PLC connection state mirror |
| `src/store/settingsStore.ts` | IP/port persisted via MMKV |

---

## Test Results

```
Test Suites: 4 passed, 4 total
Tests:       105 passed, 105 total
```

| Suite | Tests | Coverage |
|---|---|---|
| `FrameCodec.test.ts` | 21 | encode, decode, partial/split/multi/garbage frames, reset |
| `ProtocolCodec.test.ts` | 57 | all 7 message types: byte layout, round-trip, null-padding, big-endian, error cases |
| `PlcService.test.ts` | 26 | connection lifecycle, backoff, heartbeat, events, sendGinScan, sendIngredientSignoff, TCP reassembly |
| `App.test.tsx` | 1 | smoke test |

---

## Key Design Decisions

**Binary correctness first.** ProtocolCodec tests verify individual bytes at specific offsets (not just round-trips), catching endianness and padding bugs before they reach the PLC.

**Fake timers with `doNotFake: ['setImmediate', 'nextTick']`.** Jest's fake timers block `setImmediate`, which is used for the mock socket's async `onConnect` callback. Excluding these two lets async socket setup work correctly in tests.

**Synchronous `MockSocket.destroy()`.** Making the mock socket emit `'close'` synchronously in `destroy()` prevents cross-test timer leakage that caused false failures when tests ran in sequence.

**`_send()` is a no-op when socket is null.** During reconnect cycles, the heartbeat `setInterval` may fire between socket teardown and re-establishment. Rather than throwing (which would propagate out of fake-timer callbacks and corrupt test state), `_send()` returns silently — the heartbeat's pong timeout will fire and call `_markDead()`, which is a safe no-op on a null socket.

---

## Phase 2 Scope (Next)

- Screen implementation: `HomeScreen`, `ScanScreen`, `ReviewScreen`
- NFC sign-off flow (`NfcService.ts`)
- Barcode scanner integration (VisionCamera)
- Connection settings screen with IP/port persistence
- Integration test against mock PLC server
