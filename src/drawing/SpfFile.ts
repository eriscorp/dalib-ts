import type { Color, RgbaFrame } from '../constants.js';
import { COLORS_PER_PALETTE, TRANSPARENT } from '../constants.js';
import type { DataArchiveEntry } from '../data/DataArchiveEntry.js';
import { SpanReader } from '../io/SpanReader.js';
import { SpanWriter } from '../io/SpanWriter.js';
import { decodeRgb555, decodeRgb565, encodeRgb555, encodeRgb565 } from '../utility/ColorCodec.js';
import { preserveNonTransparentBlacks, quantizeFrames } from '../utility/ImageProcessor.js';
import { Palette } from './Palette.js';
import type { SpfFrame } from './SpfFrame.js';
import { spfFrameHeight, spfFrameWidth } from './SpfFrame.js';

export const enum SpfFormatType {
  Palettized = 0,
  Colorized = 2,
}

/**
 * Sentinel center-point value matching upstream's `FromImages()` initialization (0xCCCC as int16 → -13108).
 * Used by factory methods to signal "no center point" in a way that survives write → read cycles.
 */
const CENTER_POINT_SENTINEL = -13108;

/**
 * Compose the on-disk flag word from {@link SpfFrame.flags} and {@link SpfFrame.hasCenterPoint}.
 * Bit 0 tracks `hasCenterPoint`; other bits are preserved from `flags` verbatim.
 */
function encodeFlags(frame: SpfFrame): number {
  const base = frame.flags >>> 0;
  return (frame.hasCenterPoint ? (base | 1) : (base & ~1)) >>> 0;
}

/**
 * A multi-frame sprite file (.spf).
 * Supports two modes:
 * - **Palettized**: 1 byte per pixel (palette index), two 256-color palettes (RGB565 + RGB555).
 * - **Colorized**: 2 bytes per pixel (direct RGB565 color), stored twice per frame (565 + 555 copy).
 */
export class SpfFile {
  frames: SpfFrame[] = [];
  /** Pixel mode byte at +0x08. Selects the palettized or colorized pixel path. */
  format: SpfFormatType;
  /**
   * Palette mode byte at +0x09. The embedded 0x400-byte palette block is only present
   * when this and {@link format} are both zero. Every known file has this set to 0.
   */
  paletteMode: number = 0;
  /** The two unidentified bytes at +0x0A, preserved verbatim for round-tripping. */
  reservedModeBytes: Uint8Array = new Uint8Array(2);
  primaryColors?: Palette;
  secondaryColors?: Palette;
  unknown1: number = 0;
  unknown2: number = 0;

  constructor(format: SpfFormatType = SpfFormatType.Colorized) {
    this.format = format;
  }

  // ---------------------------------------------------------------------------
  // Parsing
  // ---------------------------------------------------------------------------

  private static parse(bytes: Uint8Array): SpfFile {
    const reader = new SpanReader(bytes);
    const spf = new SpfFile();
    spf.primaryColors = new Palette();
    spf.secondaryColors = new Palette();

    spf.unknown1 = reader.readUInt32LE();
    spf.unknown2 = reader.readUInt32LE();
    // +0x08 and +0x09 are two separate mode bytes, not one uint32.
    spf.format = reader.readUInt8() as SpfFormatType;
    spf.paletteMode = reader.readUInt8();
    spf.reservedModeBytes = new Uint8Array(reader.readBytes(2));

    switch (spf.format) {
      case SpfFormatType.Colorized:
        SpfFile.readColorized(reader, spf);
        break;
      case SpfFormatType.Palettized:
        SpfFile.readPalettized(reader, spf);
        break;
      default:
        throw new Error(`Unsupported SPF pixel mode: ${spf.format}`);
    }

    return spf;
  }

