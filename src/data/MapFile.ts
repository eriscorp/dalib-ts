import { SpanReader } from '../io/SpanReader.js';
import { SpanWriter } from '../io/SpanWriter.js';

/** A single map tile with background and foreground layer references. */
export interface MapTile {
  /** Tile index into the background tileset (Seo.dat). */
  background: number;
  /** Tile index for the left foreground HPF image (ia.dat). */
  leftForeground: number;
  /** Tile index for the right foreground HPF image (ia.dat). */
  rightForeground: number;
}

/**
 * A Dark Ages map file (.map).
 * Contains a width×height 2D grid of MapTile objects.
 * Each tile is stored as 3 × int16 (6 bytes), row-major (y outer, x inner).
 */
export class MapFile {
  readonly width: number;
  readonly height: number;
  /** Row-major 2D array: tiles[y * width + x] */
  readonly tiles: MapTile[];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.tiles = Array.from({ length: width * height }, () => ({
      background: 0,
      leftForeground: 0,
      rightForeground: 0,
    }));
  }

  /** Access a tile at (x, y). */
  getTile(x: number, y: number): MapTile {
    return this.tiles[y * this.width + x]!;
  }

  /** Set a tile at (x, y). */
  setTile(x: number, y: number, tile: MapTile): void {
    this.tiles[y * this.width + x] = tile;
  }

  /** Serialize this map to a Uint8Array (6 bytes per tile, row-major). */
  toUint8Array(): Uint8Array {
    const writer = new SpanWriter(this.width * this.height * 6);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const t = this.getTile(x, y);
        writer.writeInt16LE(t.background);
        writer.writeInt16LE(t.leftForeground);
        writer.writeInt16LE(t.rightForeground);
      }
    }
    return writer.toUint8Array();
  }

  /**
   * Parse a MapFile from a buffer.
   * The buffer must be exactly width × height × 6 bytes.
   */
  static fromBuffer(buffer: ArrayBuffer | Uint8Array, width: number, height: number): MapFile {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length !== width * height * 6) {
      throw new Error(`Invalid map buffer: expected ${width * height * 6} bytes, got ${bytes.length}`);
    }

    const map = new MapFile(width, height);
    const reader = new SpanReader(bytes);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        map.setTile(x, y, {
          background: reader.readInt16LE(),
          leftForeground: reader.readInt16LE(),
          rightForeground: reader.readInt16LE(),
        });
      }
    }

    return map;
  }

  /** Load a MapFile from a file path. **Node.js only**. */
  static fromFile(path: string, width: number, height: number): MapFile {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('fs');
    const buf = fs.readFileSync(path);
    return MapFile.fromBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), width, height);
  }
}
