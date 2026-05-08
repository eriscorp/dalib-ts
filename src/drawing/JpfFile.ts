import type { DataArchive } from '../data/DataArchive.js';
import type { DataArchiveEntry } from '../data/DataArchiveEntry.js';

const JPF_PREFIX_LENGTH = 4;

/**
 * A `.jpf` entry — a standard JPEG/JFIF stream prefixed with a 4-byte
 * `"JPF\0"` magic. This class strips the prefix and exposes the inner
 * JPEG bytes for handoff to a real JPEG decoder.
 */
export class JpfFile {
  /** Inner JPEG bytes (the original buffer minus the 4-byte `"JPF\0"` prefix). */
  readonly jpegBytes: Uint8Array;

  private constructor(jpegBytes: Uint8Array) {
    this.jpegBytes = jpegBytes;
  }

  /** Returns the inner JPEG bytes (alias for {@link jpegBytes}). */
  toJpegBuffer(): Uint8Array {
    return this.jpegBytes;
  }

  /**
   * Parse a JPF buffer. Throws if the buffer is too short or the
   * `"JPF\0"` magic is missing.
   */
  static fromBuffer(buffer: ArrayBuffer | Uint8Array): JpfFile {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length < JPF_PREFIX_LENGTH + 2) {
      throw new Error(`JPF buffer too short: ${bytes.length} bytes`);
    }
    if (
      bytes[0] !== 0x4a ||
      bytes[1] !== 0x50 ||
      bytes[2] !== 0x46 ||
      bytes[3] !== 0x00
    ) {
      throw new Error('Not a JPF file (expected magic "JPF\\0")');
    }
    return new JpfFile(bytes.subarray(JPF_PREFIX_LENGTH));
  }

  /** Load from a {@link DataArchiveEntry}. */
  static fromEntry(entry: DataArchiveEntry): JpfFile {
    return JpfFile.fromBuffer(entry.toUint8Array());
  }

  /** Load from an archive by file name. */
  static fromArchive(fileName: string, archive: DataArchive): JpfFile {
    const name = fileName.endsWith('.jpf') ? fileName : `${fileName}.jpf`;
    const entry = archive.get(name);
    if (!entry) throw new Error(`JPF file "${fileName}" not found in archive`);
    return JpfFile.fromEntry(entry);
  }

  /** Load from a file path. **Node.js only**. */
  static fromFile(path: string): JpfFile {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('fs');
    const buf = fs.readFileSync(path);
    return JpfFile.fromBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  }
}
