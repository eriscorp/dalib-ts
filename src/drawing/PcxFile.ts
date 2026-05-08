import type { DataArchive } from '../data/DataArchive.js';
import type { DataArchiveEntry } from '../data/DataArchiveEntry.js';

const PCX_MAGIC = 0x0a;
const PCX_PALETTE_MARKER = 0x0c;
const PCX_PALETTE_BYTES = 768;
const PCX_HEADER_LENGTH = 128;

/**
 * An 8-bits-per-pixel single-plane PCX image. The Dark Ages client only ships
 * this PCX variant; 24bpp / 3-plane PCX files are rejected.
 *
 * The trailing 256-color RGB palette is embedded in the file itself, so PCX
 * does not require a separate {@link Palette}.
 */
export class PcxFile {
  /** Image width in pixels. */
  readonly width: number;
  /** Image height in pixels. */
  readonly height: number;
  /** Bits per pixel (always 8 for the supported variant). */
  readonly bpp: number;
  /** Number of color planes (always 1 for the supported variant). */
  readonly nPlanes: number;
  /** Bytes per scanline in the encoded stream (may exceed width when PCX pads to an even byte count). */
  readonly bytesPerLine: number;
  /** Decoded palette indices, one byte per pixel, length `width * height`, indexed `[y * width + x]`. */
  readonly data: Uint8Array;
  /** Embedded 256-color palette as raw RGB triplets (768 bytes). */
  readonly palette: Uint8Array;

  private constructor(
    width: number,
    height: number,
    bpp: number,
    nPlanes: number,
    bytesPerLine: number,
    data: Uint8Array,
    palette: Uint8Array,
  ) {
    this.width = width;
    this.height = height;
    this.bpp = bpp;
    this.nPlanes = nPlanes;
    this.bytesPerLine = bytesPerLine;
    this.data = data;
    this.palette = palette;
  }

  /**
   * Parse a PCX image from a buffer. Throws on unsupported variants
   * (non-8bpp, multi-plane) or a missing trailing palette marker.
   */
  static fromBuffer(buffer: ArrayBuffer | Uint8Array): PcxFile {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length < PCX_HEADER_LENGTH) {
      throw new Error(`PCX buffer too short: ${bytes.length} bytes`);
    }
    if (bytes[0] !== PCX_MAGIC) {
      throw new Error(`Not a PCX file (expected magic 0x0A, got 0x${bytes[0]!.toString(16)})`);
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const bpp = bytes[3]!;
    const xMin = view.getUint16(4, true);
    const yMin = view.getUint16(6, true);
    const xMax = view.getUint16(8, true);
    const yMax = view.getUint16(10, true);
    const nPlanes = bytes[65]!;
    const bytesPerLine = view.getUint16(66, true);
    const width = xMax - xMin + 1;
    const height = yMax - yMin + 1;

    if (width <= 0 || height <= 0 || width > 8192 || height > 8192) {
      throw new Error(`PCX has invalid dimensions: ${width}x${height}`);
    }
    if (bpp !== 8 || nPlanes !== 1) {
      throw new Error(`Unsupported PCX variant: ${bpp}bpp, ${nPlanes} plane(s) (only 8bpp single-plane is supported)`);
    }

    const totalScanlineBytes = bytesPerLine * height;
    const scanlines = new Uint8Array(totalScanlineBytes);
    let src = PCX_HEADER_LENGTH;
    let dst = 0;
    while (dst < totalScanlineBytes && src < bytes.length) {
      const byte = bytes[src++]!;
      if ((byte & 0xc0) === 0xc0) {
        const runLen = byte & 0x3f;
        if (src >= bytes.length) break;
        const value = bytes[src++]!;
        for (let i = 0; i < runLen && dst < totalScanlineBytes; i++) {
          scanlines[dst++] = value;
        }
      } else {
        scanlines[dst++] = byte;
      }
    }

    const palOffset = bytes.length - (PCX_PALETTE_BYTES + 1);
    if (palOffset < PCX_HEADER_LENGTH || bytes[palOffset] !== PCX_PALETTE_MARKER) {
      throw new Error('PCX is missing the trailing 256-color palette marker (0x0C)');
    }
    const palette = new Uint8Array(bytes.subarray(palOffset + 1, palOffset + 1 + PCX_PALETTE_BYTES));

    // Trim per-scanline padding (bytesPerLine may exceed width when PCX pads to an even byte count).
    const data =
      bytesPerLine === width
        ? new Uint8Array(scanlines)
        : (() => {
            const out = new Uint8Array(width * height);
            for (let y = 0; y < height; y++) {
              out.set(scanlines.subarray(y * bytesPerLine, y * bytesPerLine + width), y * width);
            }
            return out;
          })();

    return new PcxFile(width, height, bpp, nPlanes, bytesPerLine, data, palette);
  }

  /** Load from a {@link DataArchiveEntry}. */
  static fromEntry(entry: DataArchiveEntry): PcxFile {
    return PcxFile.fromBuffer(entry.toUint8Array());
  }

  /** Load from an archive by file name. */
  static fromArchive(fileName: string, archive: DataArchive): PcxFile {
    const name = fileName.endsWith('.pcx') ? fileName : `${fileName}.pcx`;
    const entry = archive.get(name);
    if (!entry) throw new Error(`PCX file "${fileName}" not found in archive`);
    return PcxFile.fromEntry(entry);
  }

  /** Load from a file path. **Node.js only**. */
  static fromFile(path: string): PcxFile {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('fs');
    const buf = fs.readFileSync(path);
    return PcxFile.fromBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  }
}
