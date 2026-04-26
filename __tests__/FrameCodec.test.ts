import { encode, FrameDecoder } from '../src/services/FrameCodec';

describe('FrameCodec', () => {
  test('encodes a 10-byte payload with STX and correct length header', () => {
    const payload = Buffer.from('0123456789');
    const frame = encode(payload);

    expect(frame[0]).toBe(0x02);
    expect(frame.readUInt16BE(1)).toBe(10);
    expect(frame.subarray(3)).toEqual(payload);
    expect(frame.length).toBe(13);
  });

  test('decodes a complete frame in one chunk', () => {
    const decoder = new FrameDecoder();
    const payload = Buffer.from([0x10, 0x20, 0x30, 0x40]);

    const frames = decoder.feed(encode(payload));

    expect(frames).toEqual([payload]);
  });

  test('decodes a frame split across two chunks with the split in the header', () => {
    const decoder = new FrameDecoder();
    const payload = Buffer.from([0xaa, 0xbb, 0xcc]);
    const frame = encode(payload);

    expect(decoder.feed(frame.subarray(0, 2))).toEqual([]);
    expect(decoder.feed(frame.subarray(2))).toEqual([payload]);
  });

  test('decodes a frame split across two chunks with the split in the payload', () => {
    const decoder = new FrameDecoder();
    const payload = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const frame = encode(payload);

    expect(decoder.feed(frame.subarray(0, 5))).toEqual([]);
    expect(decoder.feed(frame.subarray(5))).toEqual([payload]);
  });

  test('decodes three concatenated frames from one chunk', () => {
    const decoder = new FrameDecoder();
    const payloads = [
      Buffer.from([0x01]),
      Buffer.from([0x02, 0x03]),
      Buffer.from([0x04, 0x05, 0x06]),
    ];

    const frames = decoder.feed(Buffer.concat(payloads.map((payload) => encode(payload))));

    expect(frames).toEqual(payloads);
  });

  test('ignores garbage bytes before the STX marker', () => {
    const decoder = new FrameDecoder();
    const payload = Buffer.from([0x11, 0x22]);
    const chunk = Buffer.concat([
      Buffer.from([0xff, 0x00, 0x7f]),
      encode(payload),
    ]);

    const frames = decoder.feed(chunk);

    expect(frames).toEqual([payload]);
  });

  test('handles an empty payload frame', () => {
    const decoder = new FrameDecoder();
    const payload = Buffer.alloc(0);

    const frame = encode(payload);
    const frames = decoder.feed(frame);

    expect(frame[0]).toBe(0x02);
    expect(frame.readUInt16BE(1)).toBe(0);
    expect(frame.length).toBe(3);
    expect(frames).toEqual([payload]);
  });

  test('handles a maximum size payload of 65535 bytes', () => {
    const decoder = new FrameDecoder();
    const payload = Buffer.alloc(65535, 0x5a);

    const frame = encode(payload);
    const frames = decoder.feed(frame);

    expect(frame[0]).toBe(0x02);
    expect(frame.readUInt16BE(1)).toBe(65535);
    expect(frame.length).toBe(65538);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(payload);
  });
});
