import { SpanReader } from '../io/SpanReader.js';
import { SpanWriter } from '../io/SpanWriter.js';
import type { DataArchive } from '../data/DataArchive.js';
import type { DataArchiveEntry } from '../data/DataArchiveEntry.js';

/**
 * A light/alpha map file (.hea) defining per-pixel light intensity for map darkness and lantern illumination.
 * Data is organized as horizontal strip layers of 1000px each.
 * RLE data uses (value, count) byte pairs per scanline.
 * Light values: 0 (fully dark) … MAX_LIGHT_VALUE (maximum brightness).
 */
export class HeaFile {
  static readonly MAX_LIGHT_VALUE = 0x20;
  static readonly LAYER_STRIP_WIDTH = 1000;

  screenWidth: number = 640;
  screenHeight: number = 480;
  tileWidth: number = 0;
  tileHeight: number = 0;
  /** Total pixel width of the stitched light map. */
  scanlineWidth: number = 0;
  /** Number of scanlines (pixel rows). */
  scanlineCount: number = 0;
  /** Number of horizontal strip layers. */
  layerCount: number = 0;
  /** Horizontal pixel offset for each layer (0, 1000, 2000, …). */
  thresholds: Int32Array = new Int32Array(0);
  /**
   * Scanline offset table: LayerCount × ScanlineCount entries.
   * Each value is a word offset (multiply by 2 to get byte offset into rleData).
   * Layout: [layer0_scan0, layer0_scan1, …, layer1_scan0, …]
   */
  scanlineOffsets: Int32Array = new Int32Array(0);
  /** Raw RLE-encoded light data: sequential (value, count) byte pairs per scanline. */
  rleData: Uint8Array = new Uint8Array(0);

  // ---------------------------------------------------------------------------
  // Query API
  // ---------------------------------------------------------------------------

  /** Gets the pixel width of a specific layer's horizontal strip. */
  getLayerWidth(layerIndex: number): number {
    if (layerIndex < 0 || layerIndex >= this.layerCount) {
      throw new RangeError(`layerIndex ${layerIndex} out of range`);
    }
    const start = this.thresholds[layerIndex]!;
    const end = layerIndex < this.layerCount - 1 ? this.thresholds[layerIndex + 1]! : this.scanlineWidth;
    return end - start;
  }

