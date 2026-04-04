import { MpfFormatType, MpfHeaderType } from '../../enums.js';
import type { DataArchive } from '../../data/DataArchive.js';
import type { DataArchiveEntry } from '../../data/DataArchiveEntry.js';
import { SpanReader } from '../../io/SpanReader.js';
import type { MpfFrame } from '../MpfFrame.js';

interface MpfTocEntry {
  top: number; left: number; bottom: number; right: number;
  centerX: number; centerY: number; startAddress: number;
}

/**
 * Lightweight view over an MPF file. Parses the header and frame TOC on construction;
 * per-frame pixel data is sliced from the archive buffer on demand.
 */
export class MpfView {
  private readonly entry: DataArchiveEntry;
  private readonly toc: MpfTocEntry[];
  private readonly dataSectionOffset: number;

  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly paletteNumber: number;
  readonly walkFrameIndex: number;
  readonly walkFrameCount: number;
  readonly attackFrameIndex: number;
  readonly attackFrameCount: number;
  readonly attack2StartIndex: number;
  readonly attack2FrameCount: number;
  readonly attack3StartIndex: number;
  readonly attack3FrameCount: number;
  readonly standingFrameIndex: number;
  readonly standingFrameCount: number;
  readonly optionalAnimationFrameCount: number;
  readonly optionalAnimationRatio: number;

  get count(): number { return this.toc.length; }

  private constructor(
    entry: DataArchiveEntry,
    dataSectionOffset: number,
    toc: MpfTocEntry[],
    pixelWidth: number,
    pixelHeight: number,
    paletteNumber: number,
    walkFrameIndex: number,
    walkFrameCount: number,
    attackFrameIndex: number,
    attackFrameCount: number,
    attack2StartIndex: number,
    attack2FrameCount: number,
    attack3StartIndex: number,
    attack3FrameCount: number,
    standingFrameIndex: number,
    standingFrameCount: number,
    optionalAnimationFrameCount: number,
    optionalAnimationRatio: number,
  ) {
    this.entry = entry;
    this.dataSectionOffset = dataSectionOffset;
    this.toc = toc;
    this.pixelWidth = pixelWidth;
    this.pixelHeight = pixelHeight;
    this.paletteNumber = paletteNumber;
    this.walkFrameIndex = walkFrameIndex;
    this.walkFrameCount = walkFrameCount;
    this.attackFrameIndex = attackFrameIndex;
    this.attackFrameCount = attackFrameCount;
    this.attack2StartIndex = attack2StartIndex;
    this.attack2FrameCount = attack2FrameCount;
    this.attack3StartIndex = attack3StartIndex;
    this.attack3FrameCount = attack3FrameCount;
    this.standingFrameIndex = standingFrameIndex;
    this.standingFrameCount = standingFrameCount;
    this.optionalAnimationFrameCount = optionalAnimationFrameCount;
    this.optionalAnimationRatio = optionalAnimationRatio;
  }

  get(index: number): MpfFrame {
    if (index < 0 || index >= this.toc.length) throw new RangeError(`MPF frame index ${index} out of range`);
    const t = this.toc[index]!;
    const width = t.right - t.left;
    const height = t.bottom - t.top;
    const buf = this.entry.toUint8Array();
    const start = this.dataSectionOffset + t.startAddress;
    return {
      top: t.top,
      left: t.left,
      bottom: t.bottom,
      right: t.right,
      centerX: t.centerX,
      centerY: t.centerY,
      startAddress: t.startAddress,
      data: new Uint8Array(buf.subarray(start, start + width * height)),
    };
  }

  tryGet(index: number): MpfFrame | undefined {
    if (index < 0 || index >= this.toc.length) return undefined;
    return this.get(index);
  }

  static fromEntry(entry: DataArchiveEntry): MpfView {
    const buf = entry.toUint8Array();
    const reader = new SpanReader(buf);

    const headerType = reader.readInt32LE() as MpfHeaderType;
    if (headerType === MpfHeaderType.Unknown) {
      const num = reader.readInt32LE();
      if (num === 4) reader.skip(8);
    } else {
      reader.seek(reader.position - 4);
    }

    let frameCount = reader.readUInt8();
    const pixelWidth = reader.readInt16LE();
    const pixelHeight = reader.readInt16LE();
    const dataLength = reader.readInt32LE();
    const walkFrameIndex = reader.readUInt8();
    const walkFrameCount = reader.readUInt8();
    const formatType = reader.readInt16LE() as MpfFormatType;

    let standingFrameIndex: number, standingFrameCount: number,
      optionalAnimationFrameCount: number, optionalAnimationRatio: number,
      attackFrameIndex: number, attackFrameCount: number,
      attack2StartIndex = 0, attack2FrameCount = 0,
      attack3StartIndex = 0, attack3FrameCount = 0;

    if (formatType === MpfFormatType.MultipleAttacks) {
      standingFrameIndex = reader.readUInt8();
      standingFrameCount = reader.readUInt8();
      optionalAnimationFrameCount = reader.readUInt8();
      optionalAnimationRatio = reader.readUInt8();
      attackFrameIndex = reader.readUInt8();
      attackFrameCount = reader.readUInt8();
      attack2StartIndex = reader.readUInt8();
      attack2FrameCount = reader.readUInt8();
      attack3StartIndex = reader.readUInt8();
      attack3FrameCount = reader.readUInt8();
    } else {
      reader.seek(reader.position - 2);
      attackFrameIndex = reader.readUInt8();
      attackFrameCount = reader.readUInt8();
      standingFrameIndex = reader.readUInt8();
      standingFrameCount = reader.readUInt8();
      optionalAnimationFrameCount = reader.readUInt8();
      optionalAnimationRatio = reader.readUInt8();
    }

    const dataSectionOffset = buf.length - dataLength;
    let paletteNumber = 0;
    const toc: MpfTocEntry[] = [];

    for (let i = 0; i < frameCount; i++) {
      const left = reader.readInt16LE();
      const top = reader.readInt16LE();
      const right = reader.readInt16LE();
      const bottom = reader.readInt16LE();
      const centerX = reader.readInt16LE();
      const centerY = reader.readInt16LE();
      const startAddress = reader.readInt32LE();

      if (left === -1 && top === -1) {
        paletteNumber = startAddress;
        frameCount--;
        continue;
      }
      toc.push({ top, left, bottom, right, centerX, centerY, startAddress });
    }

    return new MpfView(
      entry, dataSectionOffset, toc,
      pixelWidth, pixelHeight, paletteNumber,
      walkFrameIndex, walkFrameCount,
      attackFrameIndex, attackFrameCount,
      attack2StartIndex, attack2FrameCount,
      attack3StartIndex, attack3FrameCount,
      standingFrameIndex, standingFrameCount,
      optionalAnimationFrameCount, optionalAnimationRatio,
    );
  }

  static fromArchive(fileName: string, archive: DataArchive): MpfView {
    const name = fileName.endsWith('.mpf') ? fileName : `${fileName}.mpf`;
    const entry = archive.get(name);
    if (!entry) throw new Error(`MPF file "${fileName}" not found in archive`);
    return MpfView.fromEntry(entry);
  }
}
