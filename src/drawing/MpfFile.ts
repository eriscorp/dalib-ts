import type { RgbaFrame } from '../constants.js';
import type { DataArchiveEntry } from '../data/DataArchiveEntry.js';
import { MpfFormatType, MpfHeaderType, MpfIdleType } from '../enums.js';
import { SpanReader } from '../io/SpanReader.js';
import { SpanWriter } from '../io/SpanWriter.js';
import { cropTransparentPixels, preserveNonTransparentBlacks, quantizeFrames } from '../utility/ImageProcessor.js';
import type { Palettized } from '../utility/Palettized.js';
import type { MpfFrame } from './MpfFrame.js';
import { mpfFrameHeight, mpfFrameWidth } from './MpfFrame.js';

/** Frame interval used when an MPF advertises no idle animation (StaticNoIdle). */
const STATIC_NO_IDLE_INTERVAL_MS = 10_000;
/** Default idle interval when the on-disk byte is zero or an optional animation is present. */
const DEFAULT_IDLE_INTERVAL_MS = 300;
/** Floor applied to NormalIdle interval decoding so animations never run too fast. */
const MIN_NORMAL_IDLE_INTERVAL_MS = 100;

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

  /**
   * Milliseconds between frames of the idle animation.
   * - `StaticNoIdle`: {@link STATIC_NO_IDLE_INTERVAL_MS} (10 s).
   * - `NormalIdle`: decoded from the raw byte (`raw * 100`, floored to 100 ms, default 300 ms when raw is 0).
   * - `NormalPlusOptional`: always {@link DEFAULT_IDLE_INTERVAL_MS} (300 ms).
   */
  animationIntervalMs: number = 0;

  /**
   * Probability (0-255) that the optional animation plays during an idle cycle.
   * Only meaningful when {@link detectIdleType} returns {@link MpfIdleType.NormalPlusOptional}.
   */
  optionalAnimationProbability: number = 0;

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
      mpf.applyRawOptionalAnimationRatio(reader.readUInt8());
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
      mpf.applyRawOptionalAnimationRatio(reader.readUInt8());
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
  // Idle-type classification
  // ---------------------------------------------------------------------------

  /**
   * Classify an MPF's idle animation behavior from its frame counts.
   * - No optional animation frames → {@link MpfIdleType.StaticNoIdle}.
   * - Standing count is zero or equal to optional count → {@link MpfIdleType.NormalIdle}.
   * - Otherwise → {@link MpfIdleType.NormalPlusOptional}.
   */
  static detectIdleType(standingFrameCount: number, optionalAnimationFrameCount: number): MpfIdleType {
    if (optionalAnimationFrameCount === 0) return MpfIdleType.StaticNoIdle;
    if (standingFrameCount === 0 || standingFrameCount === optionalAnimationFrameCount) {
      return MpfIdleType.NormalIdle;
    }
    return MpfIdleType.NormalPlusOptional;
  }

  /** Convenience: classify this file's idle type from its frame-count fields. */
  get idleType(): MpfIdleType {
    return MpfFile.detectIdleType(this.standingFrameCount, this.optionalAnimationFrameCount);
  }

  /**
   * Decode the raw on-disk "ratio" byte into {@link animationIntervalMs} and
   * {@link optionalAnimationProbability} based on the detected idle type.
   */
  private applyRawOptionalAnimationRatio(rawRatio: number): void {
    switch (this.idleType) {
      case MpfIdleType.StaticNoIdle:
        this.animationIntervalMs = STATIC_NO_IDLE_INTERVAL_MS;
        break;
      case MpfIdleType.NormalIdle:
        this.animationIntervalMs = rawRatio > 0
          ? Math.max(MIN_NORMAL_IDLE_INTERVAL_MS, rawRatio * 100)
          : DEFAULT_IDLE_INTERVAL_MS;
        break;
      case MpfIdleType.NormalPlusOptional:
        this.animationIntervalMs = DEFAULT_IDLE_INTERVAL_MS;
        this.optionalAnimationProbability = rawRatio;
        break;
    }
  }

  /** Encode this file's semantic animation fields back into a single on-disk byte. */
  private getRawOptionalAnimationRatio(): number {
    switch (this.idleType) {
      case MpfIdleType.NormalIdle:
        return Math.max(0, Math.min(255, Math.floor(this.animationIntervalMs / 100)));
      case MpfIdleType.NormalPlusOptional:
        return Math.max(0, Math.min(255, this.optionalAnimationProbability));
      case MpfIdleType.StaticNoIdle:
      default:
        return 0;
    }
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
      writer.writeUInt8(this.getRawOptionalAnimationRatio());
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
      writer.writeUInt8(this.getRawOptionalAnimationRatio());
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
