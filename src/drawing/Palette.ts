import type { Color } from '../constants.js';
import { COLORS_PER_PALETTE, PALETTE_DYE_INDEX_START, TRANSPARENT } from '../constants.js';
import type { DataArchiveEntry } from '../data/DataArchiveEntry.js';
import { SpanReader } from '../io/SpanReader.js';
import { SpanWriter } from '../io/SpanWriter.js';

/** A color table entry used for dyeing — an array of replacement colors. */
export interface ColorTableEntry {
  colors: Color[];
}

/**
 * A 256-color palette used by all palettized Dark Ages image formats.
 * Index 0 is conventionally transparent black.
 */
export class Palette {
  readonly colors: Color[];

  /** Create a palette pre-filled with 256 transparent-black entries. */
  constructor(colors?: Color[]) {
    if (colors) {
      this.colors = colors.slice(0, COLORS_PER_PALETTE);
      while (this.colors.length < COLORS_PER_PALETTE) this.colors.push({ ...TRANSPARENT });
    } else {
      this.colors = Array.from({ length: COLORS_PER_PALETTE }, () => ({ ...TRANSPARENT }));
    }
  }

  get(index: number): Color {
    return this.colors[index]!;
  }

  set(index: number, color: Color): void {
    this.colors[index] = color;
  }

  get length(): number {
    return this.colors.length;
  }

  /**
   * Return a new Palette with colors rotated within [startIndex, endIndex] by `stage` steps.
   * Used for animated palette cycling (e.g. water shimmer effects).
   */
  cycle(startIndex: number, endIndex: number, stage = 0): Palette {
    const result = new Palette(this.colors);
    const rangeLength = endIndex - startIndex + 1;
    const offset = ((stage % rangeLength) + rangeLength) % rangeLength;

    for (let i = 0; i < rangeLength; i++) {
      const srcIndex = startIndex + ((i - offset + rangeLength) % rangeLength);
      result.colors[startIndex + i] = { ...this.colors[srcIndex]! };
    }

    return result;
  }

  /**
   * Return a new Palette with `colorTableEntry.colors` copied starting at `dyeIndexStart`.
   * Used for item dyeing (default start: index 98).
   */
  dye(colorTableEntry: ColorTableEntry, dyeIndexStart = PALETTE_DYE_INDEX_START): Palette {
    const result = new Palette(this.colors);
    for (let i = 0; i < colorTableEntry.colors.length; i++) {
      result.colors[dyeIndexStart + i] = { ...colorTableEntry.colors[i]! };
    }
    return result;
  }

  /** Serialize to a Uint8Array: 256 × 3 bytes (R, G, B — no alpha). */
  toUint8Array(): Uint8Array {
    const writer = new SpanWriter(COLORS_PER_PALETTE * 3);
    for (let i = 0; i < COLORS_PER_PALETTE; i++) {
      const c = this.colors[i]!;
      writer.writeUInt8(c.r);
      writer.writeUInt8(c.g);
      writer.writeUInt8(c.b);
    }
    return writer.toUint8Array();
  }

  /** Parse a Palette from a buffer (256 × 3 bytes, RGB888). */
  static fromBuffer(buffer: ArrayBuffer | Uint8Array): Palette {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const reader = new SpanReader(bytes);
    const palette = new Palette();

    for (let i = 0; i < COLORS_PER_PALETTE; i++) {
      palette.colors[i] = { r: reader.readUInt8(), g: reader.readUInt8(), b: reader.readUInt8(), a: 255 };
    }

    return palette;
  }

  /** Load a Palette from an archive entry. */
  static fromEntry(entry: DataArchiveEntry): Palette {
    return Palette.fromBuffer(entry.toUint8Array());
  }

  /**
   * Load all palettes from an archive that match `pattern` and end with ".pal".
   * Returns a Map keyed by the numeric identifier parsed from the entry name.
   */
  static fromArchive(pattern: string, archive: import('../data/DataArchive.js').DataArchive): Map<number, Palette> {
    const result = new Map<number, Palette>();
    for (const entry of archive.getEntriesByPattern(pattern, '.pal')) {
      const id = entry.tryGetNumericIdentifier();
      if (id !== null) result.set(id, Palette.fromEntry(entry));
    }
    return result;
  }

  /** Load a Palette from a file path. **Node.js only**. */
  static fromFile(path: string): Palette {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('fs');
    const buf = fs.readFileSync(path);
    return Palette.fromBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  }
}
