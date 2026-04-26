# PAC-Scanner — Architecture & Development Plan
# Ingredient Picking Assistant — Animal Nutrition Plant

## 1. Overview

**Purpose:** Android app that guides operators through ingredient picking. Displays batch recipe (all ingredients + required bag counts), validates GIN barcodes via PLC, tracks bag collection per GIN, and captures operator sign-off via NFC tag tap.

**Framework:** React Native (TypeScript) — bare workflow (not Expo), because we need native modules for hardware scanner intents, TCP sockets, and NFC.

**PLC:** Omron Sysmac (NJ/NX Series) — raw TCP socket server, fixed-field binary protocol.

---

## 2. Operator Workflow

```
  HMI selects batch
       |
       v
  PLC sends BATCH_RECIPE to app
  (Product Code, Batch No, Description, all ingredients with required bags)
       |
       v
  App displays full ingredient list
  Operator selects an ingredient to pick
       |
       v
  +---> SCAN GIN barcode (HW scanner or camera)
  |         |
  |         v
  |    App sends GIN_SCAN to PLC
  |         |
  |         v
  |    PLC validates GIN against ingredient DB
  |         |
  |    +----+----+
  |    |         |
  |    v         v
  |  PASS      FAIL --> show reject reason, scan again
  |    |
  |    v
  |  Operator selects bag count for this GIN [1] [2] [3] [4] [5]
  |    |
  |    v
  |  Need more bags for this ingredient? --YES--> loop back to SCAN GIN
  |    |
  |    NO (all bags collected)
  |    |
  |    v
  |  Operator taps NFC tag to sign off ingredient
  |    |
  |    v
  |  App sends INGREDIENT_SIGNOFF to PLC
  |  (all GINs, bag counts, operator ID from NFC)
  |    |
  |    v
  |  More ingredients? --YES--> operator selects next ingredient
  |    |
  |    NO
  |    v
  BATCH COMPLETE --> summary screen
```

**Key rules:**
- Batch is selected on a dedicated HMI, NOT from the app
- PLC pushes full recipe upfront when batch starts
- App shows ALL ingredients — operator navigates between them
- Up to 5 GINs per ingredient
- NFC tap is the sign-off action per ingredient — replaces confirm button
- NFC tap triggers all data for that ingredient being sent to PLC
- Operator wears gloves — big buttons, no typing, loud audio/vibration feedback

---

## 3. Communication Protocol

### 3.1 Framing

Length-prefixed binary frame over TCP:

```
+----------+----------+--------------------------+
|  STX (1) | LEN (2)  |     PAYLOAD (N bytes)    |
|   0x02   | uint16BE |     Fixed-field struct    |
+----------+----------+--------------------------+
```

### 3.2 Message Types

**PLC -> App:**

```
BATCH_RECIPE (0x80) — PLC pushes when batch selected on HMI:
  Byte 0        : msgType = 0x80
  Byte 1-2      : seqNum (UINT)
  Byte 3-18     : productCode (16 bytes, null-padded ASCII)
  Byte 19-34    : batchNo (16 bytes, null-padded ASCII)
  Byte 35-66    : productDescription (32 bytes, null-padded ASCII)
  Byte 67       : ingredientCount (BYTE, 1-20)
  Byte 68+      : array of ingredients, each 48 bytes:
                    Byte 0-31  : ingredientName (32 bytes, null-padded)
                    Byte 32-33 : requiredBags (UINT)
                    Byte 34-47 : reserved (14 bytes, zero-padded for future use)

  Max payload: 67 + (20 * 48) = 1027 bytes

GIN_VALIDATION (0x81) — PLC responds after GIN_SCAN:
  Byte 0        : msgType = 0x81
  Byte 1-2      : seqNum (UINT)
  Byte 3-18     : gin (16 bytes, echo back)
  Byte 19       : valid (BYTE — 0x00=FAIL, 0x01=PASS)
  Byte 20-51    : ingredientName (32 bytes, confirmed name)
  Byte 52-83    : rejectReason (32 bytes, if FAIL, null-padded)

SIGNOFF_ACK (0x82) — PLC responds after INGREDIENT_SIGNOFF:
  Byte 0        : msgType = 0x82
  Byte 1-2      : seqNum (UINT)
  Byte 3        : ingredientIndex (BYTE)
  Byte 4        : accepted (BYTE — 0x00=REJECTED, 0x01=ACCEPTED)
  Byte 5-36     : rejectReason (32 bytes, if rejected)

HEARTBEAT_REPLY (0x90):
  Byte 0        : msgType = 0x90
  Byte 1-2      : seqNum (UINT, echo back)
```

