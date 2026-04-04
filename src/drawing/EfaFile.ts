import { EfaBlendingType } from '../enums.js';
import type { RgbaFrame } from '../constants.js';
import type { DataArchiveEntry } from '../data/DataArchiveEntry.js';
import { SpanReader } from '../io/SpanReader.js';
import { SpanWriter } from '../io/SpanWriter.js';
import { encodeRgb565 } from '../utility/ColorCodec.js';
import type { EfaFrame } from './EfaFrame.js';

/**
 * A fully colorized, zlib-compressed animated sprite file (.efa).
 * Supports four blend modes: Additive, SelfAlpha, SeparateAlpha, PerChannelAlpha.
 * Pixel data is stored as RGB565 (2 bytes per pixel) and compressed per-frame.
 */
export class EfaFile {
  frames: EfaFrame[] = [];
  blendingType: EfaBlendingType = EfaBlendingType.Additive;
  frameIntervalMs: number = 50;
  unknown1: number = 0;
  unknown2: Uint8Array = new Uint8Array(51);

  // ---------------------------------------------------------------------------
  // Parsing (sync — requires pre-decompressed frame data)
  // ---------------------------------------------------------------------------

  private static parseHeader(bytes: Uint8Array): { file: EfaFile; frameCount: number; dataStart: number } {
    const reader = new SpanReader(bytes);
    const file = new EfaFile();

    file.unknown1 = reader.readInt32LE();
    const frameCount = reader.readInt32LE();
    file.frameIntervalMs = reader.readInt32LE();
    file.blendingType = reader.readUInt8() as EfaBlendingType;
    file.unknown2 = new Uint8Array(reader.readBytes(51));

    for (let i = 0; i < frameCount; i++) {
      const frame: EfaFrame = {
        unknown1: reader.readInt32LE(),
        startAddress: reader.readInt32LE(),
        compressedSize: reader.readInt32LE(),
        decompressedSize: reader.readInt32LE(),
        unknown2: reader.readInt32LE(),
        unknown3: reader.readInt32LE(),
        byteWidth: reader.readInt32LE(),
        unknown4: reader.readInt32LE(),
        byteCount: reader.readInt32LE(),
        unknown5: reader.readInt32LE(),
        centerX: reader.readInt16LE(),
        centerY: reader.readInt16LE(),
        unknown6: reader.readInt32LE(),
        imagePixelWidth: reader.readInt16LE(),
        imagePixelHeight: reader.readInt16LE(),
        left: reader.readInt16LE(),
        top: reader.readInt16LE(),
        framePixelWidth: reader.readInt16LE(),
        framePixelHeight: reader.readInt16LE(),
        unknown7: reader.readInt32LE(),
        data: new Uint8Array(0),
      };
      file.frames.push(frame);
    }

    return { file, frameCount, dataStart: reader.position };
  }

  // ---------------------------------------------------------------------------
  // Sync factory (Node.js / any environment with sync inflate)
  // ---------------------------------------------------------------------------

  /**
   * Parse an EfaFile synchronously from a buffer.
   * **Requires a synchronous inflate function** (e.g. Node.js `zlib.inflateSync`).
   * Pass `inflateFn` explicitly or rely on auto-detection in Node.js environments.
   */
  static fromBuffer(
    buffer: ArrayBuffer | Uint8Array,
    inflateFn?: (data: Uint8Array) => Uint8Array,
  ): EfaFile {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const { file, dataStart } = EfaFile.parseHeader(bytes);

    const inflate = inflateFn ?? getInflateSync();

    for (const frame of file.frames) {
      const compressed = bytes.subarray(
        dataStart + frame.startAddress,
        dataStart + frame.startAddress + frame.compressedSize,
      );
      const decompressed = inflate(compressed);

      frame.data = new Uint8Array(decompressed.subarray(0, frame.byteCount));

      const alphaLength = frame.decompressedSize - frame.byteCount;
      if (alphaLength > 0) {
        frame.alphaData = new Uint8Array(decompressed.subarray(frame.byteCount));
      }
    }

    return file;
  }

  /**
   * Parse an EfaFile asynchronously (browser-compatible via DecompressionStream).
   */
  static async fromBufferAsync(buffer: ArrayBuffer | Uint8Array): Promise<EfaFile> {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const { file, dataStart } = EfaFile.parseHeader(bytes);

    for (const frame of file.frames) {
      const compressed = bytes.subarray(
        dataStart + frame.startAddress,
        dataStart + frame.startAddress + frame.compressedSize,
      );
      const decompressed = await inflateAsync(compressed);

      frame.data = new Uint8Array(decompressed.subarray(0, frame.byteCount));

      const alphaLength = frame.decompressedSize - frame.byteCount;
      if (alphaLength > 0) {
        frame.alphaData = new Uint8Array(decompressed.subarray(frame.byteCount));
      }
    }

    return file;
  }

  static fromEntry(entry: DataArchiveEntry, inflateFn?: (data: Uint8Array) => Uint8Array): EfaFile {
    return EfaFile.fromBuffer(entry.toUint8Array(), inflateFn);
  }

  static fromArchive(
    fileName: string,
    archive: import('../data/DataArchive.js').DataArchive,
    inflateFn?: (data: Uint8Array) => Uint8Array,
  ): EfaFile {
    const name = fileName.endsWith('.efa') ? fileName : `${fileName}.efa`;
    const entry = archive.get(name);
    if (!entry) throw new Error(`EFA file "${fileName}" not found in archive`);
    return EfaFile.fromEntry(entry, inflateFn);
  }

