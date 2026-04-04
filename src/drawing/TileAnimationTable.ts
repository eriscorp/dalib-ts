import type { DataArchive } from '../data/DataArchive.js';
import type { DataArchiveEntry } from '../data/DataArchiveEntry.js';
import { TileAnimationEntry } from './TileAnimationEntry.js';

/**
 * A table of tile animation sequences. Text-format (.tbl) file.
 * Each line: "tileId1 tileId2 ... intervalInHundredths"
 * The last token on each line is the interval (multiplied by 100 → ms).
 * All other tokens are tile IDs. Each entry is indexed by every tile ID in its sequence.
 */
export class TileAnimationTable {
  private readonly map = new Map<number, TileAnimationEntry>();

  /** Try to retrieve the animation entry for a given tile ID. */
  tryGetEntry(tileId: number): TileAnimationEntry | undefined {
    return this.map.get(tileId);
  }

  add(entry: TileAnimationEntry): void {
    for (const tileId of entry.tileSequence) this.map.set(tileId, entry);
  }

  remove(entry: TileAnimationEntry): void {
    for (const tileId of entry.tileSequence) this.map.delete(tileId);
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  toText(): string {
    const seen = new Set<TileAnimationEntry>();
    const lines: string[] = [];
    for (const entry of this.map.values()) {
      if (seen.has(entry)) continue;
      seen.add(entry);
      const intervalHundredths = Math.round(entry.animationIntervalMs / 100);
      lines.push(`${entry.tileSequence.join(' ')} ${intervalHundredths}`);
    }
    return lines.join('\n') + '\n';
  }

  toUint8Array(): Uint8Array {
    return new TextEncoder().encode(this.toText());
  }

  // ---------------------------------------------------------------------------
  // Factory methods
  // ---------------------------------------------------------------------------

  private static parseText(text: string): TileAnimationTable {
    const table = new TileAnimationTable();

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;

      const tokens = line.split(/\s+/);
      if (tokens.length < 2) continue;

      const entry = new TileAnimationEntry();
      for (let i = 0; i < tokens.length; i++) {
        const value = parseInt(tokens[i]!, 10);
        if (isNaN(value)) continue;
        if (i === tokens.length - 1) {
          entry.animationIntervalMs = value * 100;
        } else {
          entry.tileSequence.push(value);
          table.map.set(value, entry);
        }
      }
    }

    return table;
  }

  static fromBuffer(buffer: ArrayBuffer | Uint8Array): TileAnimationTable {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return TileAnimationTable.parseText(new TextDecoder().decode(bytes));
  }

  static fromEntry(entry: DataArchiveEntry): TileAnimationTable {
    return TileAnimationTable.fromBuffer(entry.toUint8Array());
  }

  static fromArchive(fileName: string, archive: DataArchive): TileAnimationTable {
    const name = fileName.endsWith('.tbl') ? fileName : `${fileName}.tbl`;
    const entry = archive.get(name);
    if (!entry) throw new Error(`TBL file "${fileName}" not found in archive`);
    return TileAnimationTable.fromEntry(entry);
  }

  static fromFile(path: string): TileAnimationTable {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('fs');
    const buf = fs.readFileSync(path);
    return TileAnimationTable.fromBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  }
}
