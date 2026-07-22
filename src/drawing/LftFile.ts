import type { DataArchive } from '../data/DataArchive.js';
import type { DataArchiveEntry } from '../data/DataArchiveEntry.js';
import { SpanReader } from '../io/SpanReader.js';

/** Number of glyph records in an LFT file: keys 0x0000 through 0xFFFE. */
export const LFT_GLYPH_COUNT = 65535;

/** Bytes per glyph record. */
export const LFT_RECORD_LENGTH = 11;

/**
 * Byte offset of the bitmap region, which the client seeks to directly.
 * Equals `4 + LFT_GLYPH_COUNT * LFT_RECORD_LENGTH`.
 */
export const LFT_BITMAP_BASE = 4 + LFT_GLYPH_COUNT * LFT_RECORD_LENGTH; // 0x0AFFF9

/** Per-glyph metrics and bitmap location. */
export interface LftGlyph {
  /** Pixels to advance the pen after drawing. */
  advance: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Packed bitmap size as stored in the record. The loader recomputes this from the bounds. */
  packedSize: number;
  /** Offset into the bitmap region. Zero means the glyph has no bitmap. */
  bitmapOffset: number;
}

/** Visible width of a glyph's bitmap. */
export function lftGlyphWidth(glyph: LftGlyph): number {
  return glyph.right - glyph.left;
}

/** Number of stored rows in a glyph's bitmap. */
export function lftGlyphHeight(glyph: LftGlyph): number {
  return glyph.bottom - glyph.top;
}

/** Source rows are padded to a four-byte boundary. */
export function lftRowStride(width: number): number {
  return (((width + 31) / 32) | 0) * 4;
}

/**
 * An LFT bitmap font — the format the 7.41 client actually renders text with.
 *
 * `da.lft` and `lod.lft` live inside `national.dat`. Unlike the dormant fixed-cell
 * {@link import('./FntFile.js').FntFile} format, each glyph carries its own advance and
 * bounds, so narrow Latin glyphs do not consume a full cell.
 *
 * Glyphs are indexed by a raw 16-bit key assembled by the text renderer: a single ANSI
 * byte (`0x0000`–`0x00FF`) or a DBCS pair as `(lead << 8) | trail`. The key is *not*
 * Unicode — interpreting it depends on the chosen LFT and the active Windows ANSI code
 * page. Key `0xFFFF` has no record.
 */
export class LftFile {
  /** Nominal cell width from the header (12 in `da.lft`). */
  readonly nominalWidth: number;
  /** Nominal cell height from the header (12 in `da.lft`). */
  readonly nominalHeight: number;
  /** All 65,535 glyph records, indexed by glyph key. */
  readonly glyphs: LftGlyph[];
  /** The packed 1bpp bitmap region. */
  readonly bitmapData: Uint8Array;

  constructor(
    nominalWidth: number,
    nominalHeight: number,
    glyphs: LftGlyph[],
    bitmapData: Uint8Array,
  ) {
    this.nominalWidth = nominalWidth;
    this.nominalHeight = nominalHeight;
    this.glyphs = glyphs;
    this.bitmapData = bitmapData;
  }

  /** Returns true if `key` addresses a real glyph record. */
  isValidKey(key: number): boolean {
    return key >= 0 && key < LFT_GLYPH_COUNT;
  }

  /** Returns the glyph record for `key`, or undefined when out of range. */
  getGlyph(key: number): LftGlyph | undefined {
    return this.isValidKey(key) ? this.glyphs[key] : undefined;
  }

  /**
   * Returns how far the pen advances after `key`.
   *
   * Backspace, tab, line feed and carriage return have a forced advance of zero. Space
   * normally uses its stored advance, but falls back to half the nominal width when the
   * font omits its bitmap.
   */
  getAdvance(key: number): number {
    if (key === 0x08 || key === 0x09 || key === 0x0a || key === 0x0d) return 0;

    const glyph = this.getGlyph(key);
    if (!glyph) return 0;

    if (key === 0x20 && glyph.bitmapOffset === 0) {
      return Math.floor(this.nominalWidth / 2);
    }

    return glyph.advance;
  }

  /**
   * Decodes a glyph into a one-byte-per-pixel alpha mask of
   * `lftGlyphWidth × lftGlyphHeight`, where 0 is transparent and 255 is a font pixel.
   * Returns an empty 0×0 buffer for glyphs with no bitmap.
   */
  getGlyphPixels(key: number): { width: number; height: number; data: Uint8Array } {
    const glyph = this.getGlyph(key);
    if (!glyph || glyph.bitmapOffset === 0) {
      return { width: 0, height: 0, data: new Uint8Array(0) };
    }

    const width = lftGlyphWidth(glyph);
    const height = lftGlyphHeight(glyph);
    if (width <= 0 || height <= 0) {
      return { width: 0, height: 0, data: new Uint8Array(0) };
    }

    // The active loader computes the size from the bounds rather than trusting the
    // stored packedSize.
    const stride = lftRowStride(width);
    const out = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
      const rowStart = glyph.bitmapOffset + y * stride;
      for (let x = 0; x < width; x++) {
        const byte = this.bitmapData[rowStart + (x >> 3)];
        if (byte === undefined) continue;
        // One bit per pixel, most-significant bit first.
        if ((byte & (0x80 >> (x & 7))) !== 0) out[y * width + x] = 255;
      }
    }

    return { width, height, data: out };
  }

  // ---------------------------------------------------------------------------
  // Factory methods
  // ---------------------------------------------------------------------------

  static fromBuffer(buffer: ArrayBuffer | Uint8Array): LftFile {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length < LFT_BITMAP_BASE) {
      throw new Error(
        `Invalid LFT: expected at least ${LFT_BITMAP_BASE} bytes, got ${bytes.length}`,
      );
    }

    const reader = new SpanReader(bytes);
    const nominalWidth = reader.readUInt16LE();
    const nominalHeight = reader.readUInt16LE();

    const glyphs: LftGlyph[] = new Array<LftGlyph>(LFT_GLYPH_COUNT);
    for (let i = 0; i < LFT_GLYPH_COUNT; i++) {
      glyphs[i] = {
        advance: reader.readUInt8(),
        left: reader.readUInt8(),
        top: reader.readUInt8(),
        right: reader.readUInt8(),
        bottom: reader.readUInt8(),
        packedSize: reader.readUInt16LE(),
        bitmapOffset: reader.readUInt32LE(),
      };
    }

    const bitmapData = bytes.subarray(LFT_BITMAP_BASE);
    return new LftFile(nominalWidth, nominalHeight, glyphs, bitmapData);
  }

  static fromEntry(entry: DataArchiveEntry): LftFile {
    return LftFile.fromBuffer(entry.toUint8Array());
  }

  /** Load an LFT from an archive (`da.lft` and `lod.lft` ship inside `national.dat`). */
  static fromArchive(fileName: string, archive: DataArchive): LftFile {
    const name = fileName.endsWith('.lft') ? fileName : `${fileName}.lft`;
    const entry = archive.get(name);
    if (!entry) throw new Error(`LFT file "${fileName}" not found in archive`);
    return LftFile.fromEntry(entry);
  }

  /** Load from a file path. **Node.js only**. */
  static fromFile(path: string): LftFile {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('fs');
    const buf = fs.readFileSync(path);
    return LftFile.fromBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  }
}
