# PAC-Scanner

Industrial Android app for ingredient picking at an animal nutrition plant.
React Native (TypeScript, bare workflow) + Omron PLC via TCP/IP.

## Key Files
- ARCHITECTURE.md — full spec, protocol, screen designs, PLC UDTs
- src/services/PlcService.ts — TCP socket client (singleton)
- src/services/FrameCodec.ts — binary frame encode/decode
- src/services/ProtocolCodec.ts — message type serialization
- src/services/NfcService.ts — NFC tag reading for operator sign-off
- src/store/batchStore.ts — full recipe state
- src/store/pickingStore.ts — active ingredient state machine
- mock-plc/server.ts — Node.js PLC simulator for testing

## Stack
React Native (bare, not Expo), TypeScript, Zustand, react-native-tcp-socket,
react-native-nfc-manager, react-native-vision-camera, react-native-mmkv

## Rules
- Read ARCHITECTURE.md Section 3 before touching protocol code
- Binary structs must match Omron UDTs exactly (big-endian, null-padded ASCII)
- NFC tag UID = operator ID (16 bytes, null-padded)
- Max 5 GINs per ingredient, bag count 1-5 per GIN
- All state changes go through Zustand stores
- No Expo modules — bare workflow only