**App -> PLC:**

```
GIN_SCAN (0x01) — App sends after operator scans barcode:
  Byte 0        : msgType = 0x01
  Byte 1-2      : seqNum (UINT)
  Byte 3        : ingredientIndex (BYTE — which ingredient this scan is for)
  Byte 4-19     : gin (16 bytes, null-padded ASCII)

INGREDIENT_SIGNOFF (0x02) — App sends when operator taps NFC:
  Byte 0        : msgType = 0x02
  Byte 1-2      : seqNum (UINT)
  Byte 3        : ingredientIndex (BYTE)
  Byte 4-19     : operatorId (16 bytes, NFC tag UID, null-padded)
  Byte 20       : ginCount (BYTE, 1-5)
  Byte 21+      : array of GIN entries, each 20 bytes:
                    Byte 0-15  : gin (16 bytes, null-padded ASCII)
                    Byte 16-17 : bagCount (UINT)
                    Byte 18-19 : reserved (2 bytes)

  Max payload: 21 + (5 * 20) = 121 bytes

HEARTBEAT (0x10):
  Byte 0        : msgType = 0x10
  Byte 1-2      : seqNum (UINT)
```

### 3.3 PLC UDTs (Omron Structured Text)

```
TYPE IngredientRecord :
STRUCT
    ingredientName  : ARRAY[0..31] OF BYTE;
    requiredBags    : UINT;
    reserved        : ARRAY[0..13] OF BYTE;
END_STRUCT
END_TYPE

TYPE PlcToApp_BatchRecipe :
STRUCT
    msgType             : BYTE;            (* 0x80 *)
    seqNum              : UINT;
    productCode         : ARRAY[0..15] OF BYTE;
    batchNo             : ARRAY[0..15] OF BYTE;
    productDescription  : ARRAY[0..31] OF BYTE;
    ingredientCount     : BYTE;
    ingredients         : ARRAY[0..19] OF IngredientRecord;
END_STRUCT
END_TYPE

TYPE PlcToApp_GinValidation :
STRUCT
    msgType         : BYTE;            (* 0x81 *)
    seqNum          : UINT;
    gin             : ARRAY[0..15] OF BYTE;
    valid           : BYTE;            (* 0=FAIL, 1=PASS *)
    ingredientName  : ARRAY[0..31] OF BYTE;
    rejectReason    : ARRAY[0..31] OF BYTE;
END_STRUCT
END_TYPE

TYPE GinEntry :
STRUCT
    gin         : ARRAY[0..15] OF BYTE;
    bagCount    : UINT;
    reserved    : ARRAY[0..1] OF BYTE;
END_STRUCT
END_TYPE

TYPE AppToPlc_IngredientSignoff :
STRUCT
    msgType         : BYTE;            (* 0x02 *)
    seqNum          : UINT;
    ingredientIndex : BYTE;
    operatorId      : ARRAY[0..15] OF BYTE;
    ginCount        : BYTE;
    ginEntries      : ARRAY[0..4] OF GinEntry;
END_STRUCT
END_TYPE

TYPE AppToPlc_GinScan :
STRUCT
    msgType         : BYTE;            (* 0x01 *)
    seqNum          : UINT;
    ingredientIndex : BYTE;
    gin             : ARRAY[0..15] OF BYTE;
END_STRUCT
END_TYPE
```

### 3.4 Sequence Diagram

