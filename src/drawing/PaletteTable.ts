import { KhanPalOverrideType } from '../enums.js';
import type { DataArchive } from '../data/DataArchive.js';
import type { DataArchiveEntry } from '../data/DataArchiveEntry.js';
import type { PaletteCyclingEntry } from './PaletteCyclingEntry.js';

/**
 * Maps external IDs to palette numbers. Text-format (.tbl) file.
 *
 * Line formats:
 *   "id paletteNumber"           → single-value override
 *   "min max paletteNumber"      → range entry (fills min..max with paletteNumber)
 *   "id value -1"                → male override
 *   "id value -2"                → female override
 *
 * Overrides take priority over range entries regardless of parse order.
 * When paletteNumber >= 1000, subtract 1000 and use luminance blending (see PaletteLookup).
 */
export class PaletteTable {
  /** Cycling definitions per palette number (from companion numeric .tbl files). */
  readonly cyclingEntries: Map<number, PaletteCyclingEntry[]> = new Map();
  /** Range-based entries: id → paletteNumber. */
  protected entries: Map<number, number> = new Map();
  /** Single-value overrides: id → paletteNumber. */
  protected overrides: Map<number, number> = new Map();
  /** Male-specific overrides. */
  protected maleOverrides: Map<number, number> = new Map();
  /** Female-specific overrides. */
  protected femaleOverrides: Map<number, number> = new Map();

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  getPaletteNumber(id: number, overrideType: KhanPalOverrideType = KhanPalOverrideType.None): number {
    if (overrideType === KhanPalOverrideType.Male) {
      const v = this.maleOverrides.get(id);
      if (v !== undefined) return v;
    }
    if (overrideType === KhanPalOverrideType.Female) {
      const v = this.femaleOverrides.get(id);
      if (v !== undefined) return v;
    }
    const ov = this.overrides.get(id);
    if (ov !== undefined) return ov;
    return this.entries.get(id) ?? 0;
  }

  getCyclingEntries(paletteNumber: number): readonly PaletteCyclingEntry[] | undefined {
    return this.cyclingEntries.get(paletteNumber);
  }

  // ---------------------------------------------------------------------------
  // Mutation
  // ---------------------------------------------------------------------------

  add(id: number, paletteNumber: number, overrideType: KhanPalOverrideType = KhanPalOverrideType.None): void {
    switch (overrideType) {
      case KhanPalOverrideType.Male:
        this.maleOverrides.set(id, paletteNumber);
        break;
      case KhanPalOverrideType.Female:
        this.femaleOverrides.set(id, paletteNumber);
        break;
      default:
        this.overrides.set(id, paletteNumber);
    }
  }

  remove(id: number): void {
    this.maleOverrides.delete(id);
    this.femaleOverrides.delete(id);
    this.overrides.delete(id);
    this.entries.delete(id);
  }

  merge(other: PaletteTable): void {
    for (const [k, v] of other.maleOverrides) this.maleOverrides.set(k, v);
    for (const [k, v] of other.femaleOverrides) this.femaleOverrides.set(k, v);
    for (const [k, v] of other.overrides) this.overrides.set(k, v);
    for (const [k, v] of other.entries) this.entries.set(k, v);
    for (const [k, v] of other.cyclingEntries) this.cyclingEntries.set(k, v);
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  toText(): string {
    const lines: string[] = [];

    // Merge entries and overrides, group by paletteNumber, find consecutive ranges
    const combined = new Map<number, number>(this.entries);
    for (const [k, v] of this.overrides) combined.set(k, v);

    const byPalette = new Map<number, number[]>();
    for (const [id, pal] of combined) {
      let arr = byPalette.get(pal);
      if (!arr) { arr = []; byPalette.set(pal, arr); }
      arr.push(id);
    }

    for (const [pal, ids] of byPalette) {
      ids.sort((a, b) => a - b);
      let i = 0;
      while (i < ids.length) {
        const start = ids[i]!;
        let end = start;
        while (i + 1 < ids.length && ids[i]! + 1 === ids[i + 1]) { i++; end = ids[i]!; }
        lines.push(start === end ? `${start} ${pal}` : `${start} ${end} ${pal}`);
        i++;
      }
    }

    for (const [id, pal] of [...this.maleOverrides].sort((a, b) => a[0] - b[0])) {
      lines.push(`${id} ${pal} -1`);
    }
    for (const [id, pal] of [...this.femaleOverrides].sort((a, b) => a[0] - b[0])) {
      lines.push(`${id} ${pal} -2`);
    }

    return lines.join('\n') + '\n';
  }

  toUint8Array(): Uint8Array {
    return new TextEncoder().encode(this.toText());
  }

  // ---------------------------------------------------------------------------
  // Parsing
  // ---------------------------------------------------------------------------

  private static parseText(text: string): PaletteTable {
    const table = new PaletteTable();

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;

      const vals = line.split(' ');
      if (vals.length < 2) continue;

      const min = parseInt(vals[0]!, 10);
      const mid = parseInt(vals[1]!, 10);
      if (isNaN(min) || isNaN(mid)) continue;

      if (vals.length === 2) {
        table.overrides.set(min, mid);
      } else if (vals.length >= 3) {
        const third = parseInt(vals[2]!, 10);
        if (isNaN(third)) continue;
        if (third === -1) {
          table.maleOverrides.set(min, mid);
        } else if (third === -2) {
          table.femaleOverrides.set(min, mid);
        } else {
          for (let i = min; i <= mid; i++) table.entries.set(i, third);
        }
      }
    }

    return table;
  }

  private static parseCyclingText(text: string): PaletteCyclingEntry[] {
    const entries: PaletteCyclingEntry[] = [];
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const vals = line.split(' ');
      if (vals.length !== 3) continue;
      const start = parseInt(vals[0]!, 10);
      const end = parseInt(vals[1]!, 10);
      const period = parseInt(vals[2]!, 10);
      if (!isNaN(start) && !isNaN(end) && !isNaN(period)) {
        entries.push({ startIndex: start, endIndex: end, period });
      }
    }
    return entries;
  }

  // ---------------------------------------------------------------------------
  // Factory methods
  // ---------------------------------------------------------------------------

  static fromBuffer(buffer: ArrayBuffer | Uint8Array): PaletteTable {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return PaletteTable.parseText(new TextDecoder().decode(bytes));
  }

  static fromEntry(entry: DataArchiveEntry): PaletteTable {
    return PaletteTable.fromBuffer(entry.toUint8Array());
  }

  /**
   * Load from archive by pattern. Merges all matching .tbl files.
   * Files with a numeric identifier (e.g. mpt001.tbl) are treated as cycling files.
   * Files without (e.g. mptpal.tbl) are treated as palette mapping tables.
   */
  static fromArchive(pattern: string, archive: DataArchive): PaletteTable {
    const table = new PaletteTable();

    for (const entry of archive.getEntriesByPattern(pattern, '.tbl')) {
      const numId = entry.tryGetNumericIdentifier();
      if (numId !== null) {
        // Cycling file: "mpt001.tbl" → palette #1 cycling entries
        const text = new TextDecoder().decode(entry.toUint8Array());
        const cycling = PaletteTable.parseCyclingText(text);
        if (cycling.length > 0) table.cyclingEntries.set(numId, cycling);
      } else {
        // Main palette table file
        const part = PaletteTable.fromEntry(entry);
        table.merge(part);
      }
    }

    return table;
  }

  static fromFile(path: string): PaletteTable {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('fs');
    const buf = fs.readFileSync(path);
    return PaletteTable.fromBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  }
}
