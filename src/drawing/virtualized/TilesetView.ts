import { TILE_SIZE } from '../../constants.js';
import type { DataArchive } from '../../data/DataArchive.js';
import type { DataArchiveEntry } from '../../data/DataArchiveEntry.js';
import { Tile } from '../Tile.js';

/**
 * A lightweight view over a tileset (.bmp) file.
 * Only the tile count is stored; individual tile data is sliced from the archive buffer on demand.
 */
export class TilesetView {
  private readonly entry: DataArchiveEntry;
  readonly count: number;

  private constructor(entry: DataArchiveEntry, count: number) {
    this.entry = entry;
    this.count = count;
  }

  /** Read and return the Tile at `index` (zero-copy subarray of the archive buffer). */
  get(index: number): Tile {
    if (index < 0 || index >= this.count) throw new RangeError(`Tile index ${index} out of range`);
    const buf = this.entry.toUint8Array();
    return new Tile(new Uint8Array(buf.subarray(index * TILE_SIZE, (index + 1) * TILE_SIZE)));
  }

  tryGet(index: number): Tile | undefined {
    if (index < 0 || index >= this.count) return undefined;
    return this.get(index);
  }

  static fromEntry(entry: DataArchiveEntry): TilesetView {
    return new TilesetView(entry, Math.floor(entry.fileSize / TILE_SIZE));
  }

  static fromArchive(fileName: string, archive: DataArchive): TilesetView {
    const name = fileName.endsWith('.bmp') ? fileName : `${fileName}.bmp`;
    const entry = archive.get(name);
    if (!entry) throw new Error(`BMP file "${fileName}" not found in archive`);
    return TilesetView.fromEntry(entry);
  }
}