```
    App                                PLC                         HMI
     |                                  |                            |
     |                                  |<-- Operator selects batch -|
     |                                  |                            |
     |<---- BATCH_RECIPE (0x80) --------|
     |  productCode: "PF-2001"          |
     |  batchNo: "B-20260320-001"       |
     |  description: "Premium Dog Kibble"|
     |  ingredients: [                  |
     |    { "Wheat Flour", 6 bags },    |
     |    { "Soy Meal", 4 bags },       |
     |    { "Bone Meal", 2 bags },      |
     |    ...                           |
     |  ]                               |
     |                                  |
     | Operator selects "Wheat Flour"   |
     | Operator scans GIN barcode       |
     |                                  |
     |----- GIN_SCAN (0x01) ----------->|
     |  ingredientIndex: 0              |
     |  gin: "123456"                   |
     |                                  |  PLC DB lookup
     |<---- GIN_VALIDATION (0x81) ------|  valid: PASS
     |                                  |
     | Operator taps [3] bags           |
     | Operator scans another GIN       |
     |                                  |
     |----- GIN_SCAN (0x01) ----------->|
     |<---- GIN_VALIDATION (0x81) ------|  valid: PASS
     |                                  |
     | Operator taps [2] bags           |
     | Operator scans last GIN          |
     |                                  |
     |----- GIN_SCAN (0x01) ----------->|
     |<---- GIN_VALIDATION (0x81) ------|  valid: PASS
     |                                  |
     | Operator taps [1] bag            |
     | All 6 bags collected             |
     | OPERATOR TAPS NFC TAG            |
     |                                  |
     |----- INGREDIENT_SIGNOFF (0x02) ->|
     |  ingredientIndex: 0              |
     |  operatorId: "A1B2C3D4..."       |
     |  ginEntries: [                   |
     |    { "123456", 3 bags },         |
     |    { "345678", 2 bags },         |
     |    { "567890", 1 bag  },         |
     |  ]                               |
     |                                  |
     |<---- SIGNOFF_ACK (0x82) ---------|  accepted: YES
     |                                  |
     | Operator selects "Soy Meal"      |
     | ... repeat ...                   |
```

---

## 4. Screen Design

### 4.1 Main Picking Screen

Single-screen workflow. Operator should never navigate away during normal operation.

```
+---------------------------------------------+
| [connected]    PF-2001 | B-20260320-001     |  <-- Product Code + Batch No
+---------------------------------------------+
| Premium Dog Kibble                          |  <-- Product Description
+---------------------------------------------+
|                                             |
| Ingredients:                                |
| +---+------------------------------+-------+|
| |   | Wheat Flour                  | 0 / 6 ||  <-- tap to select
| +---+------------------------------+-------+|
| | > | Soy Meal                     | 0 / 4 ||  <-- currently selected
| +---+------------------------------+-------+|
| |   | Bone Meal                    | 0 / 2 ||
| +---+------------------------------+-------+|
| | * | Vitamin Premix               | 2 / 2 ||  <-- completed (signed off)
| +---+------------------------------+-------+|
|                                             |
+---------------------------------------------+
| SOY MEAL — 4 bags needed                    |  <-- Active ingredient detail
|                                             |
| Collected: ----------  0 / 4 bags           |
|                                             |
| GIN Scans:                                  |
| +------------------------------------------+|
| |   - - - scan GIN barcode - - -           ||
| +------------------------------------------+|
|                                             |
| [ Scan with Camera ]                        |
+---------------------------------------------+
```

After scanning a valid GIN and selecting bags:

```
+---------------------------------------------+
| SOY MEAL — 4 bags needed                    |
|                                             |
| Collected: =====-----  2 / 4 bags           |
|                                             |
| GIN Scans:                                  |
| +------------------------------------------+|
| | [done] GIN 345678     2 bags             ||
| +------------------------------------------+|
| |   - - - scan next GIN - - -             ||
| +------------------------------------------+|
|                                             |
| [ Scan with Camera ]                        |
+---------------------------------------------+
```

After all bags collected:

```
+---------------------------------------------+
| SOY MEAL — 4 bags needed                    |
|                                             |
| Collected: ==========  4 / 4 bags           |
|                                             |
| GIN Scans:                                  |
| +------------------------------------------+|
| | [done] GIN 345678     2 bags             ||
| +------------------------------------------+|
| | [done] GIN 567890     2 bags             ||
| +------------------------------------------+|
|                                             |
| +------------------------------------------+|
| |                                          ||
| |   TAP NFC TAG TO SIGN OFF               ||
| |   [NFC icon pulsing]                    ||
| |                                          ||
| +------------------------------------------+|
+---------------------------------------------+
```

