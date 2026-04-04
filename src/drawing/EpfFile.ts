import type { RgbaFrame } from '../constants.js';
import type { DataArchiveEntry } from '../data/DataArchiveEntry.js';
import { SpanReader } from '../io/SpanReader.js';
import { SpanWriter } from '../io/SpanWriter.js';
import { cropTransparentPixels, preserveNonTransparentBlacks, quantizeFrames } from '../utility/ImageProcessor.js';
import type { Palettized } from '../utility/Palettized.js';
import type { EpfFrame } from './EpfFrame.js';
import { epfFrameHeight, epfFrameWidth } from './EpfFrame.js';

const HEADER_LENGTH = 12;

/**
 * A palettized animation sprite file (.epf).
 * Format: 12-byte header, followed by concatenated frame pixel data, then a TOC (table of contents).
 */
export class EpfFile {
  frames: EpfFrame[] = [];
  pixelWidth: number = 0;
  pixelHeight: number = 0;
  unknownBytes: Uint8Array = new Uint8Array(2);

  private static parse(bytes: Uint8Array): EpfFile {
    const epf = new EpfFile();
    const headerReader = new SpanReader(bytes);

    const frameCount = headerReader.readInt16LE();
    epf.pixelWidth = headerReader.readInt16LE();
    epf.pixelHeight = headerReader.readInt16LE();
    epf.unknownBytes = new Uint8Array(headerReader.readBytes(2));
    const tocAddress = headerReader.readInt32LE();

    // Segment starts after the 12-byte header
    const segReader = new SpanReader(bytes.subarray(HEADER_LENGTH));

    for (let i = 0; i < frameCount; i++) {
      segReader.seek(tocAddress + i * 16);

      const top = segReader.readInt16LE();
      const left = segReader.readInt16LE();
      const bottom = segReader.readInt16LE();
      const right = segReader.readInt16LE();

      const w = right - left;
      const h = bottom - top;

      const startAddress = segReader.readInt32LE();
      const endAddress = segReader.readInt32LE();

      if (w === 0 || h === 0) continue;

      segReader.seek(startAddress);

      const expectedSize = endAddress - startAddress;
      const actualData = expectedSize === w * h
        ? segReader.readBytes(expectedSize)
        : segReader.readBytes(tocAddress - startAddress);

      epf.frames.push({
        top,
        left,
        bottom,
        right,
        data: new Uint8Array(actualData),
      });
    }

    return epf;
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  toUint8Array(): Uint8Array {
    const writer = new SpanWriter();

    writer.writeInt16LE(this.frames.length);
    writer.writeInt16LE(this.pixelWidth);
    writer.writeInt16LE(this.pixelHeight);
    writer.writeBytes(this.unknownBytes);

    const footerStartAddress = this.frames.reduce(
      (sum, f) => sum + Math.min(f.data.length, epfFrameWidth(f) * epfFrameHeight(f)),
      0,
    );

    writer.writeInt32LE(footerStartAddress);

    // Frame data
    for (const frame of this.frames) {
      const length = Math.min(frame.data.length, epfFrameWidth(frame) * epfFrameHeight(frame));
      writer.writeBytes(frame.data.subarray(0, length));
    }

    // TOC entries
    let dataIndex = 0;
    for (const frame of this.frames) {
      const length = Math.min(frame.data.length, epfFrameWidth(frame) * epfFrameHeight(frame));
      writer.writeInt16LE(frame.top);
      writer.writeInt16LE(frame.left);
      writer.writeInt16LE(frame.bottom);
      writer.writeInt16LE(frame.right);
      writer.writeInt32LE(dataIndex);
      writer.writeInt32LE(dataIndex + length);
      dataIndex += length;
    }

    return writer.toUint8Array();
  }

  // ---------------------------------------------------------------------------
  // Factory methods
  // ---------------------------------------------------------------------------

  static fromBuffer(buffer: ArrayBuffer | Uint8Array): EpfFile {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return EpfFile.parse(bytes);
  }

  static fromEntry(entry: DataArchiveEntry): EpfFile {
    return EpfFile.fromBuffer(entry.toUint8Array());
  }

  static fromArchive(fileName: string, archive: import('../data/DataArchive.js').DataArchive): EpfFile {
    const name = fileName.endsWith('.epf') ? fileName : `${fileName}.epf`;
    const entry = archive.get(name);
    if (!entry) throw new Error(`EPF file "${fileName}" not found in archive`);
    return EpfFile.fromEntry(entry);
  }

  static fromFile(path: string): EpfFile {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('fs');
    const buf = fs.readFileSync(path);
    return EpfFile.fromBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  }

  /**
   * Build a palettized EPF from an array of RGBA frames using Wu color quantization.
   * Each frame is cropped to its non-transparent bounding box; the crop offset becomes
   * the frame's anchor (left/top). All frames share a single 256-color palette.
   *
   * @returns A {@link Palettized} wrapper containing the EPF and its shared palette.
   */
  static fromRgbaFrames(frames: RgbaFrame[]): Palettized<EpfFile> {
    const epf = new EpfFile();
    epf.pixelWidth = frames.reduce((m, f) => Math.max(m, f.width), 0);
    epf.pixelHeight = frames.reduce((m, f) => Math.max(m, f.height), 0);

    const processed = frames.map(preserveNonTransparentBlacks);
    const crops = processed.map(cropTransparentPixels);
    const croppedFrames = crops.map(c => c.frame);

    const { palette, indexedFrames } = quantizeFrames(croppedFrames);

    for (let i = 0; i < frames.length; i++) {
      const { offsetX, offsetY } = crops[i]!;
      const { width: w, height: h } = croppedFrames[i]!;
      if (w === 0 || h === 0) continue;
      epf.frames.push({
        top: offsetY,
        left: offsetX,
        bottom: offsetY + h,
        right: offsetX + w,
        data: indexedFrames[i]!,
      });
    }
    return { entity: epf, palette };
  }
}
