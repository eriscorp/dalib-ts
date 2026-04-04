import type { RgbaFrame } from '../constants.js';
import type { DataArchiveEntry } from '../data/DataArchiveEntry.js';
import { SpanReader } from '../io/SpanReader.js';
import { SpanWriter } from '../io/SpanWriter.js';
import { cropTransparentPixels, preserveNonTransparentBlacks, quantizeFrames } from '../utility/ImageProcessor.js';
import type { Palettized } from '../utility/Palettized.js';
import type { MpfFrame } from './MpfFrame.js';
import { mpfFrameHeight, mpfFrameWidth } from './MpfFrame.js';

export const enum MpfHeaderType {
  Unknown = -1,
  None = 0,
}

export const enum MpfFormatType {
  MultipleAttacks = -1,
  SingleAttack = 0,
}

/**
 * A stop-motion animation file (.mpf).
 * Contains palettized frames with animation metadata (walk/stand/attack indices/counts).
 */
export class MpfFile {
  frames: MpfFrame[] = [];

  headerType: MpfHeaderType = MpfHeaderType.None;
  formatType: MpfFormatType = MpfFormatType.SingleAttack;
  unknownHeaderBytes: Uint8Array = new Uint8Array(0);

  pixelWidth: number = 0;
  pixelHeight: number = 0;
  paletteNumber: number = 0;

  walkFrameIndex: number = 0;
  walkFrameCount: number = 0;

  standingFrameIndex: number = 0;
  standingFrameCount: number = 0;
  optionalAnimationFrameCount: number = 0;
  optionalAnimationRatio: number = 0;

  attackFrameIndex: number = 0;
  attackFrameCount: number = 0;
  attack2StartIndex: number = 0;
  attack2FrameCount: number = 0;
  attack3StartIndex: number = 0;
  attack3FrameCount: number = 0;

