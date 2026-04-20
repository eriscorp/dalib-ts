import { describe, expect, it } from 'vitest';
import { SpfFile, SpfFormatType } from '../src/drawing/SpfFile.js';
import { Palette } from '../src/drawing/Palette.js';
import { encodeRgb565, encodeRgb555 } from '../src/utility/ColorCodec.js';
import { SpanWriter } from '../src/io/SpanWriter.js';
import { COLORS_PER_PALETTE } from '../src/constants.js';

interface PalettizedFrameHeaderOpts {
  centerX?: number;
  centerY?: number;
  flags?: number;
}

/** Build a minimal palettized SPF buffer with one frame. */
function buildPalettizedSpf(
  width: number,
  height: number,
  pixels: Uint8Array,
  opts: PalettizedFrameHeaderOpts = {},
): Uint8Array {
  const { centerX = 0, centerY = 0, flags = 0 } = opts;
  const writer = new SpanWriter();

  writer.writeUInt32LE(0); // unknown1
  writer.writeUInt32LE(0); // unknown2
  writer.writeInt32LE(0);  // format = Palettized

  // Primary colors (RGB565) — all transparent black
  for (let i = 0; i < COLORS_PER_PALETTE; i++) writer.writeUInt16LE(0);
  // Secondary colors (RGB555) — all transparent black
  for (let i = 0; i < COLORS_PER_PALETTE; i++) writer.writeUInt16LE(0);

  writer.writeUInt32LE(1); // frameCount

  // Frame header: left, top, right, bottom, centerX(i16), centerY(i16), flags(u32), startAddress, byteWidth, byteCount, imageByteCount
  writer.writeUInt16LE(0);
  writer.writeUInt16LE(0);
  writer.writeUInt16LE(width);
  writer.writeUInt16LE(height);
  writer.writeInt16LE(centerX);
  writer.writeInt16LE(centerY);
  writer.writeUInt32LE(flags);
  writer.writeUInt32LE(0);       // startAddress
  writer.writeUInt32LE(width);   // byteWidth
  writer.writeUInt32LE(width * height); // byteCount
  writer.writeUInt32LE(width * height); // imageByteCount

  writer.writeUInt32LE(width * height); // total byte count
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
  writer.writeInt16LE(0);          // centerX
  writer.writeInt16LE(0);          // centerY
  writer.writeUInt32LE(0);         // flags
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

    describe('center point', () => {
      it('defaults to hasCenterPoint=false when flags bit 0 is clear', () => {
        const pixels = new Uint8Array(4 * 4);
        const buf = buildPalettizedSpf(4, 4, pixels, { centerX: 12, centerY: -7, flags: 0 });
        const frame = SpfFile.fromBuffer(buf).frames[0]!;

        expect(frame.centerX).toBe(12);
        expect(frame.centerY).toBe(-7);
        expect(frame.flags).toBe(0);
        expect(frame.hasCenterPoint).toBe(false);
      });

      it('derives hasCenterPoint from flags bit 0', () => {
        const pixels = new Uint8Array(4 * 4);
        const buf = buildPalettizedSpf(4, 4, pixels, { centerX: 1, centerY: 2, flags: 0b101 });
        const frame = SpfFile.fromBuffer(buf).frames[0]!;

        expect(frame.hasCenterPoint).toBe(true);
        expect(frame.flags).toBe(0b101);
      });

      it('preserves non-hasCenterPoint flag bits across round-trip', () => {
        const pixels = new Uint8Array(4 * 4);
        const buf = buildPalettizedSpf(4, 4, pixels, { flags: 0b10100 });
        const reparsed = SpfFile.fromBuffer(SpfFile.fromBuffer(buf).toUint8Array());
        const frame = reparsed.frames[0]!;

        expect(frame.flags).toBe(0b10100);
        expect(frame.hasCenterPoint).toBe(false);
      });

      it('round-trips centerX/centerY with hasCenterPoint=true', () => {
        const pixels = new Uint8Array(4 * 4);
        const buf = buildPalettizedSpf(4, 4, pixels, { centerX: -1000, centerY: 2000, flags: 1 });
        const original = SpfFile.fromBuffer(buf);

        const reparsed = SpfFile.fromBuffer(original.toUint8Array());
        const frame = reparsed.frames[0]!;

        expect(frame.centerX).toBe(-1000);
        expect(frame.centerY).toBe(2000);
        expect(frame.hasCenterPoint).toBe(true);
      });

      it('toggling hasCenterPoint rewrites flags bit 0', () => {
        const pixels = new Uint8Array(4 * 4);
        const buf = buildPalettizedSpf(4, 4, pixels, { flags: 0b1110 });
        const spf = SpfFile.fromBuffer(buf);
        const frame = spf.frames[0]!;
        expect(frame.hasCenterPoint).toBe(false);

        frame.hasCenterPoint = true;
        const reparsed = SpfFile.fromBuffer(spf.toUint8Array());
        expect(reparsed.frames[0]!.flags & 1).toBe(1);
        expect(reparsed.frames[0]!.flags >>> 1).toBe(0b111);
      });
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