  static fromFile(path: string): EfaFile {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('fs');
    const buf = fs.readFileSync(path);
    return EfaFile.fromBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  }

  /**
   * Build an EFA from an array of RGBA frames (colorized — no palette).
   * Each pixel is stored as a RGB565 word (2 bytes/pixel); transparent pixels become 0x0000.
   * Per-frame metadata (centerX, centerY, left, top) defaults to 0; set on returned frames as needed.
   *
   * @param blendingType - Defaults to {@link EfaBlendingType.Additive}.
   * @param frameIntervalMs - Animation interval in milliseconds. Defaults to 50.
   */
  static fromRgbaFrames(
    frames: RgbaFrame[],
    blendingType: EfaBlendingType = EfaBlendingType.Additive,
    frameIntervalMs: number = 50,
  ): EfaFile {
    const efa = new EfaFile();
    efa.blendingType = blendingType;
    efa.frameIntervalMs = frameIntervalMs;

    const maxWidth = frames.reduce((m, f) => Math.max(m, f.width), 0);
    const maxHeight = frames.reduce((m, f) => Math.max(m, f.height), 0);

    for (const src of frames) {
      const { width: w, height: h, data } = src;
      const byteCount = w * h * 2;
      const frameData = new Uint8Array(byteCount);
      const view = new DataView(frameData.buffer);
      for (let i = 0; i < w * h; i++) {
        const r = data[i * 4]!;
        const g = data[i * 4 + 1]!;
        const b = data[i * 4 + 2]!;
        const a = data[i * 4 + 3]!;
        const word = a === 0 ? 0 : encodeRgb565({ r, g, b, a });
        view.setUint16(i * 2, word, true);
      }
      const frame: EfaFrame = {
        unknown1: 3,
        startAddress: 0,
        compressedSize: 0,   // computed by toUint8Array()
        decompressedSize: byteCount,
        unknown2: 1,
        unknown3: 0,
        byteWidth: w * 2,
        unknown4: 4,
        byteCount,
        unknown5: 0,
        centerX: 0,
        centerY: 0,
        unknown6: 0,
        imagePixelWidth: maxWidth,
        imagePixelHeight: maxHeight,
        left: 0,
        top: 0,
        framePixelWidth: w,
        framePixelHeight: h,
        unknown7: 0,
        data: frameData,
      };
      efa.frames.push(frame);
    }
    return efa;
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  toUint8Array(deflateFn?: (data: Uint8Array) => Uint8Array): Uint8Array {
    const deflate = deflateFn ?? getDeflateSync();
    const writer = new SpanWriter();

    writer.writeInt32LE(this.unknown1);
    writer.writeInt32LE(this.frames.length);
    writer.writeInt32LE(this.frameIntervalMs);
    writer.writeUInt8(this.blendingType);
    writer.writeBytes(this.unknown2);

    const compressedFrames: Uint8Array[] = [];
    let offset = 0;

    for (const frame of this.frames) {
      const toCompress = frame.alphaData
        ? concat(frame.data, frame.alphaData)
        : frame.data;
      const compressed = deflate(toCompress);
      compressedFrames.push(compressed);

      frame.startAddress = offset;
      frame.compressedSize = compressed.byteLength;
      offset += compressed.byteLength;

      writer.writeInt32LE(frame.unknown1);
      writer.writeInt32LE(frame.startAddress);
      writer.writeInt32LE(frame.compressedSize);
      writer.writeInt32LE(frame.decompressedSize);
      writer.writeInt32LE(frame.unknown2);
      writer.writeInt32LE(frame.unknown3);
      writer.writeInt32LE(frame.byteWidth);
      writer.writeInt32LE(frame.unknown4);
      writer.writeInt32LE(frame.byteCount);
      writer.writeInt32LE(frame.unknown5);
      writer.writeInt16LE(frame.centerX);
      writer.writeInt16LE(frame.centerY);
      writer.writeInt32LE(frame.unknown6);
      writer.writeInt16LE(frame.imagePixelWidth);
      writer.writeInt16LE(frame.imagePixelHeight);
      writer.writeInt16LE(frame.left);
      writer.writeInt16LE(frame.top);
      writer.writeInt16LE(frame.framePixelWidth);
      writer.writeInt16LE(frame.framePixelHeight);
      writer.writeInt32LE(frame.unknown7);
    }

    for (const compressed of compressedFrames) {
      writer.writeBytes(compressed);
    }

    return writer.toUint8Array();
  }
}

// ---------------------------------------------------------------------------
// Inflate/deflate helpers
// ---------------------------------------------------------------------------

function getInflateSync(): (data: Uint8Array) => Uint8Array {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const zlib = require('node:zlib') as typeof import('zlib');
    return (data: Uint8Array) => new Uint8Array(zlib.inflateSync(data));
  } catch {
    throw new Error(
      'EfaFile: no inflate function available. ' +
        'Pass an inflateFn parameter, or use fromBufferAsync() in browser environments.',
    );
  }
}

function getDeflateSync(): (data: Uint8Array) => Uint8Array {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const zlib = require('node:zlib') as typeof import('zlib');
    return (data: Uint8Array) =>
      new Uint8Array(zlib.deflateSync(data, { level: 9 }));
  } catch {
    throw new Error(
      'EfaFile: no deflate function available. Pass a deflateFn parameter.',
    );
  }
}

async function inflateAsync(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    // Browser path
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];

    writer.write(data as unknown as Uint8Array<ArrayBuffer>);
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
    return out;
  }

  // Node.js path
  return getInflateSync()(data);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a);
  out.set(b, a.byteLength);
  return out;
}