  private static readPalettized(reader: SpanReader, spf: SpfFile): void {
    // The embedded palette block is only present when both mode bytes are zero.
    if (spf.paletteMode !== 0) {
      throw new Error(`Unsupported SPF palette mode: ${spf.paletteMode}`);
    }

    for (let i = 0; i < COLORS_PER_PALETTE; i++) {
      spf.primaryColors!.set(i, decodeRgb565(reader.readUInt16LE()));
    }
    for (let i = 0; i < COLORS_PER_PALETTE; i++) {
      spf.secondaryColors!.set(i, decodeRgb555(reader.readUInt16LE()));
    }

    const frameCount = reader.readUInt32LE();

    for (let i = 0; i < frameCount; i++) {
      const frame: SpfFrame = {
        left: reader.readUInt16LE(),
        top: reader.readUInt16LE(),
        right: reader.readUInt16LE(),
        bottom: reader.readUInt16LE(),
        centerX: reader.readInt16LE(),
        centerY: reader.readInt16LE(),
        flags: reader.readUInt32LE(),
        hasCenterPoint: false,
        startAddress: 0,
        byteWidth: 0,
        byteCount: 0,
        imageByteCount: 0,
      };
      frame.hasCenterPoint = (frame.flags & 1) !== 0;
      frame.startAddress = reader.readUInt32LE();
      frame.byteWidth = reader.readUInt32LE();
      frame.byteCount = reader.readUInt32LE();
      frame.imageByteCount = reader.readUInt32LE();
      frame.data = new Uint8Array(frame.byteCount);
      spf.frames.push(frame);
    }

    const totalByteCount = reader.readUInt32LE();
    const dataStart = reader.position;

    for (const frame of spf.frames) {
      const offset = dataStart + frame.startAddress;
      const src = new SpanReader(bytes_from_reader(reader, offset, frame.byteCount));
      for (let j = 0; j < frame.byteCount; j++) {
        frame.data![j] = src.readUInt8();
      }
    }
  }

