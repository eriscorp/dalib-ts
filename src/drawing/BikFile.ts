import type { DataArchive } from '../data/DataArchive.js';
import type { DataArchiveEntry } from '../data/DataArchiveEntry.js';
import { SpanReader } from '../io/SpanReader.js';

const BIK_HEADER_LENGTH = 44;

/**
 * Header-only metadata for a Bink Video file (.bik).
 *
 * The full Bink codec is patent-encumbered and out of scope for this library;
 * this class parses the freely-readable header so consumers can display
 * resolution / frame-rate / track-count metadata or pipe the bytes to an
 * external decoder (ffmpeg's reverse-engineered BIK1 decoder, etc.).
 */
export class BikFile {
  /** Version letter from the magic (e.g. 'b', 'f', 'i'). */
  readonly version: string;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  /** Frames per second, computed as `frameRateDividend / frameRateDivisor`. */
  readonly fps: number;
  readonly audioTrackCount: number;

  private constructor(
    version: string,
    width: number,
    height: number,
    frameCount: number,
    fps: number,
    audioTrackCount: number,
  ) {
    this.version = version;
    this.width = width;
    this.height = height;
    this.frameCount = frameCount;
    this.fps = fps;
    this.audioTrackCount = audioTrackCount;
  }

  /**
   * Parse the BIK header from a buffer. Throws if the buffer is too short
   * or the magic is not "BIK".
   */
  static fromBuffer(buffer: ArrayBuffer | Uint8Array): BikFile {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length < BIK_HEADER_LENGTH) {
      throw new Error(`BIK buffer too short: ${bytes.length} bytes`);
    }
    if (bytes[0] !== 0x42 || bytes[1] !== 0x49 || bytes[2] !== 0x4b) {
      throw new Error('Not a BIK file (expected magic "BIK")');
    }

    const version = String.fromCharCode(bytes[3]!);
    const reader = new SpanReader(bytes);
    reader.seek(8);
    const frameCount = reader.readUInt32LE();
    reader.seek(20);
    const width = reader.readUInt32LE();
    const height = reader.readUInt32LE();
    const frameRateDividend = reader.readUInt32LE();
    const frameRateDivisor = reader.readUInt32LE();
    reader.skip(4); // video flags
    const audioTrackCount = reader.readUInt32LE();
    const fps = frameRateDivisor > 0 ? frameRateDividend / frameRateDivisor : 0;

    return new BikFile(version, width, height, frameCount, fps, audioTrackCount);
  }

  /** Load from a {@link DataArchiveEntry}. */
  static fromEntry(entry: DataArchiveEntry): BikFile {
    return BikFile.fromBuffer(entry.toUint8Array());
  }

  /** Load from an archive by file name. */
  static fromArchive(fileName: string, archive: DataArchive): BikFile {
    const name = fileName.endsWith('.bik') ? fileName : `${fileName}.bik`;
    const entry = archive.get(name);
    if (!entry) throw new Error(`BIK file "${fileName}" not found in archive`);
    return BikFile.fromEntry(entry);
  }

  /** Load from a file path. **Node.js only**. */
  static fromFile(path: string): BikFile {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('fs');
    const buf = fs.readFileSync(path);
    return BikFile.fromBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  }
}
