// ============================================================
// FrameCodec.ts — STX + length-prefix framing (ARCHITECTURE.md §3.1)
//
// Frame layout:
//   Byte 0     : STX  (0x02)
//   Byte 1–2   : LEN  (uint16BE) — length of PAYLOAD only
//   Byte 3–3+N : PAYLOAD
// ============================================================

const STX = 0x02;
const HEADER_SIZE = 3; // 1 (STX) + 2 (LEN)

/**
 * Wrap a payload Buffer in an STX + length-prefixed frame.
 */
export function encode(payload: Buffer): Buffer {
  const frame = Buffer.allocUnsafe(HEADER_SIZE + payload.length);
  frame[0] = STX;
  frame.writeUInt16BE(payload.length, 1);
  payload.copy(frame, HEADER_SIZE);
  return frame;
}

/**
 * Stateful stream reassembler.
 *
 * Feed TCP chunks in via feed(). Each call returns an array of
 * complete payload Buffers extracted from the stream. Handles:
 *   - Partial frames (split mid-header or mid-payload)
 *   - Multiple frames in one chunk
 *   - Garbage bytes before STX (re-synchronises by scanning forward)
 *   - Empty payloads (LEN = 0)
 */
export class FrameDecoder {
  private buf: Buffer = Buffer.alloc(0);

  feed(chunk: Buffer): Buffer[] {
    // Append chunk to internal reassembly buffer
    this.buf = Buffer.concat([this.buf, chunk]);

    const frames: Buffer[] = [];

    while (true) {
      // ── 1. Find STX ────────────────────────────────────────
      const stxIndex = this.buf.indexOf(STX);

      if (stxIndex === -1) {
        // No STX anywhere — discard everything
        this.buf = Buffer.alloc(0);
        break;
      }

      if (stxIndex > 0) {
        // Garbage bytes before STX — skip them
        this.buf = this.buf.subarray(stxIndex);
      }

      // ── 2. Need at least a full header ─────────────────────
      if (this.buf.length < HEADER_SIZE) {
        break; // Wait for more data
      }

      // ── 3. Read LEN ────────────────────────────────────────
      const payloadLen = this.buf.readUInt16BE(1);
      const totalSize = HEADER_SIZE + payloadLen;

      // ── 4. Wait for full payload ───────────────────────────
      if (this.buf.length < totalSize) {
        break; // Incomplete — wait for more data
      }

      // ── 5. Extract payload and advance buffer ──────────────
      const payload = Buffer.from(this.buf.subarray(HEADER_SIZE, totalSize));
      frames.push(payload);
      this.buf = this.buf.subarray(totalSize);
    }

    return frames;
  }

  /** Discard any buffered partial data (e.g. on reconnect). */
  reset(): void {
    this.buf = Buffer.alloc(0);
  }
}
