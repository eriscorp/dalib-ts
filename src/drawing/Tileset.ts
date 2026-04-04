import type { RgbaFrame } from '../constants.js';
import { TILE_SIZE } from '../constants.js';
import type { DataArchive } from '../data/DataArchive.js';
import type { DataArchiveEntry } from '../data/DataArchiveEntry.js';
import { preserveNonTransparentBlacks, quantizeFrames } from '../utility/ImageProcessor.js';
import type { Palettized } from '../utility/Palettized.js';
import { Tile } from './Tile.js';

/**
 * A collection of palette-indexed ground tiles read from a .bmp file.
 * The file is headerless: a flat concatenation of TILE_SIZE-byte tile blocks.
 */
export class Tileset {
  readonly tiles: Tile[] = [];

  get length(): number { return this.tiles.length; }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.tiles.length * TILE_SIZE);
    for (let i = 0; i < this.tiles.length; i++) {
      const tile = this.tiles[i]!;
      if (tile.data.length !== TILE_SIZE) {
        throw new Error(`Tile ${i} has invalid size ${tile.data.length} (expected ${TILE_SIZE})`);
      }
      out.set(tile.data, i * TILE_SIZE);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Factory methods
  // ---------------------------------------------------------------------------

  static fromBuffer(buffer: ArrayBuffer | Uint8Array): Tileset {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const ts = new Tileset();
    const tileCount = Math.floor(bytes.length / TILE_SIZE);
    for (let i = 0; i < tileCount; i++) {
      ts.tiles.push(new Tile(new Uint8Array(bytes.subarray(i * TILE_SIZE, (i + 1) * TILE_SIZE))));
    }
    return ts;
  }

  static fromEntry(entry: DataArchiveEntry): Tileset {
    return Tileset.fromBuffer(entry.toUint8Array());
  }

  static fromArchive(fileName: string, archive: DataArchive): Tileset {
    const name = fileName.endsWith('.bmp') ? fileName : `${fileName}.bmp`;
    const entry = archive.get(name);
    if (!entry) throw new Error(`BMP file "${fileName}" not found in archive`);
    return Tileset.fromEntry(entry);
  }

  static fromFile(path: string): Tileset {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('fs');
    const buf = fs.readFileSync(path);
    return Tileset.fromBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  }

  /**
   * Build a palettized Tileset from an array of RGBA frames using Wu color quantization.
   * Each frame should be {@link TILE_SIZE} pixels (56 × 27). All tiles share a single palette.
   *
   * @returns A {@link Palettized} wrapper containing the Tileset and its shared palette.
   */
  static fromRgbaFrames(frames: RgbaFrame[]): Palettized<Tileset> {
    const processed = frames.map(preserveNonTransparentBlacks);
    const { palette, indexedFrames } = quantizeFrames(processed);
    const ts = new Tileset();
    for (const indexed of indexedFrames) {
      ts.tiles.push(new Tile(indexed));
    }
    return { entity: ts, palette };
  }
}