  private static parse(bytes: Uint8Array): MpfFile {
    const mpf = new MpfFile();
    const reader = new SpanReader(bytes);

    const headerInt = reader.readInt32LE();
    mpf.headerType = headerInt as MpfHeaderType;

    if (mpf.headerType === MpfHeaderType.Unknown) {
      const headerBytes = reader.readBytes(4);
      const num = new DataView(headerBytes.buffer, headerBytes.byteOffset, 4).getInt32(0, true);
      if (num === 4) {
        const more = reader.readBytes(8);
        const combined = new Uint8Array(12);
        combined.set(headerBytes);
        combined.set(more, 4);
        mpf.unknownHeaderBytes = combined;
      } else {
        mpf.unknownHeaderBytes = new Uint8Array(headerBytes);
      }
    } else {
      // Seek back — headerType is None (0), actual frame count follows
      reader.seek(reader.position - 4);
      mpf.unknownHeaderBytes = new Uint8Array(0);
    }

    let frameCount = reader.readUInt8();
    mpf.pixelWidth = reader.readInt16LE();
    mpf.pixelHeight = reader.readInt16LE();
    const dataLength = reader.readInt32LE();

    mpf.walkFrameIndex = reader.readUInt8();
    mpf.walkFrameCount = reader.readUInt8();

    mpf.formatType = reader.readInt16LE() as MpfFormatType;

    if (mpf.formatType === MpfFormatType.MultipleAttacks) {
      mpf.standingFrameIndex = reader.readUInt8();
      mpf.standingFrameCount = reader.readUInt8();
      mpf.optionalAnimationFrameCount = reader.readUInt8();
      mpf.optionalAnimationRatio = reader.readUInt8();
      mpf.attackFrameIndex = reader.readUInt8();
      mpf.attackFrameCount = reader.readUInt8();
      mpf.attack2StartIndex = reader.readUInt8();
      mpf.attack2FrameCount = reader.readUInt8();
      mpf.attack3StartIndex = reader.readUInt8();
      mpf.attack3FrameCount = reader.readUInt8();
    } else {
      // Seek back 2 (re-read formatType as attackFrameIndex + attackFrameCount)
      reader.seek(reader.position - 2);
      mpf.attackFrameIndex = reader.readUInt8();
      mpf.attackFrameCount = reader.readUInt8();
      mpf.standingFrameIndex = reader.readUInt8();
      mpf.standingFrameCount = reader.readUInt8();
      mpf.optionalAnimationFrameCount = reader.readUInt8();
      mpf.optionalAnimationRatio = reader.readUInt8();
    }

    // Data segment starts at (totalLength - dataLength)
    const dataStart = bytes.length - dataLength;

    for (let i = 0; i < frameCount; i++) {
      const left = reader.readInt16LE();
      const top = reader.readInt16LE();
      const right = reader.readInt16LE();
      const bottom = reader.readInt16LE();
      const centerX = reader.readInt16LE();
      const centerY = reader.readInt16LE();
      const startAddress = reader.readInt32LE();

      // Palette "frame" marker: left = -1 (0xFFFF as int16), top = -1
      if (left === -1 && top === -1) {
        mpf.paletteNumber = startAddress;
        frameCount--;
        continue;
      }

      const w = right - left;
      const h = bottom - top;

      mpf.frames.push({
        left,
        top,
        right,
        bottom,
        centerX,
        centerY,
        startAddress,
        data: bytes.subarray(dataStart + startAddress, dataStart + startAddress + w * h),
      });
    }

    return mpf;
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  toUint8Array(): Uint8Array {
    const writer = new SpanWriter();

    if (this.headerType === MpfHeaderType.Unknown) {
      writer.writeInt32LE(this.headerType);
      writer.writeBytes(this.unknownHeaderBytes);
    }

    const frameCount = this.frames.length + 1; // +1 for palette "frame"
    writer.writeUInt8(frameCount);
    writer.writeInt16LE(this.pixelWidth);
    writer.writeInt16LE(this.pixelHeight);

    const dataLength = this.frames.reduce((sum, f) => sum + f.data.length, 0);
    writer.writeInt32LE(dataLength);
    writer.writeUInt8(this.walkFrameIndex);
    writer.writeUInt8(this.walkFrameCount);

    if (this.formatType === MpfFormatType.MultipleAttacks) {
      writer.writeInt16LE(this.formatType);
      writer.writeUInt8(this.standingFrameIndex);
      writer.writeUInt8(this.standingFrameCount);
      writer.writeUInt8(this.optionalAnimationFrameCount);
      writer.writeUInt8(this.optionalAnimationRatio);
      writer.writeUInt8(this.attackFrameIndex);
      writer.writeUInt8(this.attackFrameCount);
      writer.writeUInt8(this.attack2StartIndex);
      writer.writeUInt8(this.attack2FrameCount);
      writer.writeUInt8(this.attack3StartIndex);
      writer.writeUInt8(this.attack3FrameCount);
    } else {
      writer.writeUInt8(this.attackFrameIndex);
      writer.writeUInt8(this.attackFrameCount);
      writer.writeUInt8(this.standingFrameIndex);
      writer.writeUInt8(this.standingFrameCount);
      writer.writeUInt8(this.optionalAnimationFrameCount);
      writer.writeUInt8(this.optionalAnimationRatio);
    }

    let startAddress = 0;
    for (const frame of this.frames) {
      writer.writeInt16LE(frame.left);
      writer.writeInt16LE(frame.top);
      writer.writeInt16LE(frame.right);
      writer.writeInt16LE(frame.bottom);
      writer.writeInt16LE(frame.centerX);
      writer.writeInt16LE(frame.centerY);
      frame.startAddress = startAddress;
      startAddress += frame.data.length;
      writer.writeInt32LE(frame.startAddress);
    }

    // Palette "frame": 12 × 0xFF + paletteNumber
    const palBuf = new Uint8Array(12).fill(0xff);
    writer.writeBytes(palBuf);
    writer.writeInt32LE(this.paletteNumber);

    for (const frame of this.frames) {
      writer.writeBytes(frame.data);
    }

    return writer.toUint8Array();
  }

  // ---------------------------------------------------------------------------
  // Factory methods
  // ---------------------------------------------------------------------------

  static fromBuffer(buffer: ArrayBuffer | Uint8Array): MpfFile {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return MpfFile.parse(bytes);
  }

  static fromEntry(entry: DataArchiveEntry): MpfFile {
    return MpfFile.fromBuffer(entry.toUint8Array());
  }

  static fromArchive(fileName: string, archive: import('../data/DataArchive.js').DataArchive): MpfFile {
    const name = fileName.endsWith('.mpf') ? fileName : `${fileName}.mpf`;
    const entry = archive.get(name);
    if (!entry) throw new Error(`MPF file "${fileName}" not found in archive`);
    return MpfFile.fromEntry(entry);
  }

  static fromFile(path: string): MpfFile {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('fs');
    const buf = fs.readFileSync(path);
    return MpfFile.fromBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  }

  /**
   * Build a palettized MPF from an array of RGBA frames using Wu color quantization.
   * Each frame is cropped to its non-transparent bounding box; the crop offset becomes
   * the frame's anchor (left/top). All frames share a single 256-color palette.
   *
   * Animation metadata (walkFrameIndex, attackFrameIndex, etc.) defaults to 0.
   * Set the returned mpf's properties to configure the animation indices.
   *
   * @returns A {@link Palettized} wrapper containing the MPF and its shared palette.
   */
  static fromRgbaFrames(frames: RgbaFrame[]): Palettized<MpfFile> {
    const mpf = new MpfFile();
    mpf.pixelWidth = frames.reduce((m, f) => Math.max(m, f.width), 0);
    mpf.pixelHeight = frames.reduce((m, f) => Math.max(m, f.height), 0);

    const processed = frames.map(preserveNonTransparentBlacks);
    const crops = processed.map(cropTransparentPixels);
    const croppedFrames = crops.map(c => c.frame);

    const { palette, indexedFrames } = quantizeFrames(croppedFrames);

    for (let i = 0; i < frames.length; i++) {
      const { offsetX, offsetY } = crops[i]!;
      const { width: w, height: h } = croppedFrames[i]!;
      if (w === 0 || h === 0) continue;
      const frame: MpfFrame = {
        left: offsetX,
        top: offsetY,
        right: offsetX + w,
        bottom: offsetY + h,
        centerX: 0,
        centerY: 0,
        startAddress: 0,
        data: indexedFrames[i]!,
      };
      mpf.frames.push(frame);
    }
    return { entity: mpf, palette };
  }
}
