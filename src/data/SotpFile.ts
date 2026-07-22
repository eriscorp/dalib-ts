import type { DataArchive } from './DataArchive.js';
import type { DataArchiveEntry } from './DataArchiveEntry.js';

/**
 * A static tile ID that the client treats as empty — it has no art and no flags.
 */
export const SOTP_EMPTY_TILE_ID = 0x2710;

/**
 * Grid directions used by the collision nibble, matching the client's bit assignment.
 */
export enum SotpDirection {
  /** `(-1, 0)` */
  Left = 0x01,
  /** `(0, +1)` */
  Down = 0x02,
  /** `(+1, 0)` */
  Right = 0x04,
  /** `(0, -1)` */
  Up = 0x08,
}

/** Render flag selecting the over-player wall and tree blend. */
export const SOTP_RENDER_OVER_PLAYER = 0x80;

/**
 * `SOTP.DAT` — per-static-tile collision and render flags.
 *
 * The file is a raw byte array with no header. **Byte 0 describes static tile ID 1**;
 * the client inserts an empty runtime entry at index 0 so that map tile IDs index the
 * loaded table directly. Each byte packs two independent nibbles:
 *
 * - low nibble — movement blocking, per direction (see {@link SotpDirection})
 * - high nibble — rendering, where `0x80` selects the over-player blend
 *
 * A tile may block movement without using the blend, or use the blend without blocking.
 * IDs beyond the end of the file, and the {@link SOTP_EMPTY_TILE_ID} sentinel, carry no
 * flags.
 */
export class SotpFile {
  /** Raw flag bytes, one per static tile ID starting at ID 1. */
  readonly data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  /** Highest static tile ID described by this file. */
  get maxTileId(): number {
    return this.data.length;
  }

  /**
   * Returns the raw flag byte for a static tile ID, or 0 when the ID is the empty
   * sentinel or falls outside the file.
   */
  getFlags(tileId: number): number {
    if (tileId === SOTP_EMPTY_TILE_ID) return 0;
    // Byte 0 is tile ID 1.
    const index = tileId - 1;
    if (index < 0 || index >= this.data.length) return 0;
    return this.data[index]!;
  }

  /** Returns the collision nibble (the low 4 bits) for a static tile ID. */
  getCollision(tileId: number): number {
    return this.getFlags(tileId) & 0x0f;
  }

  /** Returns the render nibble (the high 4 bits) for a static tile ID. */
  getRenderFlags(tileId: number): number {
    return this.getFlags(tileId) & 0xf0;
  }

  /** True when the tile uses the over-player wall and tree blend. */
  isOverPlayer(tileId: number): boolean {
    return (this.getFlags(tileId) & SOTP_RENDER_OVER_PLAYER) !== 0;
  }

  /** True when the tile blocks movement in the given direction. */
  blocksMovement(tileId: number, direction: SotpDirection): boolean {
    return (this.getCollision(tileId) & direction) !== 0;
  }

  /** Convenience inverse of {@link blocksMovement}. */
  canMove(tileId: number, direction: SotpDirection): boolean {
    return !this.blocksMovement(tileId, direction);
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  toUint8Array(): Uint8Array {
    return this.data;
  }

  // ---------------------------------------------------------------------------
  // Factory methods
  // ---------------------------------------------------------------------------

  static fromBuffer(buffer: ArrayBuffer | Uint8Array): SotpFile {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return new SotpFile(bytes);
  }

  static fromEntry(entry: DataArchiveEntry): SotpFile {
    return SotpFile.fromBuffer(entry.toUint8Array());
  }

  /** Load `sotp.dat` from an archive (it ships inside `ia.dat`). */
  static fromArchive(archive: DataArchive, fileName = 'sotp.dat'): SotpFile {
    const entry = archive.get(fileName);
    if (!entry) throw new Error(`SOTP file "${fileName}" not found in archive`);
    return SotpFile.fromEntry(entry);
  }

  /** Load from a file path. **Node.js only**. */
  static fromFile(path: string): SotpFile {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('fs');
    const buf = fs.readFileSync(path);
    return SotpFile.fromBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  }
}
