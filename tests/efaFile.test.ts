import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { EfaFile } from '../src/drawing/EfaFile.js';
import type { RgbaFrame } from '../src/constants.js';

const deflate = (d: Uint8Array) => new Uint8Array(deflateSync(Buffer.from(d)));
const inflate = (d: Uint8Array) => new Uint8Array(inflateSync(Buffer.from(d)));

/** A solid RGBA frame. */
function solid(width: number, height: number, r: number, g: number, b: number): RgbaFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

describe('EfaFile', () => {
  it('builds frames from RGBA input', () => {
    const efa = EfaFile.fromRgbaFrames([solid(4, 3, 255, 0, 0), solid(4, 3, 0, 0, 255)]);
    expect(efa.frames).toHaveLength(2);
    expect(efa.frames[0]!.framePixelWidth).toBe(4);
    expect(efa.frames[0]!.framePixelHeight).toBe(3);
  });

  it('round-trips through the writer and parser', () => {
    const source = EfaFile.fromRgbaFrames([solid(4, 3, 255, 0, 0), solid(2, 2, 0, 255, 0)]);
    const bytes = source.toUint8Array(deflate);
    const parsed = EfaFile.fromBuffer(bytes, inflate);

    expect(parsed.frames).toHaveLength(2);
    expect(parsed.frames[0]!.framePixelWidth).toBe(4);
    expect(parsed.frames[0]!.framePixelHeight).toBe(3);
    expect(parsed.frames[1]!.framePixelWidth).toBe(2);

    // The decompressed payload is RGB565: two bytes per pixel.
    expect(parsed.frames[0]!.data.length).toBe(parsed.frames[0]!.byteCount);
    expect(parsed.frames[0]!.byteWidth).toBe(4 * 2);
  });

  it('preserves pixel content across the round trip', () => {
    const source = EfaFile.fromRgbaFrames([solid(2, 1, 255, 0, 0)]);
    const parsed = EfaFile.fromBuffer(source.toUint8Array(deflate), inflate);

    const view = new DataView(
      parsed.frames[0]!.data.buffer,
      parsed.frames[0]!.data.byteOffset,
      parsed.frames[0]!.data.byteLength,
    );
    // Red in RGB565 sets the top five bits.
    const pixel = view.getUint16(0, true);
    expect((pixel >> 11) & 0x1f).toBeGreaterThan(28);
    expect(pixel & 0x1f).toBe(0);
  });

  it('writes a frame table sized to the frame count', () => {
    const bytes = EfaFile.fromRgbaFrames([solid(2, 2, 1, 2, 3)]).toUint8Array(deflate);
    // 0x40 header plus one 0x40 frame record, then the payload.
    expect(bytes.length).toBeGreaterThan(0x40 + 0x40);
    const frameCount = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true);
    expect(frameCount).toBe(1);
  });

  it('handles an empty frame list', () => {
    const efa = EfaFile.fromRgbaFrames([]);
    expect(efa.frames).toHaveLength(0);
    const parsed = EfaFile.fromBuffer(efa.toUint8Array(deflate), inflate);
    expect(parsed.frames).toHaveLength(0);
  });

  it('round-trips a frame whose dimensions are odd', () => {
    const source = EfaFile.fromRgbaFrames([solid(3, 5, 10, 20, 30)]);
    const parsed = EfaFile.fromBuffer(source.toUint8Array(deflate), inflate);
    expect(parsed.frames[0]!.framePixelWidth).toBe(3);
    expect(parsed.frames[0]!.framePixelHeight).toBe(5);
  });
});
