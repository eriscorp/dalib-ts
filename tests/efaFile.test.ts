import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildArchive } from './archiveFixture.js';
import { EfaFile } from '../src/drawing/EfaFile.js';
import { EfaBlendingType } from '../src/enums.js';
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

  it('records the blending type and the frame interval', () => {
    const source = EfaFile.fromRgbaFrames([solid(2, 2, 1, 1, 1)], EfaBlendingType.PerChannelAlpha, 80);
    const parsed = EfaFile.fromBuffer(source.toUint8Array(deflate), inflate);
    expect(parsed.blendingType).toBe(EfaBlendingType.PerChannelAlpha);
    expect(parsed.frameIntervalMs).toBe(80);
  });

  it('defaults to an additive blend at 50 ms', () => {
    const efa = EfaFile.fromRgbaFrames([solid(1, 1, 1, 1, 1)]);
    expect(efa.blendingType).toBe(EfaBlendingType.Additive);
    expect(efa.frameIntervalMs).toBe(50);
  });

  it('writes transparent pixels as the zero word', () => {
    const data = new Uint8ClampedArray([255, 255, 255, 0]); // fully transparent white
    const source = EfaFile.fromRgbaFrames([{ width: 1, height: 1, data }]);
    const parsed = EfaFile.fromBuffer(source.toUint8Array(deflate), inflate);
    expect(Array.from(parsed.frames[0]!.data)).toEqual([0, 0]);
  });

  it('sizes every frame against the largest frame in the set', () => {
    // imagePixelWidth/Height describe the animation canvas, not the frame.
    const source = EfaFile.fromRgbaFrames([solid(2, 2, 1, 1, 1), solid(6, 4, 1, 1, 1)]);
    const parsed = EfaFile.fromBuffer(source.toUint8Array(deflate), inflate);
    expect(parsed.frames[0]!.imagePixelWidth).toBe(6);
    expect(parsed.frames[0]!.imagePixelHeight).toBe(4);
    expect(parsed.frames[0]!.framePixelWidth).toBe(2);
  });

  it('carries a separate alpha plane through the round trip', () => {
    // The writer concatenates data and alphaData; the reader splits them back
    // apart at byteCount, so decompressedSize is what tells the two apart.
    const source = EfaFile.fromRgbaFrames([solid(2, 2, 4, 5, 6)]);
    const alpha = new Uint8Array([1, 2, 3, 4]);
    source.frames[0]!.alphaData = alpha;
    source.frames[0]!.decompressedSize = source.frames[0]!.byteCount + alpha.length;

    const parsed = EfaFile.fromBuffer(source.toUint8Array(deflate), inflate);
    expect(parsed.frames[0]!.data).toHaveLength(2 * 2 * 2);
    expect(Array.from(parsed.frames[0]!.alphaData!)).toEqual([1, 2, 3, 4]);
  });

  it('uses the Node deflate and inflate when none are supplied', () => {
    const parsed = EfaFile.fromBuffer(EfaFile.fromRgbaFrames([solid(2, 2, 9, 9, 9)]).toUint8Array());
    expect(parsed.frames[0]!.data).toHaveLength(2 * 2 * 2);
  });

  it('parses asynchronously to the same result as the sync path', async () => {
    const bytes = EfaFile.fromRgbaFrames([solid(4, 3, 255, 0, 0), solid(2, 2, 0, 255, 0)])
      .toUint8Array(deflate);

    const sync = EfaFile.fromBuffer(bytes, inflate);
    const async = await EfaFile.fromBufferAsync(bytes);

    expect(async.frames).toHaveLength(2);
    expect(async.frames[0]!.framePixelWidth).toBe(sync.frames[0]!.framePixelWidth);
    expect(Array.from(async.frames[0]!.data)).toEqual(Array.from(sync.frames[0]!.data));
    expect(Array.from(async.frames[1]!.data)).toEqual(Array.from(sync.frames[1]!.data));
  });

  it('splits the alpha plane on the async path too', async () => {
    const source = EfaFile.fromRgbaFrames([solid(2, 1, 1, 1, 1)]);
    source.frames[0]!.alphaData = new Uint8Array([7, 7]);
    source.frames[0]!.decompressedSize = source.frames[0]!.byteCount + 2;

    const parsed = await EfaFile.fromBufferAsync(source.toUint8Array(deflate));
    expect(Array.from(parsed.frames[0]!.alphaData!)).toEqual([7, 7]);
  });

  it('accepts an ArrayBuffer on both the sync and the async path', async () => {
    const bytes = new Uint8Array(EfaFile.fromRgbaFrames([solid(2, 2, 1, 1, 1)]).toUint8Array(deflate));
    expect(EfaFile.fromBuffer(bytes.buffer as ArrayBuffer, inflate).frames).toHaveLength(1);
    expect((await EfaFile.fromBufferAsync(bytes.buffer as ArrayBuffer)).frames).toHaveLength(1);
  });

  it('reads from an archive entry, with or without the extension', () => {
    const bytes = EfaFile.fromRgbaFrames([solid(2, 2, 1, 1, 1)]).toUint8Array(deflate);
    const archive = buildArchive([{ name: 'spell.efa', data: bytes }]);

    expect(EfaFile.fromEntry(archive.get('spell.efa')!, inflate).frames).toHaveLength(1);
    expect(EfaFile.fromArchive('spell', archive, inflate).frames).toHaveLength(1);
    expect(EfaFile.fromArchive('spell.efa', archive, inflate).frames).toHaveLength(1);
  });

  it('throws when the entry is missing', () => {
    expect(() => EfaFile.fromArchive('nope', buildArchive([]), inflate)).toThrow(/not found/);
  });
});
