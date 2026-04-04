import type { DataArchive } from './DataArchive.js';

/**
 * A single file entry within a DataArchive (.dat) file.
 */
export class DataArchiveEntry {
  /** The archive that owns this entry. */
  readonly archive: DataArchive;
  /** File name including extension (e.g. "stc00001.spf"). */
  readonly entryName: string;
  /** Byte offset of this entry's data within the archive buffer. */
  readonly address: number;
  /** Size of this entry's data in bytes. */
  readonly fileSize: number;

  constructor(archive: DataArchive, entryName: string, address: number, fileSize: number) {
    this.archive = archive;
    this.entryName = entryName;
    this.address = address;
    this.fileSize = fileSize;
  }

  /** Return the raw bytes for this entry as a Uint8Array view (zero-copy). */
  toUint8Array(): Uint8Array {
    return this.archive.getEntryBuffer(this);
  }

  /** Return the raw bytes as a new ArrayBuffer (copy). */
  toArrayBuffer(): ArrayBuffer {
    const bytes = this.toUint8Array();
    return (bytes.buffer as ArrayBuffer).slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  /**
   * Try to parse a numeric identifier from the entry name.
   * E.g. "stc00012.spf" → 12.
   * @param numDigits Maximum number of digits to include (default: unlimited).
   * @returns The identifier, or null if not found.
   */
  tryGetNumericIdentifier(numDigits = Number.MAX_SAFE_INTEGER): number | null {
    const base = this.entryName.replace(/\.[^.]+$/, ''); // strip extension
    let start = -1;
    let end = -1;

    for (let i = 0; i < base.length; i++) {
      const ch = base.charCodeAt(i);
      if (ch >= 48 && ch <= 57) { // '0'-'9'
        if (start === -1) start = i;
        end = i;
      }
    }

    if (start === -1) return null;

    end++; // exclusive
    if (end - start > numDigits) end = start + numDigits;

    const n = parseInt(base.slice(start, end), 10);
    return isNaN(n) ? null : n;
  }
}