### 4.2 GIN Rejected Overlay

```
+---------------------------------------------+
|     +-------------------------------+       |
|     |   [X]  GIN NOT VALID          |       |
|     |                               |       |
|     |   GIN 999999 is not valid     |       |
|     |   for Soy Meal                |       |
|     |                               |       |
|     |   Reason: Unknown GIN         |       |
|     |                               |       |
|     |   [ SCAN AGAIN ]              |       |
|     +-------------------------------+       |
+---------------------------------------------+
```

### 4.3 Bag Count Selector (shown after valid GIN scan)

```
+---------------------------------------------+
|  Bags for GIN 345678:                       |
|                                             |
|   [ 1 ]  [ 2 ]  [ 3 ]  [ 4 ]  [ 5 ]       |  <-- min 60dp, glove-friendly
|                                             |
+---------------------------------------------+
```

Note: Tapping a bag count immediately confirms it and adds the GIN to the list. No separate confirm button — the NFC tap at the end is the real confirmation.

### 4.4 Ingredient Signed Off (toast/badge)

When NFC tap succeeds, the ingredient row in the list shows a checkmark and the operator can select the next incomplete ingredient.

### 4.5 Batch Complete Screen

```
+---------------------------------------------+
|  BATCH COMPLETE                             |
|                                             |
|  PF-2001 | B-20260320-001                   |
|  Premium Dog Kibble                         |
|                                             |
|  Wheat Flour — 6 bags (3 GINs) signed: JD  |
|  Soy Meal — 4 bags (2 GINs) signed: JD     |
|  Bone Meal — 2 bags (1 GIN) signed: JD     |
|  Vitamin Premix — 2 bags (1 GIN) signed: MK|
|                                             |
|  Awaiting next batch...                     |
+---------------------------------------------+
```

### 4.6 Settings Screen

- PLC IP address and port
- Scanner source: Hardware / Camera / Auto-detect
- Hardware scanner intent action (configurable per vendor)
- Heartbeat interval
- Connection test button
- App version / diagnostics

---

## 5. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Framework | React Native + TypeScript (bare) | Android app, TS ecosystem |
| Camera scanning | react-native-vision-camera v4 + MLKit | Camera barcode fallback |
| HW scanner | Native Kotlin BroadcastReceiver bridge | Built-in scanner via intents |
| NFC | react-native-nfc-manager | Read MIFARE/NTAG 13.56 MHz tags |
| TCP comms | react-native-tcp-socket | Raw TCP client |
| State | Zustand | Global state management |
| Storage | react-native-mmkv | Persist settings |
| Navigation | React Navigation | Screen routing |

---

## 6. Project Structure

```
pac-scanner/
  android/
    app/src/main/java/.../
      ScannerModule.kt            # Native bridge for HW scanner intents
  src/
    app/
      App.tsx                      # Root navigator
    screens/
      PickingScreen.tsx            # Main single-screen workflow
      SettingsScreen.tsx           # Connection + scanner config
      BatchSummaryScreen.tsx       # End-of-batch review
    services/
      PlcService.ts               # TCP socket client + reconnect + event emitter
      FrameCodec.ts               # STX + length-prefix framing encode/decode
      ProtocolCodec.ts            # Message type serialize/deserialize (binary)
      ScannerService.ts           # Unified HW + camera barcode API
      NfcService.ts               # NFC tag read for operator sign-off
    store/
      batchStore.ts               # Full recipe, all ingredients, progress
      pickingStore.ts             # Current ingredient state machine
      connectionStore.ts          # TCP state, heartbeat
      settingsStore.ts            # Persisted config (IP, port, scanner mode)
    components/
      ConnectionBadge.tsx          # Connection status indicator
      BatchHeader.tsx              # Product code, batch no, description
      IngredientList.tsx           # All ingredients with completion status
      IngredientDetail.tsx         # Active ingredient: GINs, progress, bag count
      GinList.tsx                  # Scanned GINs for current ingredient
      BagCountSelector.tsx         # Large [1]-[5] tap targets
      ValidationOverlay.tsx        # GIN pass/fail modal
      NfcSignoffPrompt.tsx         # "Tap NFC tag" pulsing prompt
      CameraScanner.tsx            # Vision Camera barcode wrapper
    types/
      protocol.ts                 # All message type definitions + UDT mirrors
    utils/
      audio.ts                     # Success/fail sounds + vibration
  __tests__/
    FrameCodec.test.ts
    ProtocolCodec.test.ts
    PlcService.test.ts
  mock-plc/
    server.ts                     # Node.js TCP server simulating PLC
    fixtures.ts                   # Sample batch recipes for testing
  package.json
  tsconfig.json
```

