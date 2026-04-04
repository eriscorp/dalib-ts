import { SpanReader } from '../io/SpanReader.js';
import { SpanWriter } from '../io/SpanWriter.js';
import { MetaFileEntry } from './MetaFileEntry.js';

/**
 * A collection of metadata entries. Binary format with EUC-KR (CP949) string encoding.
 * May be stored uncompressed or zlib-compressed depending on the file.
 *
 * Structure:
 *   uint16 BE   — entry count
 *   Per entry:
 *     uint8       — name length (bytes)
 *     name bytes  — EUC-KR encoded
 *     uint16 BE   — property count
 *     Per property:
 *       uint16 BE   — value length (bytes)
 *       value bytes — EUC-KR encoded
 */
export class MetaFile {
  readonly entries: MetaFileEntry[] = [];

  // ---------------------------------------------------------------------------
  // Parsing
  // ---------------------------------------------------------------------------

  private static parseBytes(bytes: Uint8Array): MetaFile {
    const file = new MetaFile();
    const reader = new SpanReader(bytes);

    // EUC-KR is supported by TextDecoder in both browsers and Node.js with full ICU
    const decoder = new TextDecoder('euc-kr');
    const entryCount = reader.readUInt16BE();

    for (let i = 0; i < entryCount; i++) {
      const nameLen = reader.readUInt8();
      const nameBytes = reader.readBytes(nameLen);
      const name = decoder.decode(nameBytes);

      const propCount = reader.readUInt16BE();
      const properties: string[] = [];

      for (let j = 0; j < propCount; j++) {
        const propLen = reader.readUInt16BE();
        const propBytes = reader.readBytes(propLen);
        properties.push(decoder.decode(propBytes));
      }

      file.entries.push(new MetaFileEntry(name, properties));
    }

    return file;
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  toUint8Array(): Uint8Array {
    const encoder = new TextEncoder(); // UTF-8
    // MetaFile must be re-encoded as EUC-KR bytes.
    // In Node.js environments with iconv-lite or full ICU, we can encode properly.
    // Fallback: write UTF-8 bytes (lengths will differ for Korean text).
    const writer = new SpanWriter();

    writer.writeUInt16BE(this.entries.length);

    for (const entry of this.entries) {
      const nameBytes = encodeEucKr(entry.key);
      writer.writeUInt8(nameBytes.length);
      writer.writeBytes(nameBytes);
      writer.writeUInt16BE(entry.properties.length);
      for (const prop of entry.properties) {
        const propBytes = encodeEucKr(prop);
        writer.writeUInt16BE(propBytes.length);
        writer.writeBytes(propBytes);
      }
    }

    return writer.toUint8Array();
  }

  // ---------------------------------------------------------------------------
  // Factory methods
  // ---------------------------------------------------------------------------

  /**
   * Parse a MetaFile from a raw (uncompressed) buffer.
   */
  static fromBuffer(buffer: ArrayBuffer | Uint8Array): MetaFile {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return MetaFile.parseBytes(bytes);
  }

  /**
   * Parse a MetaFile from a zlib-compressed buffer.
   * Node.js: uses `zlib.inflateSync`.
   * Browser: use `fromCompressedBufferAsync`.
   */
  static fromCompressedBuffer(buffer: ArrayBuffer | Uint8Array): MetaFile {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const zlib = require('node:zlib') as typeof import('zlib');
    const decompressed = new Uint8Array(zlib.inflateSync(bytes));
    return MetaFile.parseBytes(decompressed);
  }

  /**
   * Parse a MetaFile from a zlib-compressed buffer (browser-compatible async path).
   */
  static async fromCompressedBufferAsync(buffer: ArrayBuffer | Uint8Array): Promise<MetaFile> {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

    if (typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      const chunks: Uint8Array[] = [];
      writer.write(bytes as unknown as Uint8Array<ArrayBuffer>);
      writer.close();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const total = chunks.reduce((s, c) => s + c.byteLength, 0);
      const out = new Uint8Array(total);
      let pos = 0;
      for (const c of chunks) { out.set(c, pos); pos += c.byteLength; }
      return MetaFile.parseBytes(out);
    }

    return MetaFile.fromCompressedBuffer(bytes);
  }

  /**
   * Load a MetaFile from a file path.
   * **Node.js only.**
   */
  static fromFile(path: string, isCompressed = true): MetaFile {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('fs');
    const buf = fs.readFileSync(path);
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    return isCompressed ? MetaFile.fromCompressedBuffer(bytes) : MetaFile.fromBuffer(bytes);
  }
}

// ---------------------------------------------------------------------------
// EUC-KR encoding helper
// ---------------------------------------------------------------------------

/**
 * Encode a string to EUC-KR bytes.
 * In environments with TextEncoder('euc-kr') support this works natively.
 * Elsewhere we fall back to UTF-8 (ASCII-safe for English-only metadata).
 */
function encodeEucKr(str: string): Uint8Array {
  try {
    // Some runtimes support encoding via TextEncoder
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enc = new (TextEncoder as any)('euc-kr');
    return enc.encode(str) as Uint8Array;
  } catch {
    // Fallback: UTF-8 (correct for ASCII, approximate for Korean)
    return new TextEncoder().encode(str);
  }
}
