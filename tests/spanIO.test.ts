import { describe, expect, it } from 'vitest';
import { SpanReader } from '../src/io/SpanReader.js';
import { SpanWriter } from '../src/io/SpanWriter.js';

describe('SpanWriter → SpanReader round trip', () => {
  it('round-trips every little-endian width', () => {
    const w = new SpanWriter();
    w.writeUInt8(0xff);
    w.writeInt8(-128);
    w.writeUInt16LE(0xbeef);
    w.writeInt16LE(-32768);
    w.writeUInt32LE(0xdeadbeef);
    w.writeInt32LE(-2147483648);

    const r = new SpanReader(w.toUint8Array());
    expect(r.readUInt8()).toBe(0xff);
    expect(r.readInt8()).toBe(-128);
    expect(r.readUInt16LE()).toBe(0xbeef);
    expect(r.readInt16LE()).toBe(-32768);
    expect(r.readUInt32LE()).toBe(0xdeadbeef);
    expect(r.readInt32LE()).toBe(-2147483648);
    expect(r.remaining).toBe(0);
  });

  it('round-trips big-endian widths', () => {
    const w = new SpanWriter();
    w.writeUInt16BE(0x1234);
    w.writeUInt32BE(0x89abcdef);

    const bytes = w.toUint8Array();
    // Big-endian means the most significant byte comes first on the wire.
    expect(bytes[0]).toBe(0x12);
    expect(bytes[1]).toBe(0x34);

    const r = new SpanReader(bytes);
    expect(r.readUInt16BE()).toBe(0x1234);
    expect(r.readUInt32BE()).toBe(0x89abcdef);
  });

  it('reads big-endian signed values', () => {
    const w = new SpanWriter();
    w.writeUInt16BE(0xffff);
    w.writeUInt32BE(0xffffffff);

    const r = new SpanReader(w.toUint8Array());
    expect(r.readInt16BE()).toBe(-1);
    expect(r.readInt32BE()).toBe(-1);
  });

  it('round-trips a fixed-length ASCII field, zero padded and truncated', () => {
    const w = new SpanWriter();
    w.writeFixedAscii('abc', 6);
    w.writeFixedAscii('toolongvalue', 4);

    const bytes = w.toUint8Array();
    expect(bytes.length).toBe(10);
    // Unused bytes are zero filled.
    expect(Array.from(bytes.subarray(3, 6))).toEqual([0, 0, 0]);

    const r = new SpanReader(bytes);
    expect(r.readFixedAscii(6)).toBe('abc');
    expect(r.readFixedAscii(4)).toBe('tool');
  });

  it('reads the full field when no null terminator is present', () => {
    const r = new SpanReader(new Uint8Array([0x41, 0x42, 0x43]));
    expect(r.readFixedAscii(3)).toBe('ABC');
  });

  it('writes raw bytes verbatim', () => {
    const w = new SpanWriter();
    w.writeBytes(new Uint8Array([1, 2, 3]));
    expect(Array.from(w.toUint8Array())).toEqual([1, 2, 3]);
  });

  it('grows past its initial capacity', () => {
    const w = new SpanWriter(2);
    for (let i = 0; i < 100; i++) w.writeUInt32LE(i);
    expect(w.position).toBe(400);

    const r = new SpanReader(w.toUint8Array());
    for (let i = 0; i < 100; i++) expect(r.readUInt32LE()).toBe(i);
  });

  it('exposes the written length as an ArrayBuffer copy', () => {
    const w = new SpanWriter();
    w.writeUInt16LE(0x0102);
    const buf = w.toArrayBuffer();
    expect(buf.byteLength).toBe(2);
    expect(Array.from(new Uint8Array(buf))).toEqual([0x02, 0x01]);
  });
});

describe('SpanReader cursor', () => {
  const bytes = new Uint8Array([10, 20, 30, 40, 50]);

  it('reports length, position and remaining', () => {
    const r = new SpanReader(bytes);
    expect(r.length).toBe(5);
    expect(r.position).toBe(0);
    expect(r.remaining).toBe(5);
    r.readUInt8();
    expect(r.position).toBe(1);
    expect(r.remaining).toBe(4);
  });

  it('seeks and skips', () => {
    const r = new SpanReader(bytes);
    r.skip(2);
    expect(r.readUInt8()).toBe(30);
    r.seek(0);
    expect(r.readUInt8()).toBe(10);
  });

  it('rejects an out-of-bounds seek', () => {
    const r = new SpanReader(bytes);
    expect(() => r.seek(-1)).toThrow(RangeError);
    expect(() => r.seek(6)).toThrow(RangeError);
    // Seeking exactly to the end is valid — it just leaves nothing to read.
    expect(() => r.seek(5)).not.toThrow();
  });

  it('peeks without advancing', () => {
    const r = new SpanReader(bytes);
    expect(r.peekUInt8()).toBe(10);
    expect(r.position).toBe(0);
    expect(r.readUInt8()).toBe(10);
  });

  it('starts at the supplied byte offset', () => {
    const r = new SpanReader(bytes, 3);
    expect(r.position).toBe(3);
    expect(r.readUInt8()).toBe(40);
  });

  it('accepts an ArrayBuffer as well as a Uint8Array', () => {
    const r = new SpanReader(bytes.buffer as ArrayBuffer);
    expect(r.readUInt8()).toBe(10);
  });

  it('readBytes returns a view of the requested length and advances', () => {
    const r = new SpanReader(bytes);
    const slice = r.readBytes(2);
    expect(Array.from(slice)).toEqual([10, 20]);
    expect(r.position).toBe(2);
  });
});