---

## 7. State Management

### batchStore (recipe-level)

```typescript
interface BatchState {
  productCode: string;
  batchNo: string;
  description: string;
  ingredients: IngredientState[];
  batchStatus: 'idle' | 'active' | 'complete';
}

interface IngredientState {
  name: string;
  requiredBags: number;
  collectedBags: number;
  ginEntries: GinEntry[];
  signedOff: boolean;
  operatorId: string | null;
}

interface GinEntry {
  gin: string;
  bagCount: number;
  validated: boolean;
}
```

### pickingStore (active ingredient state machine)

```
IDLE --> AWAITING_SCAN --> VALIDATING --> GIN_VALID --> AWAITING_BAG_COUNT
                              |                              |
                              v                              v
                         GIN_INVALID                    (bag selected,
                              |                         add to list,
                              v                         back to AWAITING_SCAN
                        AWAITING_SCAN                   or READY_FOR_SIGNOFF)
                                                             |
                                                             v
                                                    NFC_SIGNING --> SIGNED_OFF
```

---

## 8. Key Implementation Notes

### 8.1 Hardware Scanner
- Native Kotlin BroadcastReceiver bridge (~50 lines)
- Configurable intent action string (per vendor)
- Common: Zebra DataWedge, Honeywell, Datalogic
- No vendor SDK needed — just intent/broadcast

### 8.2 NFC (react-native-nfc-manager)
- Tags are HF 13.56 MHz (MIFARE/NTAG) — Android NFC compatible
- Read the tag UID (unique identifier) — this IS the operator ID
- NFC read triggers INGREDIENT_SIGNOFF message to PLC
- If NFC read fails, show retry prompt

### 8.3 TCP Socket
- Frame reassembly buffer (TCP is a stream)
- Auto-reconnect with exponential backoff (1s -> 2s -> 4s -> max 30s)
- Heartbeat PING/PONG every 5 seconds
- Event emitter for PLC-initiated messages (BATCH_RECIPE)
- Request/response correlation via seqNum

### 8.4 PLC Side (Omron Sysmac)
```
1. SktTCPAccept — wait for app connection
2. On batch start (from HMI): send BATCH_RECIPE
3. Loop:
   - SktTCPRcv -> parse msgType:
     - GIN_SCAN -> DB lookup -> send GIN_VALIDATION
     - INGREDIENT_SIGNOFF -> validate + store -> send SIGNOFF_ACK
     - PING -> send PONG
4. On disconnect: SktClose, return to accept
```

---

## 9. Development Phases

### Phase 1 — Protocol + TCP (Week 1)
- Scaffold RN project, install all deps
- FrameCodec.ts (STX + length-prefix, frame reassembly)
- ProtocolCodec.ts (all message types, binary <-> TypeScript)
- PlcService.ts (TCP client, reconnect, heartbeat, event emitter)
- Unit tests for codecs
- Node.js mock PLC server
- PLC side: TCP server + UDTs

### Phase 2 — UI + Scanning + NFC (Week 2)
- batchStore.ts + pickingStore.ts (state machines)
- All UI components (see project structure)
- PickingScreen.tsx (wire everything)
- ScannerModule.kt (native intent bridge)
- ScannerService.ts (unified HW + camera)
- NfcService.ts (tag read for sign-off)
- Camera scanning integration

### Phase 3 — Hardening (Week 3)
- Audio/vibration feedback
- Connection loss handling
- Settings screen
- Batch summary screen
- Edge cases (double scan, scan during validation, etc.)
- PLC side: full GIN DB + batch logic

### Phase 4 — Optional
- Operator login (scan NFC badge at app start)
- Audit trail / scan log
- Multiple PLC profiles
- Raw TCP debug view
- APK distribution
