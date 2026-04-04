import { HPF_TILE_WIDTH } from '../constants.js';
import type { DataArchiveEntry } from '../data/DataArchiveEntry.js';
import { decompressHpf, isHpfCompressed } from '../io/Compression.js';

/** HPF magic number (uint32 LE). */
const HPF_SIGNATURE = 0xff02aa55;

/**
 * A single-frame palettized image in the HPF format (.hpf).
 * Width is always 28 pixels (HPF_TILE_WIDTH); height is derived from the data length.
 * The pixel data is an array of palette indices (1 byte per pixel).
 * A separate Palette file supplies the actual colors.
 */
export class HpfFile {
  /**
   * 8 bytes of file header. If the original file was compressed, these are
   * the first 8 bytes of the decompressed stream (post-decompression).
   */
  headerBytes: Uint8Array;

  /** Palette index data — one byte per pixel, width×height. */
  data: Uint8Array;

  constructor(headerBytes: Uint8Array, data: Uint8Array) {
    this.headerBytes = headerBytes;
    this.data = data;
  }

  /** Always 28 pixels. */
  get pixelWidth(): number {
    return HPF_TILE_WIDTH;
  }

  /** Derived from the data length (data.length / 28). */
  get pixelHeight(): number {
    return this.data.length / HPF_TILE_WIDTH;
  }

  /** Serialize to a Uint8Array (8 header bytes + pixel data). */
  toUint8Array(): Uint8Array {
    const out = new Uint8Array(8 + this.data.length);
    out.set(this.headerBytes.subarray(0, 8), 0);
    out.set(this.data, 8);
    return out;
  }

  /** Parse an HpfFile from a buffer (auto-decompresses if HPF signature is present). */
  static fromBuffer(buffer: ArrayBuffer | Uint8Array): HpfFile {
    let bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

    // Check for HPF compression signature
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sig = bytes.length >= 4 ? view.getUint32(0, true) : 0;

    if (sig === HPF_SIGNATURE) {
      bytes = decompressHpf(bytes);
    }

    const headerBytes = bytes.subarray(0, 8);
    const data = bytes.subarray(8);
    return new HpfFile(new Uint8Array(headerBytes), new Uint8Array(data));
  }

  /** Load from a DataArchiveEntry. */
  static fromEntry(entry: DataArchiveEntry): HpfFile {
    return HpfFile.fromBuffer(entry.toUint8Array());
  }

  /** Load from an archive by file name. */
  static fromArchive(fileName: string, archive: import('../data/DataArchive.js').DataArchive): HpfFile {
    const name = fileName.endsWith('.hpf') ? fileName : `${fileName}.hpf`;
    const entry = archive.get(name);
    if (!entry) throw new Error(`HPF file "${fileName}" not found in archive`);
    return HpfFile.fromEntry(entry);
  }

  /** Load from a file path. **Node.js only**. */
  static fromFile(path: string): HpfFile {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('fs');
    const buf = fs.readFileSync(path);
    return HpfFile.fromBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  }
}
