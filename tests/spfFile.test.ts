import { describe, expect, it } from 'vitest';
import { SpfFile, SpfFormatType } from '../src/drawing/SpfFile.js';
import { Palette } from '../src/drawing/Palette.js';
import { encodeRgb565, encodeRgb555 } from '../src/utility/ColorCodec.js';
import { SpanWriter } from '../src/io/SpanWriter.js';
import { COLORS_PER_PALETTE } from '../src/constants.js';

/** Build a minimal palettized SPF buffer with one frame. */
function buildPalettizedSpf(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const writer = new SpanWriter();

  writer.writeUInt32LE(0); // unknown1
  writer.writeUInt32LE(0); // unknown2
  writer.writeInt32LE(0);  // format = Palettized

  // Primary colors (RGB565) — all transparent black
  for (let i = 0; i < COLORS_PER_PALETTE; i++) writer.writeUInt16LE(0);
  // Secondary colors (RGB555) — all transparent black
  for (let i = 0; i < COLORS_PER_PALETTE; i++) writer.writeUInt16LE(0);

  writer.writeUInt32LE(1); // frameCount

  // Frame header
  writer.writeUInt16LE(0);       // left
  writer.writeUInt16LE(0);       // top
  writer.writeUInt16LE(width);   // right
  writer.writeUInt16LE(height);  // bottom
  writer.writeUInt32LE(0);       // unknown1
  writer.writeUInt32LE(0);       // unknown2
  writer.writeUInt32LE(0);       // startAddress
  writer.writeUInt32LE(width);   // byteWidth
  writer.writeUInt32LE(width * height); // byteCount
  writer.writeUInt32LE(width * height); // imageByteCount

  // Total byte count
  writer.writeUInt32LE(width * height);

  // Pixel data
  writer.writeBytes(pixels);

  return writer.toUint8Array();
}

/** Build a minimal colorized SPF buffer with one frame. */
function buildColorizedSpf(width: number, height: number): Uint8Array {
  const writer = new SpanWriter();

  writer.writeUInt32LE(0); // unknown1
  writer.writeUInt32LE(0); // unknown2
  writer.writeInt32LE(2);  // format = Colorized

  writer.writeUInt32LE(1); // frameCount

  const pixelCount = width * height;
  const byteCount = pixelCount * 4; // 2 bytes RGB565 + 2 bytes RGB555 per pixel

  writer.writeUInt16LE(0);         // left
  writer.writeUInt16LE(0);         // top
  writer.writeUInt16LE(width);     // right
  writer.writeUInt16LE(height);    // bottom
  writer.writeUInt32LE(0);         // unknown1
  writer.writeUInt32LE(0);         // unknown2
  writer.writeUInt32LE(0);         // startAddress
  writer.writeUInt32LE(width * 2); // byteWidth
  writer.writeUInt32LE(byteCount); // byteCount
  writer.writeUInt32LE(pixelCount); // imageByteCount

  writer.writeUInt32LE(byteCount); // total byte count

  // RGB565 data (red pixel)
  for (let i = 0; i < pixelCount; i++) writer.writeUInt16LE(encodeRgb565({ r: 255, g: 0, b: 0, a: 255 }));
  // RGB555 data (same)
  for (let i = 0; i < pixelCount; i++) writer.writeUInt16LE(encodeRgb555({ r: 255, g: 0, b: 0, a: 255 }));

  return writer.toUint8Array();
}

describe('SpfFile', () => {
  describe('Palettized', () => {
    it('parses frame count and dimensions', () => {
      const pixels = new Uint8Array(4 * 4).fill(1);
      const buf = buildPalettizedSpf(4, 4, pixels);
      const spf = SpfFile.fromBuffer(buf);

      expect(spf.format).toBe(SpfFormatType.Palettized);
      expect(spf.frames.length).toBe(1);
      expect(spf.frames[0]!.right).toBe(4);
      expect(spf.frames[0]!.bottom).toBe(4);
    });

    it('stores pixel data as palette indices', () => {
      const pixels = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      const buf = buildPalettizedSpf(4, 4, pixels);
      const spf = SpfFile.fromBuffer(buf);
      const frame = spf.frames[0]!;

      expect(frame.data).toBeDefined();
      expect(Array.from(frame.data!)).toEqual(Array.from(pixels));
    });

    it('round-trips through toUint8Array', () => {
      const pixels = new Uint8Array(8 * 4).fill(42);
      const buf = buildPalettizedSpf(8, 4, pixels);
      const spf = SpfFile.fromBuffer(buf);

      const serialized = spf.toUint8Array();
      const reparsed = SpfFile.fromBuffer(serialized);

      expect(reparsed.format).toBe(SpfFormatType.Palettized);
      expect(reparsed.frames.length).toBe(1);
      expect(Array.from(reparsed.frames[0]!.data!)).toEqual(Array.from(pixels));
    });
  });

  describe('Colorized', () => {
    it('parses colorized frames', () => {
      const buf = buildColorizedSpf(2, 2);
      const spf = SpfFile.fromBuffer(buf);

      expect(spf.format).toBe(SpfFormatType.Colorized);
      expect(spf.frames.length).toBe(1);
      expect(spf.frames[0]!.colorData).toBeDefined();
      expect(spf.frames[0]!.colorData!.length).toBe(4); // 2×2 pixels
    });

    it('decoded colors approximate the original', () => {
      const buf = buildColorizedSpf(2, 2);
      const spf = SpfFile.fromBuffer(buf);
      const color = spf.frames[0]!.colorData![0]!;

      // Pure red in RGB565: some precision loss is expected
      expect(color.r).toBeGreaterThan(240);
      expect(color.g).toBeLessThan(10);
      expect(color.b).toBeLessThan(10);
    });
  });
});
