import { DATA_ARCHIVE_ENTRY_NAME_LENGTH } from '../constants.js';
import { SpanReader } from '../io/SpanReader.js';
import { SpanWriter } from '../io/SpanWriter.js';
import { DataArchiveEntry } from './DataArchiveEntry.js';

const HEADER_LENGTH = 4;
const ENTRY_HEADER_LENGTH = HEADER_LENGTH + DATA_ARCHIVE_ENTRY_NAME_LENGTH; // 4 + 13 = 17

export type DataArchiveWarningKind = 'duplicate-entry-name' | 'empty-entry-name';

export interface DataArchiveWarning {
  kind: DataArchiveWarningKind;
  entryName: string;
  /** Index in the archive's entry table where the warning was triggered. */
  index: number;
}

export interface DataArchiveOptions {
  /** Set true for the alternate "new format" entry layout (12-byte name + 20 unknown bytes). */
  newFormat?: boolean;
  /** Optional diagnostic callback invoked when a malformed/duplicate entry is encountered. */
  onWarning?: (warning: DataArchiveWarning) => void;
}

/**
 * A Dark Ages data archive (.dat file).
 *
 * Entries are stored in a case-insensitive map keyed by entryName.
 * The underlying buffer is held in memory — there is no memory-mapped
 * equivalent in the JS port (use fromFile for Node.js, fromBuffer for browsers).
 *
 * Duplicate or empty entry names are tolerated to match the official client's
 * behavior (real archives such as `WorldMap.dat` contain them). Note that not every
 * `.dat` file is an archive — `sotp.dat` and `album.dat` merely share the extension
 * and have their own unrelated layouts.
 * Duplicates are preserved in `entries` for iteration; the lookup map keeps
 * the first occurrence so `archive.get(name)` is deterministic. Pass
 * `onWarning` in {@link DataArchiveOptions} to surface diagnostics.
 */
export class DataArchive {
  /** Ordered list of all entries in the archive. */
  readonly entries: DataArchiveEntry[] = [];

  /** Case-insensitive lookup map: entryName.toLowerCase() → entry. */
  private readonly entryMap = new Map<string, DataArchiveEntry>();

  /** The raw archive data. The entries' `address` fields index into this. */
  private buffer: Uint8Array;

