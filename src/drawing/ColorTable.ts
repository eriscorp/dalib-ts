import type { Color } from '../constants.js';
import type { DataArchive } from '../data/DataArchive.js';
import type { DataArchiveEntry } from '../data/DataArchiveEntry.js';
import { type ColorTableEntry, emptyColorTableEntry } from './ColorTableEntry.js';

/**
 * A table of colors used as dye tables. Text-format file (.tbl).
 * Format:
 *   Line 1: colorsPerEntry (int)
 *   Then groups of:
 *     Line: colorIndex (byte)
 *     colorsPerEntry lines: "r,g,b" or empty (→ transparent)
 */
export class ColorTable {
  /** Entries keyed by colorIndex. */
  private readonly map = new Map<number, ColorTableEntry>();
  /** Ordered list of entries. */
  readonly entries: ColorTableEntry[] = [];

  /** Get an entry by colorIndex, or undefined. */
  get(colorIndex: number): ColorTableEntry | undefined {
    return this.map.get(colorIndex);
  }

  /** Check whether an entry exists for the given colorIndex. */
  has(colorIndex: number): boolean {
    return this.map.has(colorIndex);
  }

  private addEntry(entry: ColorTableEntry): void {
    this.entries.push(entry);
    this.map.set(entry.colorIndex, entry);
  }

  // ---------------------------------------------------------------------------
  // Parsing
  // ---------------------------------------------------------------------------

  private static parseText(text: string): ColorTable {
    const table = new ColorTable();
    const lines = text.split(/\r?\n/);
    let lineIndex = 0;

    const nextLine = (): string | undefined => {
      while (lineIndex < lines.length) {
        const l = lines[lineIndex++];
        if (l !== undefined) return l;
      }
      return undefined;
    };

    const firstLine = nextLine();
    if (firstLine === undefined) return table;
    const colorsPerEntry = parseInt(firstLine, 10);
    if (isNaN(colorsPerEntry) || colorsPerEntry <= 0) return table;

    while (lineIndex < lines.length) {
      const indexLine = nextLine();
      if (indexLine === undefined) break;
      const colorIndex = parseInt(indexLine, 10);
      if (isNaN(colorIndex) || colorIndex < 0 || colorIndex > 255) break;

      const colors: Color[] = [];

      for (let i = 0; i < colorsPerEntry; i++) {
        const colorLine = nextLine();
        if (!colorLine) {
          colors.push({ r: 0, g: 0, b: 0, a: 0 });
          continue;
        }
        const parts = colorLine.split(',');
        if (parts.length !== 3) {
          colors.push({ r: 0, g: 0, b: 0, a: 0 });
          continue;
        }
        const r = parseInt(parts[0]!, 10) % 256;
        const g = parseInt(parts[1]!, 10) % 256;
        const b = parseInt(parts[2]!, 10) % 256;
        colors.push({ r, g, b, a: 255 });
      }

      table.addEntry({ colorIndex, colors });
    }

    return table;
  }

  // ---------------------------------------------------------------------------
  // Factory methods
  // ---------------------------------------------------------------------------

  static fromBuffer(buffer: ArrayBuffer | Uint8Array): ColorTable {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return ColorTable.parseText(new TextDecoder().decode(bytes));
  }

  static fromEntry(entry: DataArchiveEntry): ColorTable {
    return ColorTable.fromBuffer(entry.toUint8Array());
  }

  static fromArchive(fileName: string, archive: DataArchive): ColorTable {
    const name = fileName.endsWith('.tbl') ? fileName : `${fileName}.tbl`;
    const entry = archive.get(name);
    if (!entry) throw new Error(`Color table "${fileName}" not found in archive`);
    return ColorTable.fromEntry(entry);
  }

  static fromFile(path: string): ColorTable {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('fs');
    const buf = fs.readFileSync(path);
    return ColorTable.fromBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  }
}

