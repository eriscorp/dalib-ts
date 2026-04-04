import { SpfFormatType } from '../../enums.js';
import type { DataArchive } from '../../data/DataArchive.js';
import type { DataArchiveEntry } from '../../data/DataArchiveEntry.js';
import { SpanReader } from '../../io/SpanReader.js';
import { decodeRgb565, decodeRgb555 } from '../../utility/ColorCodec.js';
import { Palette } from '../Palette.js';
import type { SpfFrame } from '../SpfFrame.js';

interface SpfTocEntry {
  left: number; top: number; right: number; bottom: number;
  unknown1: number; unknown2: number;
  startAddress: number; byteWidth: number; byteCount: number; imageByteCount: number;
}

/**
 * Lightweight view over an SPF file. Parses the header, palettes, and frame TOC on construction;
 * per-frame pixel data is sliced from the archive buffer on demand.
 */
export class SpfView {
  private readonly entry: DataArchiveEntry;
  private readonly toc: SpfTocEntry[];
  private readonly dataSectionOffset: number;

  readonly format: SpfFormatType;
  readonly primaryColors: Palette | undefined;
  readonly secondaryColors: Palette | undefined;

  get count(): number { return this.toc.length; }

  private constructor(
    entry: DataArchiveEntry,
    dataSectionOffset: number,
    toc: SpfTocEntry[],
    format: SpfFormatType,
    primaryColors: Palette | undefined,
    secondaryColors: Palette | undefined,
  ) {
    this.entry = entry;
    this.dataSectionOffset = dataSectionOffset;
    this.toc = toc;
    this.format = format;
    this.primaryColors = primaryColors;
    this.secondaryColors = secondaryColors;
  }

  get(index: number): SpfFrame {
    if (index < 0 || index >= this.toc.length) throw new RangeError(`SPF frame index ${index} out of range`);
    const t = this.toc[index]!;
    const buf = this.entry.toUint8Array();
    const dataStart = this.dataSectionOffset + t.startAddress;

    const frame: SpfFrame = {
      left: t.left, top: t.top, right: t.right, bottom: t.bottom,
      unknown2: t.unknown2,
      startAddress: t.startAddress,
      byteWidth: t.byteWidth,
      byteCount: t.byteCount,
      imageByteCount: t.imageByteCount,
    };

    if (this.format === SpfFormatType.Palettized) {
      frame.data = new Uint8Array(buf.subarray(dataStart, dataStart + t.byteCount));
    } else {
      // Colorized: read RGB565 color words
      const colorData = [];
      const reader = new SpanReader(buf);
      reader.seek(dataStart);
      const pixelCount = t.bottom * t.right;
      for (let i = 0; i < pixelCount; i++) {
        colorData.push(decodeRgb565(reader.readUInt16LE()));
      }
      frame.colorData = colorData;
    }

    return frame;
  }

  tryGet(index: number): SpfFrame | undefined {
    if (index < 0 || index >= this.toc.length) return undefined;
    return this.get(index);
  }

  static fromEntry(entry: DataArchiveEntry): SpfView {
    const buf = entry.toUint8Array();
    const reader = new SpanReader(buf);

    reader.skip(4); // unknown1
    reader.skip(4); // unknown2
    const format = reader.readUInt32LE() as SpfFormatType;

    let primaryColors: Palette | undefined;
    let secondaryColors: Palette | undefined;

    if (format === SpfFormatType.Palettized) {
      primaryColors = new Palette();
      secondaryColors = new Palette();
      for (let i = 0; i < 256; i++) primaryColors.colors[i] = decodeRgb565(reader.readUInt16LE());
      for (let i = 0; i < 256; i++) secondaryColors.colors[i] = decodeRgb555(reader.readUInt16LE());
    }

    const frameCount = reader.readUInt32LE();
    const toc: SpfTocEntry[] = [];

    for (let i = 0; i < frameCount; i++) {
      toc.push({
        left: reader.readUInt16LE(),
        top: reader.readUInt16LE(),
        right: reader.readUInt16LE(),
        bottom: reader.readUInt16LE(),
        unknown1: reader.readUInt32LE(),
        unknown2: reader.readUInt32LE(),
        startAddress: reader.readUInt32LE(),
        byteWidth: reader.readUInt32LE(),
        byteCount: reader.readUInt32LE(),
        imageByteCount: reader.readUInt32LE(),
      });
    }

    reader.skip(4); // totalByteCount
    const dataSectionOffset = reader.position;

    return new SpfView(entry, dataSectionOffset, toc, format, primaryColors, secondaryColors);
  }

  static fromArchive(fileName: string, archive: DataArchive): SpfView {
    const name = fileName.endsWith('.spf') ? fileName : `${fileName}.spf`;
    const entry = archive.get(name);
    if (!entry) throw new Error(`SPF file "${fileName}" not found in archive`);
    return SpfView.fromEntry(entry);
  }
}