  /**
   * Decodes a single scanline's RLE data for the given layer.
   * Returns a new Uint8Array of length `getLayerWidth(layerIndex)`.
   */
  decodeScanline(layerIndex: number, scanlineIndex: number): Uint8Array;
  /**
   * Decodes into the provided buffer (must be at least `getLayerWidth(layerIndex)` bytes).
   */
  decodeScanline(layerIndex: number, scanlineIndex: number, buffer: Uint8Array): void;
  decodeScanline(layerIndex: number, scanlineIndex: number, buffer?: Uint8Array): Uint8Array | void {
    if (layerIndex < 0 || layerIndex >= this.layerCount) {
      throw new RangeError(`layerIndex ${layerIndex} out of range`);
    }
    if (scanlineIndex < 0 || scanlineIndex >= this.scanlineCount) {
      throw new RangeError(`scanlineIndex ${scanlineIndex} out of range`);
    }

    const layerWidth = this.getLayerWidth(layerIndex);
    const out = buffer ?? new Uint8Array(layerWidth);
    out.fill(0, 0, layerWidth);

    const tableIndex = layerIndex * this.scanlineCount + scanlineIndex;
    const wordOffset = this.scanlineOffsets[tableIndex]!;
    const byteOffset = wordOffset * 2;

    let pixelIndex = 0;
    for (let i = byteOffset; i + 1 < this.rleData.length && pixelIndex < layerWidth; i += 2) {
      const value = this.rleData[i]!;
      const count = this.rleData[i + 1]!;
      if (count === 0) continue;
      const actualCount = Math.min(count, layerWidth - pixelIndex);
      out.fill(value, pixelIndex, pixelIndex + actualCount);
      pixelIndex += actualCount;
    }

    if (!buffer) return out;
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  toUint8Array(): Uint8Array {
    const writer = new SpanWriter();
    writer.writeInt32LE(0); // padding
    writer.writeInt32LE(this.screenWidth);
    writer.writeInt32LE(this.screenHeight);
    writer.writeInt32LE(this.screenWidth);  // repeat
    writer.writeInt32LE(this.screenHeight); // repeat
    writer.writeInt32LE(this.tileWidth);
    writer.writeInt32LE(this.tileHeight);
    writer.writeInt32LE(this.scanlineWidth);
    writer.writeInt32LE(this.scanlineCount);
    writer.writeInt32LE(this.layerCount);
    for (let i = 0; i < this.layerCount; i++) writer.writeInt32LE(this.thresholds[i]!);
    const totalOffsets = this.layerCount * this.scanlineCount;
    for (let i = 0; i < totalOffsets; i++) writer.writeInt32LE(this.scanlineOffsets[i]!);
    writer.writeBytes(this.rleData);
    return writer.toUint8Array();
  }

  // ---------------------------------------------------------------------------
  // Factory methods
  // ---------------------------------------------------------------------------

  static fromBuffer(buffer: ArrayBuffer | Uint8Array): HeaFile {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const reader = new SpanReader(bytes);
    const hea = new HeaFile();

    reader.skip(4); // padding
    hea.screenWidth = reader.readInt32LE();
    hea.screenHeight = reader.readInt32LE();
    reader.skip(4); // screen width repeat
    reader.skip(4); // screen height repeat
    hea.tileWidth = reader.readInt32LE();
    hea.tileHeight = reader.readInt32LE();
    hea.scanlineWidth = reader.readInt32LE();
    hea.scanlineCount = reader.readInt32LE();
    hea.layerCount = reader.readInt32LE();

    hea.thresholds = new Int32Array(hea.layerCount);
    for (let i = 0; i < hea.layerCount; i++) hea.thresholds[i] = reader.readInt32LE();

    const totalOffsets = hea.layerCount * hea.scanlineCount;
    hea.scanlineOffsets = new Int32Array(totalOffsets);
    for (let i = 0; i < totalOffsets; i++) hea.scanlineOffsets[i] = reader.readInt32LE();

    hea.rleData = new Uint8Array(reader.readBytes(reader.remaining));

    return hea;
  }

  static fromEntry(entry: DataArchiveEntry): HeaFile {
    return HeaFile.fromBuffer(entry.toUint8Array());
  }

  static fromArchive(fileName: string | number, archive: DataArchive): HeaFile {
    const name = typeof fileName === 'number'
      ? `${String(fileName).padStart(6, '0')}.hea`
      : (fileName.endsWith('.hea') ? fileName : `${fileName}.hea`);
    const entry = archive.get(name);
    if (!entry) throw new Error(`HEA file "${name}" not found in archive`);
    return HeaFile.fromEntry(entry);
  }

  static fromFile(path: string): HeaFile {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('fs');
    const buf = fs.readFileSync(path);
    return HeaFile.fromBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  }

  /**
   * Create a HeaFile from an RgbaFrame by mapping the alpha channel to RLE light data.
   * Alpha 0 → light 0 (fully dark); alpha 255 → MAX_LIGHT_VALUE.
   * If the frame is smaller than the full padded light map, it is centered with dark padding.
   */
  static fromRgbaFrame(
    frame: { width: number; height: number; data: Uint8ClampedArray },
    tileWidth: number,
    tileHeight: number,
  ): HeaFile {
    const SCREEN_WIDTH = 640;
    const SCREEN_HEIGHT = 480;
    const scanW = 28 * (tileWidth + tileHeight) + SCREEN_WIDTH * 2;
    const scanH = 14 * (tileWidth + tileHeight) + SCREEN_HEIGHT * 2;
    const padX = Math.floor((scanW - frame.width) / 2);
    const padY = Math.floor((scanH - frame.height) / 2);
    const layerCount = Math.ceil(scanW / HeaFile.LAYER_STRIP_WIDTH);

    const hea = new HeaFile();
    hea.screenWidth = SCREEN_WIDTH;
    hea.screenHeight = SCREEN_HEIGHT;
    hea.tileWidth = tileWidth;
    hea.tileHeight = tileHeight;
    hea.scanlineWidth = scanW;
    hea.scanlineCount = scanH;
    hea.layerCount = layerCount;

    hea.thresholds = new Int32Array(layerCount);
    for (let i = 0; i < layerCount; i++) hea.thresholds[i] = i * HeaFile.LAYER_STRIP_WIDTH;

    const splitSet = new Set<number>();
    for (let i = 0; i < layerCount; i++) splitSet.add(hea.thresholds[i]!);

    const scanlineOffsets = new Int32Array(layerCount * scanH);
    const rleChunks: Uint8Array[] = [];
    let wordOffset = 0;

    const sampleLight = (gx: number, gy: number): number => {
      const ix = gx - padX;
      const iy = gy - padY;
      if (ix < 0 || ix >= frame.width || iy < 0 || iy >= frame.height) return 0;
      const alpha = frame.data[(iy * frame.width + ix) * 4 + 3]!;
      return Math.round((alpha * HeaFile.MAX_LIGHT_VALUE + 127) / 255);
    };

    for (let y = 0; y < scanH; y++) {
      let nextThreshold = 0;
      let pixelIndex = 0;

      while (pixelIndex < scanW) {
        if (splitSet.has(pixelIndex)) {
          scanlineOffsets[nextThreshold * scanH + y] = wordOffset;
          nextThreshold++;
        }

        const value = sampleLight(pixelIndex, y);
        let count = 1;

        while (pixelIndex + count < scanW) {
          if (splitSet.has(pixelIndex + count)) break;
          const nextVal = sampleLight(pixelIndex + count, y);
          if (nextVal !== value || count >= 255) break;
          count++;
        }

        rleChunks.push(new Uint8Array([value, count]));
        wordOffset++;
        pixelIndex += count;
      }
    }

    hea.scanlineOffsets = scanlineOffsets;
    const totalBytes = rleChunks.reduce((s, c) => s + c.length, 0);
    const rleData = new Uint8Array(totalBytes);
    let pos = 0;
    for (const chunk of rleChunks) { rleData.set(chunk, pos); pos += chunk.length; }
    hea.rleData = rleData;

    return hea;
  }
}
