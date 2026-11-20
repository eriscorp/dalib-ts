import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { crc32 } from '../src/cryptography/CRC32.js';
import { encodePng } from '../src/io/PngWriter.js';

/** The chunks of a PNG, each checked against its CRC. */
function chunks(png: Uint8Array): { type: string; data: Uint8Array }[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: { type: string; data: Uint8Array }[] = [];
  let at = 8;
  while (at < png.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + len);
    expect(view.getUint32(at + 8 + len), `${type} CRC`).toBe(crc32(png, at + 4, 4 + len));
    out.push({ type, data });
    at += 12 + len;
  }
  return out;
}

describe('encodePng', () => {
  it('writes the signature, IHDR, one IDAT and IEND', () => {
    const png = encodePng({ width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255]) });
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const c = chunks(png);
    expect(c.map((x) => x.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    // 1x1, bit depth 8, colour type 6 (RGBA), compression 0, filter 0, interlace 0
    expect([...c[0]!.data]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
    expect([...inflateSync(c[1]!.data)]).toEqual([0, 255, 0, 0, 255]);
    expect(c[2]!.data.length).toBe(0);
  });

  it('puts a filter byte of 0 before each row, and keeps straight alpha', () => {
    const data = new Uint8ClampedArray(3 * 2 * 4);
    for (let i = 0; i < data.length; i++) data[i] = i;
    const c = chunks(encodePng({ width: 3, height: 2, data }));
    const raw = inflateSync(c[1]!.data);
    expect(raw.length).toBe((3 * 4 + 1) * 2);
    expect(raw[0]).toBe(0);
    expect(raw[13]).toBe(0);
    expect([...raw.subarray(1, 13)]).toEqual([...data.subarray(0, 12)]);
    expect([...raw.subarray(14)]).toEqual([...data.subarray(12)]);
  });

  it('refuses a frame with no pixels, and one whose data is the wrong length', () => {
    expect(() => encodePng({ width: 0, height: 1, data: new Uint8ClampedArray(0) })).toThrow(
      'encodePng: the frame must be at least 1x1, not 0x1',
    );
    expect(() => encodePng({ width: 1.5, height: 1, data: new Uint8ClampedArray(4) })).toThrow('at least 1x1');
    expect(() => encodePng({ width: 2, height: 2, data: new Uint8ClampedArray(4) })).toThrow(
      'encodePng: 4 bytes is not 2x2 RGBA',
    );
  });
});
