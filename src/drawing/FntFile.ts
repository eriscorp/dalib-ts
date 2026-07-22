import type { DataArchive } from '../data/DataArchive.js';
import type { DataArchiveEntry } from '../data/DataArchiveEntry.js';

/**
 * A headerless 1-bit-per-pixel glyph bitmap font file (.fnt).
 * English fonts use 8×12 glyph cells; Korean fonts use 16×12 cells.
 * Glyphs are stored contiguously; no file-level header.
 *
 * **This is the dormant font format.** `eng%02d.fnt` and `han%02d.fnt` still ship in
 * `Legend.dat`, and `Darkages.cfg` still stores `EngFont`/`HanFont` indexes, but their
 * loaders have no callers in the 7.41 client and are not part of the `FontImageLib`
 * vtable. All text the client actually draws goes through the LFT format — see
 * {@link import('./LftFile.js').LftFile}, which carries per-glyph advances and bounds
 * instead of a fixed cell.
 */
export class FntFile {
  /** Raw 1bpp glyph bitmap data. */
  readonly data: Uint8Array;
  /** Pixel width of each glyph cell (8 for English, 16 for Korean). */
  readonly glyphWidth: number;
  /** Pixel height of each glyph cell. */
  readonly glyphHeight: number;
  /** Number of bytes per pixel row in a glyph. */
  readonly bytesPerRow: number;
  /** Number of bytes per glyph. */
  readonly bytesPerGlyph: number;
  /** Total number of glyphs in the font. */
  readonly glyphCount: number;

  private constructor(data: Uint8Array, glyphWidth: number, glyphHeight: number) {
    this.data = data;
    this.glyphWidth = glyphWidth;
    this.glyphHeight = glyphHeight;
    this.bytesPerRow = (glyphWidth + 7) >> 3;
    this.bytesPerGlyph = this.bytesPerRow * glyphHeight;
    this.glyphCount = this.bytesPerGlyph > 0 ? Math.floor(data.length / this.bytesPerGlyph) : 0;
  }

  /** Returns true if the given glyph index is within range. */
  isValidIndex(index: number): boolean {
    return index >= 0 && index < this.glyphCount;
  }

  /**
   * Returns the raw 1bpp bytes for glyph at `index`.
   * Bits within each byte are in MSB-first order (bit 7 = leftmost pixel).
   *
   * Most consumers should prefer {@link getGlyphPixels} which returns
   * an already-decoded one-byte-per-pixel buffer.
   */
  getGlyphData(index: number): Uint8Array {
    if (!this.isValidIndex(index)) throw new RangeError(`Glyph index ${index} out of range`);
    return this.data.subarray(index * this.bytesPerGlyph, (index + 1) * this.bytesPerGlyph);
  }

  /**
   * Returns the decoded glyph at `index` as a flat one-byte-per-pixel buffer
   * of length `glyphWidth * glyphHeight`. Each byte is 0 (off) or 1 (on),
   * indexed `[y * glyphWidth + x]`.
   */
  getGlyphPixels(index: number): Uint8Array {
    const raw = this.getGlyphData(index);
    const out = new Uint8Array(this.glyphWidth * this.glyphHeight);
    for (let y = 0; y < this.glyphHeight; y++) {
      const rowStart = y * this.bytesPerRow;
      for (let x = 0; x < this.glyphWidth; x++) {
        const byte = raw[rowStart + (x >> 3)]!;
        out[y * this.glyphWidth + x] = (byte >> (7 - (x & 7))) & 1;
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Factory methods
  // ---------------------------------------------------------------------------

  static fromBuffer(buffer: ArrayBuffer | Uint8Array, glyphWidth: number, glyphHeight: number): FntFile {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return new FntFile(bytes, glyphWidth, glyphHeight);
  }

  static fromEntry(entry: DataArchiveEntry, glyphWidth: number, glyphHeight: number): FntFile {
    return FntFile.fromBuffer(entry.toUint8Array(), glyphWidth, glyphHeight);
  }

  static fromArchive(
    fileName: string,
    archive: DataArchive,
    glyphWidth: number,
    glyphHeight: number,
  ): FntFile {
    const name = fileName.endsWith('.fnt') ? fileName : `${fileName}.fnt`;
    const entry = archive.get(name);
    if (!entry) throw new Error(`FNT file "${fileName}" not found in archive`);
    return FntFile.fromEntry(entry, glyphWidth, glyphHeight);
  }

  static fromFile(path: string, glyphWidth: number, glyphHeight: number): FntFile {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('fs');
    const buf = fs.readFileSync(path);
    return FntFile.fromBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), glyphWidth, glyphHeight);
  }
}
