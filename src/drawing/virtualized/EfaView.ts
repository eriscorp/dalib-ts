import { EfaBlendingType } from '../../enums.js';
import type { DataArchive } from '../../data/DataArchive.js';
import type { DataArchiveEntry } from '../../data/DataArchiveEntry.js';
import { SpanReader } from '../../io/SpanReader.js';
import type { EfaFrame } from '../EfaFrame.js';

interface EfaTocEntry {
  unknown1: number; startAddress: number; compressedSize: number; decompressedSize: number;
  unknown2: number; unknown3: number; byteWidth: number; unknown4: number;
  byteCount: number; unknown5: number;
  centerX: number; centerY: number; unknown6: number;
  imagePixelWidth: number; imagePixelHeight: number;
  left: number; top: number; framePixelWidth: number; framePixelHeight: number;
  unknown7: number;
}

/**
 * Lightweight view over an EFA file. Parses the header and frame TOC on construction;
 * frame zlib decompression is deferred until the frame is accessed.
 */
export class EfaView {
  private readonly entry: DataArchiveEntry;
  private readonly toc: EfaTocEntry[];
  private readonly dataSectionOffset: number;
  private readonly inflateFn: ((data: Uint8Array) => Uint8Array) | undefined;

  readonly blendingType: EfaBlendingType;
  readonly frameIntervalMs: number;

  get count(): number { return this.toc.length; }

  private constructor(
    entry: DataArchiveEntry,
    dataSectionOffset: number,
    toc: EfaTocEntry[],
    blendingType: EfaBlendingType,
    frameIntervalMs: number,
    inflateFn?: (data: Uint8Array) => Uint8Array,
  ) {
    this.entry = entry;
    this.dataSectionOffset = dataSectionOffset;
    this.toc = toc;
    this.blendingType = blendingType;
    this.frameIntervalMs = frameIntervalMs;
    this.inflateFn = inflateFn;
  }

  get(index: number): EfaFrame {
    if (index < 0 || index >= this.toc.length) throw new RangeError(`EFA frame index ${index} out of range`);
    const t = this.toc[index]!;
    const buf = this.entry.toUint8Array();
    const compressed = buf.subarray(
      this.dataSectionOffset + t.startAddress,
      this.dataSectionOffset + t.startAddress + t.compressedSize,
    );
    const inflate = this.inflateFn ?? getInflateSync();
    const decompressed = inflate(compressed);
    const data = new Uint8Array(decompressed.subarray(0, t.byteCount));
    const alphaLength = t.decompressedSize - t.byteCount;
    const frame: EfaFrame = {
      unknown1: t.unknown1, startAddress: t.startAddress, compressedSize: t.compressedSize,
      decompressedSize: t.decompressedSize, unknown2: t.unknown2, unknown3: t.unknown3,
      byteWidth: t.byteWidth, unknown4: t.unknown4, byteCount: t.byteCount, unknown5: t.unknown5,
      centerX: t.centerX, centerY: t.centerY, unknown6: t.unknown6,
      imagePixelWidth: t.imagePixelWidth, imagePixelHeight: t.imagePixelHeight,
      left: t.left, top: t.top, framePixelWidth: t.framePixelWidth, framePixelHeight: t.framePixelHeight,
      unknown7: t.unknown7, data,
    };
    if (alphaLength > 0) frame.alphaData = new Uint8Array(decompressed.subarray(t.byteCount));
    return frame;
  }

  tryGet(index: number): EfaFrame | undefined {
    if (index < 0 || index >= this.toc.length) return undefined;
    return this.get(index);
  }

  /**
   * Decompress the frame at `index` asynchronously (browser-compatible via DecompressionStream).
   */
  async getAsync(index: number): Promise<EfaFrame> {
    if (index < 0 || index >= this.toc.length) throw new RangeError(`EFA frame index ${index} out of range`);
    const t = this.toc[index]!;
    const buf = this.entry.toUint8Array();
    const compressed = buf.subarray(
      this.dataSectionOffset + t.startAddress,
      this.dataSectionOffset + t.startAddress + t.compressedSize,
    );
    const decompressed = await inflateAsync(compressed);
    const data = new Uint8Array(decompressed.subarray(0, t.byteCount));
    const alphaLength = t.decompressedSize - t.byteCount;
    const frame: EfaFrame = {
      unknown1: t.unknown1, startAddress: t.startAddress, compressedSize: t.compressedSize,
      decompressedSize: t.decompressedSize, unknown2: t.unknown2, unknown3: t.unknown3,
      byteWidth: t.byteWidth, unknown4: t.unknown4, byteCount: t.byteCount, unknown5: t.unknown5,
      centerX: t.centerX, centerY: t.centerY, unknown6: t.unknown6,
      imagePixelWidth: t.imagePixelWidth, imagePixelHeight: t.imagePixelHeight,
      left: t.left, top: t.top, framePixelWidth: t.framePixelWidth, framePixelHeight: t.framePixelHeight,
      unknown7: t.unknown7, data,
    };
    if (alphaLength > 0) frame.alphaData = new Uint8Array(decompressed.subarray(t.byteCount));
    return frame;
  }

  static fromEntry(entry: DataArchiveEntry, inflateFn?: (data: Uint8Array) => Uint8Array): EfaView {
    const buf = entry.toUint8Array();
    const reader = new SpanReader(buf);

    reader.skip(4); // unknown1
    const frameCount = reader.readInt32LE();
    const frameIntervalMs = reader.readInt32LE();
    const blendingType = reader.readUInt8() as EfaBlendingType;
    reader.skip(51); // unknown2

    const toc: EfaTocEntry[] = [];
    for (let i = 0; i < frameCount; i++) {
      toc.push({
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
      });
    }

    return new EfaView(entry, reader.position, toc, blendingType, frameIntervalMs, inflateFn);
  }

  static fromArchive(
    fileName: string,
    archive: DataArchive,
    inflateFn?: (data: Uint8Array) => Uint8Array,
  ): EfaView {
    const name = fileName.endsWith('.efa') ? fileName : `${fileName}.efa`;
    const entry = archive.get(name);
    if (!entry) throw new Error(`EFA file "${fileName}" not found in archive`);
    return EfaView.fromEntry(entry, inflateFn);
  }
}

function getInflateSync(): (data: Uint8Array) => Uint8Array {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const zlib = require('node:zlib') as typeof import('zlib');
    return (data: Uint8Array) => new Uint8Array(zlib.inflateSync(data));
  } catch {
    throw new Error('EfaView: no inflate function available. Use getAsync() in browser environments.');
  }
}

async function inflateAsync(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
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
  return getInflateSync()(data);
}
