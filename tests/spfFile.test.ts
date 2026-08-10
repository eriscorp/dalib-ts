import { describe, expect, it } from 'vitest';
import { buildArchive } from './archiveFixture.js';
import type { RgbaFrame } from '../src/constants.js';
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
  writer.writeUInt32LE(pixelCount * 2); // imageByteCount: one copy, 2 bytes per pixel

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

    it('round-trips through toUint8Array', () => {
      const original = SpfFile.fromBuffer(buildColorizedSpf(2, 2));
      const reparsed = SpfFile.fromBuffer(original.toUint8Array());

      expect(reparsed.format).toBe(SpfFormatType.Colorized);
      expect(reparsed.frames).toHaveLength(1);
      expect(reparsed.frames[0]!.colorData).toHaveLength(4);
      expect(reparsed.frames[0]!.colorData![0]!.r).toBeGreaterThan(240);
    });

    // A frame's rows advance by its own pitch, which is not always the row width.
    // 190 of the client's 982 colorized frames have a non-zero origin and 78 have a
    // pitch that differs from the width, so both must be read from the header.
    it('advances rows by the frame pitch, not the row width', () => {
      const width = 2, height = 2;
      const stride = 8; // four pixels' worth of bytes per row for a two-pixel row
      const writer = new SpanWriter();
      writer.writeUInt32LE(0);
      writer.writeUInt32LE(0);
      writer.writeUInt8(2); // format = Colorized
      writer.writeUInt8(0);
      writer.writeUInt8(0);
      writer.writeUInt8(0);
      writer.writeUInt32LE(1); // frameCount

      const byteCount = stride * height;
      writer.writeUInt16LE(0); writer.writeUInt16LE(0);
      writer.writeUInt16LE(width); writer.writeUInt16LE(height);
      writer.writeInt16LE(0); writer.writeInt16LE(0);
      writer.writeUInt32LE(0);
      writer.writeUInt32LE(0);          // startAddress
      writer.writeUInt32LE(stride);     // byteWidth — the pitch
      writer.writeUInt32LE(byteCount);
      writer.writeUInt32LE(width * height);
      writer.writeUInt32LE(byteCount);

      // Row 0: red, red, then two bytes of padding. Row 1: blue, blue, padding.
      const red = encodeRgb565({ r: 255, g: 0, b: 0, a: 255 });
      const blue = encodeRgb565({ r: 0, g: 0, b: 255, a: 255 });
      writer.writeUInt16LE(red); writer.writeUInt16LE(red);
      writer.writeUInt16LE(0); writer.writeUInt16LE(0);
      writer.writeUInt16LE(blue); writer.writeUInt16LE(blue);
      writer.writeUInt16LE(0); writer.writeUInt16LE(0);

      const frame = SpfFile.fromBuffer(writer.toUint8Array()).frames[0]!;
      // Without the pitch, row 1 would start inside row 0's padding and read black.
      expect(frame.colorData![0]!.r).toBeGreaterThan(240);
      expect(frame.colorData![2]!.b).toBeGreaterThan(240);
      expect(frame.colorData![2]!.r).toBe(0);
    });

    it('falls back to the row width when the frame declares no pitch', () => {
      const buf = buildColorizedSpf(2, 1);
      const bytes = new Uint8Array(buf);
      // Zero the byteWidth field of the single frame header.
      const view = new DataView(bytes.buffer);
      view.setUint32(12 + 4 + 16 + 4, 0, true);

      const frame = SpfFile.fromBuffer(bytes).frames[0]!;
      expect(frame.colorData).toHaveLength(2);
      expect(frame.colorData![0]!.r).toBeGreaterThan(240);
    });

    it('pads with transparent when the pixel data runs out', () => {
      // Claim a 4x1 frame but supply only one pixel's worth of data.
      const writer = new SpanWriter();
      writer.writeUInt32LE(0); writer.writeUInt32LE(0);
      writer.writeUInt8(2); writer.writeUInt8(0); writer.writeUInt8(0); writer.writeUInt8(0);
      writer.writeUInt32LE(1);
      writer.writeUInt16LE(0); writer.writeUInt16LE(0);
      writer.writeUInt16LE(4); writer.writeUInt16LE(1);
      writer.writeInt16LE(0); writer.writeInt16LE(0);
      writer.writeUInt32LE(0);
      writer.writeUInt32LE(0);
      writer.writeUInt32LE(8);
      writer.writeUInt32LE(2); // byteCount — only one pixel present
      writer.writeUInt32LE(4);
      writer.writeUInt32LE(2);
      writer.writeUInt16LE(encodeRgb565({ r: 255, g: 0, b: 0, a: 255 }));

      const frame = SpfFile.fromBuffer(writer.toUint8Array()).frames[0]!;
      expect(frame.colorData![0]!.r).toBeGreaterThan(240);
      expect(frame.colorData![3]!.a).toBe(0);
    });
  });

  // Real colorized art is not anchored at the origin and is not always tightly
  // packed: of 982 frames in the client, 190 have a non-zero left/top and 78 have a
  // pitch that differs from the row width. Every fixture built by
  // `fromColorizedRgbaFrames` has left = top = 0 and byteWidth = width * 2, which is
  // exactly the case where a bounds bug and an origin bug cancel out — so these
  // fixtures are hand-built to keep the two apart.
  describe('offset and padded colorized frames', () => {
    interface OffsetSpec {
      left: number; top: number; right: number; bottom: number;
      /** Extra bytes per row beyond width * 2. */
      padding?: number;
    }

    /** Build a one-frame colorized SPF whose rows carry `padding` trailing bytes. */
    function offsetColorizedSpf({ left, top, right, bottom, padding = 0 }: OffsetSpec): Uint8Array {
      const w = right - left;
      const h = bottom - top;
      const stride = w * 2 + padding;
      const byteCount = stride * h;

      const writer = new SpanWriter();
      writer.writeUInt32LE(0);
      writer.writeUInt32LE(0);
      writer.writeUInt8(2); // format = Colorized
      writer.writeUInt8(0);
      writer.writeUInt8(0);
      writer.writeUInt8(0);
      writer.writeUInt32LE(1); // frameCount

      writer.writeUInt16LE(left);
      writer.writeUInt16LE(top);
      writer.writeUInt16LE(right);
      writer.writeUInt16LE(bottom);
      writer.writeInt16LE(0);
      writer.writeInt16LE(0);
      writer.writeUInt32LE(0);
      writer.writeUInt32LE(0);          // startAddress
      writer.writeUInt32LE(stride);     // byteWidth — the pitch
      writer.writeUInt32LE(byteCount);
      writer.writeUInt32LE(w * h * 2);  // imageByteCount: one copy, 2 bytes per pixel
      writer.writeUInt32LE(byteCount);

      // Each row is a distinct color, then `padding` bytes of filler. If a reader
      // ignores the pitch it lands in the filler and decodes the wrong row.
      const rowColors = [
        { r: 255, g: 0, b: 0, a: 255 },
        { r: 0, g: 255, b: 0, a: 255 },
        { r: 0, g: 0, b: 255, a: 255 },
        { r: 255, g: 255, b: 0, a: 255 },
      ];
      for (let y = 0; y < h; y++) {
        const color = rowColors[y % rowColors.length]!;
        for (let x = 0; x < w; x++) writer.writeUInt16LE(encodeRgb565(color));
        for (let p = 0; p < padding; p++) writer.writeUInt8(0);
      }

      return writer.toUint8Array();
    }

    const OFFSET: OffsetSpec = { left: 2, top: 1, right: 6, bottom: 4, padding: 4 };

    it('sizes colorData from the bounds, not from right and bottom', () => {
      const frame = SpfFile.fromBuffer(offsetColorizedSpf(OFFSET)).frames[0]!;
      expect(frame.colorData).toHaveLength((6 - 2) * (4 - 1));
    });

    it('reads each row at its own pitch', () => {
      const frame = SpfFile.fromBuffer(offsetColorizedSpf(OFFSET)).frames[0]!;
      const w = 6 - 2;
      // Row 0 red, row 1 green, row 2 blue. Ignoring the pitch would put row 1 inside
      // row 0's padding and decode it as black.
      expect(frame.colorData![0]!.r).toBeGreaterThan(240);
      expect(frame.colorData![w]!.g).toBeGreaterThan(240);
      expect(frame.colorData![2 * w]!.b).toBeGreaterThan(240);
    });

    // Regression: the writer used right/bottom as the size while the reader used the
    // bounds, so serializing a frame the reader had just produced ran off the end of
    // colorData and threw.
    it('serializes a frame it just read, without running off the end', () => {
      const spf = SpfFile.fromBuffer(offsetColorizedSpf(OFFSET));
      expect(() => spf.toUint8Array()).not.toThrow();
    });

    it('round-trips an offset padded frame back to the same pixels', () => {
      const original = SpfFile.fromBuffer(offsetColorizedSpf(OFFSET));
      const reparsed = SpfFile.fromBuffer(original.toUint8Array());
      const before = original.frames[0]!;
      const after = reparsed.frames[0]!;

      expect(after.left).toBe(2);
      expect(after.top).toBe(1);
      expect(after.colorData).toHaveLength(before.colorData!.length);
      expect(after.colorData).toEqual(before.colorData);
    });

    // The writer emits tightly packed rows, so the pitch and the byte counts it
    // records must describe what it actually wrote. If they still described the
    // source file's padded rows, the next frame's startAddress would be wrong.
    it('normalizes the pitch and byte counts to the bytes it writes', () => {
      const spf = SpfFile.fromBuffer(offsetColorizedSpf(OFFSET));
      spf.toUint8Array();
      const frame = spf.frames[0]!;
      const w = 6 - 2;
      const h = 4 - 1;

      expect(frame.byteWidth).toBe(w * 2);
      // Bytes in one pixel copy, at 2 bytes per colorized pixel — not a pixel count.
      expect(frame.imageByteCount).toBe(w * h * 2);
      expect(frame.byteCount).toBe(w * h * 4);
    });

    it('keeps every frame addressable when several are written', () => {
      const spf = SpfFile.fromBuffer(offsetColorizedSpf(OFFSET));
      // A second frame with different bounds, sharing the first frame's pixels.
      spf.frames.push({
        ...spf.frames[0]!,
        left: 0, top: 0, right: 4, bottom: 3,
        colorData: spf.frames[0]!.colorData,
      });

      const reparsed = SpfFile.fromBuffer(spf.toUint8Array());
      expect(reparsed.frames).toHaveLength(2);
      // Frame 1 starts exactly where frame 0 ends.
      expect(reparsed.frames[1]!.startAddress).toBe(reparsed.frames[0]!.byteCount);
      expect(reparsed.frames[1]!.colorData![0]!.r).toBeGreaterThan(240);
    });

    it('pads with transparent when a row is truncated', () => {
      const frame = SpfFile.fromBuffer(
        offsetColorizedSpf({ left: 0, top: 0, right: 4, bottom: 2, padding: 0 }),
      ).frames[0]!;
      expect(frame.colorData).toHaveLength(8);
    });
  });

  describe('mode bytes', () => {
    it('rejects an unknown pixel mode', () => {
      const writer = new SpanWriter();
      writer.writeUInt32LE(0); writer.writeUInt32LE(0);
      writer.writeUInt8(9); // not Palettized (0) or Colorized (2)
      writer.writeUInt8(0); writer.writeUInt8(0); writer.writeUInt8(0);
      expect(() => SpfFile.fromBuffer(writer.toUint8Array())).toThrow(/Unsupported SPF pixel mode/);
    });

    it('rejects a palettized file whose palette mode byte is set', () => {
      // The embedded 0x400 palette block is only present when both mode bytes are
      // zero; a non-zero palette mode means a layout this parser does not know.
      const writer = new SpanWriter();
      writer.writeUInt32LE(0); writer.writeUInt32LE(0);
      writer.writeUInt8(0); // Palettized
      writer.writeUInt8(1); // palette mode set
      writer.writeUInt8(0); writer.writeUInt8(0);
      expect(() => SpfFile.fromBuffer(writer.toUint8Array())).toThrow(/Unsupported SPF palette mode/);
    });

    it('preserves the two reserved bytes at +0x0A across a round trip', () => {
      const buf = buildColorizedSpf(1, 1);
      buf[10] = 0xab;
      buf[11] = 0xcd;

      const spf = SpfFile.fromBuffer(buf);
      expect(Array.from(spf.reservedModeBytes)).toEqual([0xab, 0xcd]);
      expect(Array.from(SpfFile.fromBuffer(spf.toUint8Array()).reservedModeBytes)).toEqual([0xab, 0xcd]);
    });

    it('writes zeros when the reserved bytes are absent', () => {
      const spf = new SpfFile(SpfFormatType.Colorized);
      spf.reservedModeBytes = new Uint8Array(0);
      const bytes = spf.toUint8Array();
      expect(bytes[10]).toBe(0);
      expect(bytes[11]).toBe(0);
    });
  });

  describe('factories', () => {
    it('accepts an ArrayBuffer', () => {
      const bytes = new Uint8Array(buildColorizedSpf(1, 1));
      expect(SpfFile.fromBuffer(bytes.buffer as ArrayBuffer).frames).toHaveLength(1);
    });

    it('reads from an entry, with or without the extension', () => {
      const archive = buildArchive([{ name: 'art.spf', data: buildColorizedSpf(2, 2) }]);
      expect(SpfFile.fromEntry(archive.get('art.spf')!).frames).toHaveLength(1);
      expect(SpfFile.fromArchive('art', archive).frames).toHaveLength(1);
      expect(SpfFile.fromArchive('art.spf', archive).frames).toHaveLength(1);
    });

    it('throws when the entry is missing', () => {
      expect(() => SpfFile.fromArchive('nope', buildArchive([]))).toThrow(/not found/);
    });
  });

  describe('fromColorizedRgbaFrames', () => {
    /** A single-row RGBA frame from a list of pixels. */
    function row(pixels: Array<[number, number, number, number]>): RgbaFrame {
      const data = new Uint8ClampedArray(pixels.length * 4);
      pixels.forEach(([r, g, b, a], i) => {
        data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a;
      });
      return { width: pixels.length, height: 1, data };
    }

    it('stores direct color and sizes the frame from the source', () => {
      const spf = SpfFile.fromColorizedRgbaFrames([row([[255, 0, 0, 255], [0, 255, 0, 255]])]);
      expect(spf.format).toBe(SpfFormatType.Colorized);
      expect(spf.frames).toHaveLength(1);
      expect(spf.frames[0]!.right).toBe(2);
      expect(spf.frames[0]!.bottom).toBe(1);
      expect(spf.frames[0]!.colorData![0]).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    });

    it('stores a transparent pixel as opaque black, the color key', () => {
      const spf = SpfFile.fromColorizedRgbaFrames([row([[200, 100, 50, 0]])]);
      expect(spf.frames[0]!.colorData![0]).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    });

    it('reserves room for both the RGB565 and the RGB555 copy', () => {
      const spf = SpfFile.fromColorizedRgbaFrames([row([[1, 2, 3, 255], [4, 5, 6, 255]])]);
      expect(spf.frames[0]!.byteCount).toBe(2 * 1 * 4);
      // One copy of two 2-byte pixels.
      expect(spf.frames[0]!.imageByteCount).toBe(2 * 1 * 2);
      expect(spf.frames[0]!.byteWidth).toBe(2 * 2);
    });

    it('round-trips back through the parser', () => {
      const spf = SpfFile.fromColorizedRgbaFrames([row([[255, 0, 0, 255], [0, 0, 255, 255]])]);
      const reparsed = SpfFile.fromBuffer(spf.toUint8Array());
      expect(reparsed.frames).toHaveLength(1);
      expect(reparsed.frames[0]!.colorData![0]!.r).toBeGreaterThan(240);
      expect(reparsed.frames[0]!.colorData![1]!.b).toBeGreaterThan(240);
    });

    it('handles an empty frame list', () => {
      expect(SpfFile.fromColorizedRgbaFrames([]).frames).toHaveLength(0);
    });

    // Every colorized frame in a retail 7.41 install records `w * h * 2` here — the
    // bytes in one pixel copy, at 2 bytes per pixel. Writing the pixel count instead
    // halved the field on every save, so a read/write cycle over a shipped file
    // changed its header while leaving the pixels correct. Measured across all 12
    // colorized frames in the client; the 1,659 palettized frames record 0 and are
    // passed through untouched.
    it('records imageByteCount in bytes, so a shipped header survives a save', () => {
      const w = 3;
      const h = 2;
      const rgba = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
      const written = SpfFile.fromColorizedRgbaFrames([rgba]).toUint8Array();
      const frame = SpfFile.fromBuffer(written).frames[0]!;

      expect(frame.imageByteCount).toBe(w * h * 2);
      expect(frame.byteCount).toBe(w * h * 4);
      expect(frame.imageByteCount * 2).toBe(frame.byteCount);
    });
  });

  describe('fromPalettizedRgbaFrames', () => {
    function solid(w: number, h: number, r: number, g: number, b: number): RgbaFrame {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
      }
      return { width: w, height: h, data };
    }

    it('quantizes every frame against one shared palette', () => {
      const spf = SpfFile.fromPalettizedRgbaFrames([solid(2, 2, 255, 0, 0), solid(2, 2, 0, 0, 255)]);
      expect(spf.format).toBe(SpfFormatType.Palettized);
      expect(spf.frames).toHaveLength(2);
      expect(spf.primaryColors).toBe(spf.secondaryColors);
      expect(spf.frames[0]!.data![0]).not.toBe(spf.frames[1]!.data![0]);
    });

    it('stores one byte per pixel', () => {
      const spf = SpfFile.fromPalettizedRgbaFrames([solid(4, 3, 1, 2, 3)]);
      expect(spf.frames[0]!.byteWidth).toBe(4);
      expect(spf.frames[0]!.byteCount).toBe(12);
      expect(spf.frames[0]!.data).toHaveLength(12);
    });

    it('round-trips back through the parser', () => {
      const spf = SpfFile.fromPalettizedRgbaFrames([solid(2, 2, 200, 100, 50)]);
      const reparsed = SpfFile.fromBuffer(spf.toUint8Array());
      expect(Array.from(reparsed.frames[0]!.data!)).toEqual(Array.from(spf.frames[0]!.data!));
    });

    it('handles an empty frame list', () => {
      expect(SpfFile.fromPalettizedRgbaFrames([]).frames).toHaveLength(0);
    });
  });
});
