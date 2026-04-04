import type { DataArchive } from '../data/DataArchive.js';
import type { DataArchiveEntry } from '../data/DataArchiveEntry.js';
import { EffectTableEntry } from './EffectTableEntry.js';

/**
 * A table of effect frame orders. Text-format (.tbl) file.
 * Line 1: effect count (informational only, not relied upon).
 * Subsequent lines: space-separated frame indices per effect (1-indexed).
 * Empty lines produce empty entries (effect slot with no frames).
 *
 * Effect IDs are 1-based: effect 1 = entries[0].
 */
export class EffectTable {
  private readonly entries: EffectTableEntry[] = [];

  /** Total number of effect slots (including empty ones). */
  get count(): number { return this.entries.length; }

  /** Returns the next available effect ID (= current count + 1, since IDs are 1-based). */
  getNextEffectId(): number { return this.entries.length + 1; }

  tryGetEntry(effectId: number): EffectTableEntry | undefined {
    if (effectId < 1 || effectId > this.entries.length) return undefined;
    return this.entries[effectId - 1];
  }

  add(frameSequence: number[]): void {
    const entry = new EffectTableEntry();
    entry.frameSequence = frameSequence.slice();
    this.entries.push(entry);
  }

  addEfa(): void { this.add([0]); }

  insert(effectNum: number, frameSequence: number[]): void {
    const entry = new EffectTableEntry();
    entry.frameSequence = frameSequence.slice();
    this.entries.splice(effectNum - 1, 0, entry);
  }

  /** Clears the frame sequence for a given effect slot (1-indexed). */
  remove(effectNum: number): void {
    if (effectNum >= 1 && effectNum <= this.entries.length) {
      this.entries[effectNum - 1] = new EffectTableEntry();
    }
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  toText(): string {
    const lines: string[] = [String(this.entries.length)];
    for (const entry of this.entries) {
      lines.push(entry.frameSequence.join(' '));
    }
    return lines.join('\n') + '\n';
  }

  toUint8Array(): Uint8Array {
    return new TextEncoder().encode(this.toText());
  }

  // ---------------------------------------------------------------------------
  // Factory methods
  // ---------------------------------------------------------------------------

  private static parseText(text: string): EffectTable {
    const table = new EffectTable();
    const lines = text.split(/\r?\n/);
    let lineIndex = 0;

    // Skip the count line
    while (lineIndex < lines.length) {
      const l = lines[lineIndex++]!.trim();
      if (!l) continue;
      if (!isNaN(parseInt(l, 10))) break; // consumed the count
    }

    while (lineIndex < lines.length) {
      const rawLine = lines[lineIndex++]!;
      if (!rawLine.trim()) {
        table.entries.push(new EffectTableEntry()); // empty entry
        continue;
      }
      const entry = new EffectTableEntry();
      for (const token of rawLine.trim().split(/\s+/)) {
        const n = parseInt(token, 10);
        if (!isNaN(n)) entry.frameSequence.push(n);
      }
      table.entries.push(entry);
    }

    return table;
  }

  static fromBuffer(buffer: ArrayBuffer | Uint8Array): EffectTable {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return EffectTable.parseText(new TextDecoder().decode(bytes));
  }

  static fromEntry(entry: DataArchiveEntry): EffectTable {
    return EffectTable.fromBuffer(entry.toUint8Array());
  }

  static fromArchive(rohDat: DataArchive): EffectTable {
    const entry = rohDat.get('effect.tbl');
    if (!entry) throw new Error('"effect.tbl" not found in archive');
    return EffectTable.fromEntry(entry);
  }

  static fromFile(path: string): EffectTable {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('fs');
    const buf = fs.readFileSync(path);
    return EffectTable.fromBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  }
}