  private static readColorized(reader: SpanReader, spf: SpfFile): void {
    const frameCount = reader.readUInt32LE();

    for (let i = 0; i < frameCount; i++) {
      const frame: SpfFrame = {
        left: reader.readUInt16LE(),
        top: reader.readUInt16LE(),
        right: reader.readUInt16LE(),
        bottom: reader.readUInt16LE(),
        centerX: reader.readInt16LE(),
        centerY: reader.readInt16LE(),
        flags: reader.readUInt32LE(),
        hasCenterPoint: false,
        startAddress: 0,
        byteWidth: 0,
        byteCount: 0,
        imageByteCount: 0,
      };
      frame.hasCenterPoint = (frame.flags & 1) !== 0;
      frame.startAddress = reader.readUInt32LE();
      frame.byteWidth = reader.readUInt32LE();
      frame.byteCount = reader.readUInt32LE();
      frame.imageByteCount = reader.readUInt32LE();
      frame.colorData = new Array<Color>(frame.imageByteCount);
      spf.frames.push(frame);
    }

    const totalByteCount = reader.readUInt32LE();
    const dataStart = reader.position;

    for (const frame of spf.frames) {
      const pixels = bytes_from_reader(reader, dataStart + frame.startAddress, frame.byteCount);
      // Bounds define the visible rectangle; rows advance by the frame's own pitch, which
      // is not always equal to the row's byte width.
      const w = spfFrameWidth(frame);
      const h = spfFrameHeight(frame);
      const stride = frame.byteWidth > 0 ? frame.byteWidth : w * 2;

      frame.colorData = new Array<Color>(w * h);

      for (let y = 0; y < h; y++) {
        const rowOffset = y * stride;
        for (let x = 0; x < w; x++) {
          const at = rowOffset + x * 2;
          frame.colorData[y * w + x] =
            at + 1 < pixels.length
              ? decodeRgb565(pixels[at]! | (pixels[at + 1]! << 8))
              : TRANSPARENT;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  toUint8Array(): Uint8Array {
    const writer = new SpanWriter();
    writer.writeUInt32LE(this.unknown1);
    writer.writeUInt32LE(this.unknown2);
    writer.writeUInt8(this.format);
    writer.writeUInt8(this.paletteMode);
    writer.writeUInt8(this.reservedModeBytes[0] ?? 0);
    writer.writeUInt8(this.reservedModeBytes[1] ?? 0);

    if (this.format === SpfFormatType.Palettized) {
      this.writePalettized(writer);
    } else {
      this.writeColorized(writer);
    }

    return writer.toUint8Array();
  }

  private writePalettized(writer: SpanWriter): void {
    for (let i = 0; i < COLORS_PER_PALETTE; i++) {
      writer.writeUInt16LE(encodeRgb565(this.primaryColors!.get(i)));
    }
    for (let i = 0; i < COLORS_PER_PALETTE; i++) {
      writer.writeUInt16LE(encodeRgb555(this.secondaryColors!.get(i)));
    }

    writer.writeUInt32LE(this.frames.length);
    let startAddress = 0;

    for (const frame of this.frames) {
      frame.startAddress = startAddress;
      startAddress += frame.byteCount;
      writer.writeUInt16LE(frame.left);
      writer.writeUInt16LE(frame.top);
      writer.writeUInt16LE(frame.right);
      writer.writeUInt16LE(frame.bottom);
      writer.writeInt16LE(frame.centerX);
      writer.writeInt16LE(frame.centerY);
      writer.writeUInt32LE(encodeFlags(frame));
      writer.writeUInt32LE(frame.startAddress);
      writer.writeUInt32LE(frame.byteWidth);
      writer.writeUInt32LE(frame.byteCount);
      writer.writeUInt32LE(frame.imageByteCount);
    }

    writer.writeUInt32LE(startAddress);
    for (const frame of this.frames) {
      writer.writeBytes(frame.data!);
    }
  }

  private writeColorized(writer: SpanWriter): void {
    writer.writeUInt32LE(this.frames.length);
    let startAddress = 0;

    for (const frame of this.frames) {
      // `colorData` is tightly packed by the reader, so the frame is written with no
      // row padding. Normalize the pitch and the byte counts to what is actually
      // emitted — keeping a source file's padded pitch here would make every later
      // frame's startAddress point into the wrong place.
      const w = spfFrameWidth(frame);
      const h = spfFrameHeight(frame);
      frame.byteWidth = w * 2;
      frame.imageByteCount = w * h;
      frame.byteCount = w * h * 4; // the RGB565 copy plus the RGB555 copy

      frame.startAddress = startAddress;
      startAddress += frame.byteCount;
      writer.writeUInt16LE(frame.left);
      writer.writeUInt16LE(frame.top);
      writer.writeUInt16LE(frame.right);
      writer.writeUInt16LE(frame.bottom);
      writer.writeInt16LE(frame.centerX);
      writer.writeInt16LE(frame.centerY);
      writer.writeUInt32LE(encodeFlags(frame));
      writer.writeUInt32LE(frame.startAddress);
      writer.writeUInt32LE(frame.byteWidth);
      writer.writeUInt32LE(frame.byteCount);
      writer.writeUInt32LE(frame.imageByteCount);
    }

    writer.writeUInt32LE(startAddress);

    for (const frame of this.frames) {
      // The bounds give the size, exactly as the reader does. Using right/bottom here
      // would run past the end of colorData for any frame with a non-zero origin.
      const w = spfFrameWidth(frame);
      const h = spfFrameHeight(frame);
      const colorData = frame.colorData!;

      // Primary: RGB565
      for (let i = 0; i < w * h; i++) {
        writer.writeUInt16LE(encodeRgb565(colorData[i] ?? TRANSPARENT));
      }
      // Secondary: RGB555
      for (let i = 0; i < w * h; i++) {
        writer.writeUInt16LE(encodeRgb555(colorData[i] ?? TRANSPARENT));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Factory methods
  // ---------------------------------------------------------------------------

  static fromBuffer(buffer: ArrayBuffer | Uint8Array): SpfFile {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return SpfFile.parse(bytes);
  }

  static fromEntry(entry: DataArchiveEntry): SpfFile {
    return SpfFile.fromBuffer(entry.toUint8Array());
  }

  static fromArchive(fileName: string, archive: import('../data/DataArchive.js').DataArchive): SpfFile {
    const name = fileName.endsWith('.spf') ? fileName : `${fileName}.spf`;
    const entry = archive.get(name);
    if (!entry) throw new Error(`SPF file "${fileName}" not found in archive`);
    return SpfFile.fromEntry(entry);
  }

  static fromFile(path: string): SpfFile {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('fs');
    const buf = fs.readFileSync(path);
    return SpfFile.fromBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  }

  /**
   * Build a colorized SPF from an array of RGBA frames.
   * Each pixel is stored as a direct RGB565 color (no palette).
   * Transparent pixels (alpha === 0) are stored as transparent black (0x0000).
   */
  static fromColorizedRgbaFrames(frames: RgbaFrame[]): SpfFile {
    const spf = new SpfFile(SpfFormatType.Colorized);
    for (const src of frames) {
      const { width: w, height: h, data } = src;
      const colorData: Color[] = new Array(w * h);
      for (let i = 0; i < w * h; i++) {
        const r = data[i * 4]!;
        const g = data[i * 4 + 1]!;
        const b = data[i * 4 + 2]!;
        const a = data[i * 4 + 3]!;
        colorData[i] = a === 0 ? { r: 0, g: 0, b: 0, a: 255 } : { r, g, b, a: 255 };
      }
      const frame: SpfFrame = {
        left: 0,
        top: 0,
        right: w,
        bottom: h,
        centerX: CENTER_POINT_SENTINEL,
        centerY: CENTER_POINT_SENTINEL,
        flags: 0,
        hasCenterPoint: false,
        startAddress: 0,
        byteWidth: w * 2,
        byteCount: w * h * 4, // RGB565 copy + RGB555 copy
        imageByteCount: w * h,
        colorData,
      };
      spf.frames.push(frame);
    }
    return spf;
  }

  /**
   * Build a palettized SPF from an array of RGBA frames using Wu color quantization.
   * All frames share a single 256-color palette (slot 0 = transparent black).
   */
  static fromPalettizedRgbaFrames(frames: RgbaFrame[]): SpfFile {
    const spf = new SpfFile(SpfFormatType.Palettized);
    const processed = frames.map(preserveNonTransparentBlacks);
    const { palette, indexedFrames } = quantizeFrames(processed);
    spf.primaryColors = palette;
    spf.secondaryColors = palette;

    for (let fi = 0; fi < frames.length; fi++) {
      const { width: w, height: h } = frames[fi]!;
      const indexed = indexedFrames[fi]!;
      const frame: SpfFrame = {
        left: 0,
        top: 0,
        right: w,
        bottom: h,
        centerX: CENTER_POINT_SENTINEL,
        centerY: CENTER_POINT_SENTINEL,
        flags: 0,
        hasCenterPoint: false,
        startAddress: 0,
        byteWidth: w,
        byteCount: w * h,
        imageByteCount: w * h,
        data: indexed,
      };
      spf.frames.push(frame);
    }
    return spf;
  }
}

/** Helper: create a SpanReader positioned at an absolute byte offset in the underlying buffer. */
function bytes_from_reader(reader: SpanReader, absoluteOffset: number, length: number): Uint8Array {
  // We need to reach back into the original buffer — SpanReader exposes position so we
  // track the underlying data via the snapshot approach: seek + readBytes.
  const saved = reader.position;
  reader.seek(absoluteOffset);
  const slice = reader.readBytes(length);
  reader.seek(saved);
  return new Uint8Array(slice);
}