  private constructor(buffer: Uint8Array, options: DataArchiveOptions = {}) {
    this.buffer = buffer;
    const { newFormat = false, onWarning } = options;
    const reader = new SpanReader(buffer);

    // `file_archive_open` recognizes a second, XOR-obfuscated layout with a zlib-compressed
    // index whenever the first word is 0xFFFFFFFF. No sample of it is known to exist, so
    // reject it explicitly rather than reading its header as a (huge) entry count.
    if (buffer.length >= 4 && reader.readUInt32LE() === 0xffffffff) {
      throw new Error('Extended DAT archive format (0xFFFFFFFF header) is not supported');
    }
    reader.seek(0);

    const expectedCount = reader.readInt32LE() - 1;

    for (let i = 0; i < expectedCount; i++) {
      const startAddress = reader.readInt32LE();
      const nameLength = newFormat ? 12 : DATA_ARCHIVE_ENTRY_NAME_LENGTH;
      const name = reader.readFixedAscii(nameLength);

      if (newFormat) reader.skip(20); // unknown bytes

      const endAddress = reader.readInt32LE();
      reader.seek(reader.position - 4); // peek-back, like the C# code

      const fileSize = endAddress - startAddress;

      if (name.length === 0) {
        onWarning?.({ kind: 'empty-entry-name', entryName: name, index: i });
      }

      this.addEntry(new DataArchiveEntry(this, name, startAddress, fileSize), i, onWarning);
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Total number of entries in the archive. */
  get size(): number {
    return this.entries.length;
  }

  /** Check whether an entry with the given name exists (case-insensitive). */
  has(entryName: string): boolean {
    return this.entryMap.has(entryName.toLowerCase());
  }

  /** Get an entry by name (case-insensitive), or undefined if not found. */
  get(entryName: string): DataArchiveEntry | undefined {
    return this.entryMap.get(entryName.toLowerCase());
  }

  /** Get entries whose names end with `extension` (e.g. ".spf"). */
  getEntriesByExtension(extension: string): DataArchiveEntry[] {
    const ext = extension.toLowerCase();
    return this.entries.filter(e => e.entryName.toLowerCase().endsWith(ext));
  }

  /** Get entries whose names start with `pattern` and end with `extension`. */
  getEntriesByPattern(pattern: string, extension: string): DataArchiveEntry[] {
    const p = pattern.toLowerCase();
    const ext = extension.toLowerCase();
    return this.entries.filter(e => {
      const n = e.entryName.toLowerCase();
      return n.startsWith(p) && n.endsWith(ext);
    });
  }

  /** Return the raw bytes for a given entry (zero-copy view into the archive buffer). */
  getEntryBuffer(entry: DataArchiveEntry): Uint8Array {
    return this.buffer.subarray(entry.address, entry.address + entry.fileSize);
  }

  /**
   * Sort entries using the same logic as the C# DataArchive.Sort():
   *  1. Entries whose base name is a pure integer sort numerically by that integer.
   *  2. Otherwise split into prefix / numericId / tail / extension groups.
   *  3. Sort: prefix (underscore-first) → numericId (numeric) → tail → extension.
   */
  sort(): void {
    const ENTRY_NAME_REGEX = /^([a-zA-Z_]*)(\d*)([a-zA-Z_]*)$/;

    interface Parts {
      entry: DataArchiveEntry;
      prefix: string;
      numericId: string;
      tail: string;
      extension: string;
    }

    const parsed: Parts[] = this.entries.map(entry => {
      const dotIdx = entry.entryName.lastIndexOf('.');
      const base = dotIdx >= 0 ? entry.entryName.slice(0, dotIdx) : entry.entryName;
      const ext = dotIdx >= 0 ? entry.entryName.slice(dotIdx) : '';

      if (/^\d+$/.test(base)) {
        return { entry, prefix: base, numericId: '', tail: '', extension: ext };
      }

      const m = ENTRY_NAME_REGEX.exec(base);
      return m
        ? { entry, prefix: m[1]!, numericId: m[2]!, tail: m[3]!, extension: ext }
        : { entry, prefix: base, numericId: '', tail: '', extension: ext };
    });

    // Determine common numeric identifier length per prefix
    const prefixGroups = new Map<string, Parts[]>();
    for (const p of parsed) {
      const key = p.prefix.toLowerCase();
      let g = prefixGroups.get(key);
      if (!g) { g = []; prefixGroups.set(key, g); }
      g.push(p);
    }

    const commonIdLen = new Map<string, number>();
    for (const [key, group] of prefixGroups) {
      const lengths = group.map(p => p.numericId.length).sort((a, b) => a - b).slice(0, 3);
      commonIdLen.set(key, lengths.find(l => l > 0) ?? 0);
    }

    // Correct parts: move excess digits from numericId to tail
    const corrected = parsed.map(p => {
      const common = commonIdLen.get(p.prefix.toLowerCase()) ?? 0;
      if (p.numericId.length > common) {
        return {
          ...p,
          numericId: p.numericId.slice(0, common),
          tail: p.numericId.slice(common) + p.tail,
        };
      }
      return p;
    });

    corrected.sort((a, b) => {
      // 1. prefix (underscore-first)
      const pc = preferUnderscoreCompare(a.prefix, b.prefix);
      if (pc !== 0) return pc;

      // 2. numeric id
      const aKey = a.prefix.toLowerCase();
      const bKey = b.prefix.toLowerCase();
      const aLen = commonIdLen.get(aKey) ?? 0;
      const bLen = commonIdLen.get(bKey) ?? 0;

      const aNum = (aLen === 0 || a.numericId.length < aLen) ? -1 : parseInt(a.numericId, 10);
      const bNum = (bLen === 0 || b.numericId.length < bLen) ? -1 : parseInt(b.numericId, 10);

      if (aNum !== bNum) return aNum - bNum;

      // 3. tail
      const tc = preferUnderscoreCompare(a.tail, b.tail);
      if (tc !== 0) return tc;

      // 4. extension
      return preferUnderscoreCompare(a.extension, b.extension);
    });

    this.entries.length = 0;
    for (const { entry } of corrected) this.entries.push(entry);
  }

  /**
   * Serialize the archive back to a Uint8Array in the standard .dat format.
   * Note: entries are written in their current order; call sort() first if needed.
   */
  toUint8Array(): Uint8Array {
    const fileCount = this.entries.length;

    // Pre-gather entry data
    const entryBuffers = this.entries.map(e => this.getEntryBuffer(e));

    // Compute addresses
    let address = HEADER_LENGTH + fileCount * ENTRY_HEADER_LENGTH + 4;
    const addresses: number[] = [];
    for (const buf of entryBuffers) {
      addresses.push(address);
      address += buf.byteLength;
    }

    const writer = new SpanWriter(address + 4);

    // Header: number of entries + 1
    writer.writeInt32LE(fileCount + 1);

    // Entry headers
    for (let i = 0; i < fileCount; i++) {
      writer.writeInt32LE(addresses[i]!);
      writer.writeFixedAscii(this.entries[i]!.entryName, DATA_ARCHIVE_ENTRY_NAME_LENGTH);
    }

    // Final entry: end address (total size)
    writer.writeInt32LE(address);

    // Entry data
    for (const buf of entryBuffers) {
      writer.writeBytes(buf);
    }

    return writer.toUint8Array();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private addEntry(
    entry: DataArchiveEntry,
    index: number,
    onWarning?: (warning: DataArchiveWarning) => void,
  ): void {
    const key = entry.entryName.toLowerCase();
    this.entries.push(entry);
    if (this.entryMap.has(key)) {
      onWarning?.({ kind: 'duplicate-entry-name', entryName: entry.entryName, index });
      return;
    }
    this.entryMap.set(key, entry);
  }

  // ---------------------------------------------------------------------------
  // Static factory methods
  // ---------------------------------------------------------------------------

  /**
   * Parse a DataArchive from an ArrayBuffer or Uint8Array.
   * Works in both Node.js and browsers.
   *
   * Pass either {@link DataArchiveOptions} or, for backwards compatibility,
   * a boolean equivalent to `{ newFormat: <bool> }`.
   */
  static fromBuffer(
    buffer: ArrayBuffer | Uint8Array,
    optionsOrNewFormat: DataArchiveOptions | boolean = {},
  ): DataArchive {
    const options = resolveOptions(optionsOrNewFormat);
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return new DataArchive(bytes, options);
  }

  /**
   * Load a DataArchive from a file path.
   * **Node.js only** — will throw in a browser environment.
   */
  static fromFile(
    path: string,
    optionsOrNewFormat: DataArchiveOptions | boolean = {},
  ): DataArchive {
    // Dynamic import to avoid bundling fs in browser builds
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('fs');
    const buf = fs.readFileSync(path);
    return DataArchive.fromBuffer(
      new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
      optionsOrNewFormat,
    );
  }

  /**
   * Compile a directory of files into a new archive buffer.
   * **Node.js only** — will throw in a browser environment.
   */
  static compileFromDirectory(dirPath: string): Uint8Array {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('path');

    const files = fs.readdirSync(dirPath).map((f: string) => path.join(dirPath, f));
    const fileCount = files.length;

    let address = HEADER_LENGTH + fileCount * ENTRY_HEADER_LENGTH + 4;
    const fileData: Uint8Array[] = [];
    const addresses: number[] = [];
    const names: string[] = [];

    for (const file of files) {
      const name = path.basename(file);
      if (name.length > DATA_ARCHIVE_ENTRY_NAME_LENGTH) {
        throw new Error(`Entry name too long (max ${DATA_ARCHIVE_ENTRY_NAME_LENGTH}): ${name}`);
      }
      const data = fs.readFileSync(file);
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      addresses.push(address);
      address += bytes.byteLength;
      fileData.push(bytes);
      names.push(name);
    }

    const writer = new SpanWriter(address + 4);
    writer.writeInt32LE(fileCount + 1);

    for (let i = 0; i < fileCount; i++) {
      writer.writeInt32LE(addresses[i]!);
      writer.writeFixedAscii(names[i]!, DATA_ARCHIVE_ENTRY_NAME_LENGTH);
    }

    writer.writeInt32LE(address);
    for (const buf of fileData) writer.writeBytes(buf);

    return writer.toUint8Array();
  }
}

function resolveOptions(input: DataArchiveOptions | boolean): DataArchiveOptions {
  return typeof input === 'boolean' ? { newFormat: input } : input;
}

/** String comparison that sorts underscore-prefixed strings before others. */
function preferUnderscoreCompare(a: string, b: string): number {
  const aU = a.startsWith('_');
  const bU = b.startsWith('_');
  if (aU && !bU) return -1;
  if (!aU && bU) return 1;
  return a.toLowerCase().localeCompare(b.toLowerCase());
}
