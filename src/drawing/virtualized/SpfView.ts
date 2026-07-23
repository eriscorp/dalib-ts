import { SpfFormatType } from '../../enums.js';
import type { Color } from '../../constants.js';
import { TRANSPARENT } from '../../constants.js';
import type { DataArchive } from '../../data/DataArchive.js';
import type { DataArchiveEntry } from '../../data/DataArchiveEntry.js';
import { SpanReader } from '../../io/SpanReader.js';
import { decodeRgb565, decodeRgb555 } from '../../utility/ColorCodec.js';
import { Palette } from '../Palette.js';
import type { SpfFrame } from '../SpfFrame.js';

interface SpfTocEntry {
  left: number; top: number; right: number; bottom: number;
  centerX: number; centerY: number; flags: number;
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
      centerX: t.centerX,
      centerY: t.centerY,
      flags: t.flags,
      hasCenterPoint: (t.flags & 1) !== 0,
      startAddress: t.startAddress,
      byteWidth: t.byteWidth,
      byteCount: t.byteCount,
      imageByteCount: t.imageByteCount,
    };

    if (this.format === SpfFormatType.Palettized) {
      frame.data = new Uint8Array(buf.subarray(dataStart, dataStart + t.byteCount));
    } else {
      // Colorized: RGB565 color words. This must match SpfFile.readColorized exactly —
      // the bounds give the visible rectangle, and rows advance by the frame's own
      // pitch, which is not always the row's byte width.
      const w = t.right - t.left;
      const h = t.bottom - t.top;
      const stride = t.byteWidth > 0 ? t.byteWidth : w * 2;
      const pixels = buf.subarray(dataStart, dataStart + t.byteCount);

      const colorData = new Array<Color>(w * h);
      for (let y = 0; y < h; y++) {
        const rowOffset = y * stride;
        for (let x = 0; x < w; x++) {
          const at = rowOffset + x * 2;
          colorData[y * w + x] =
            at + 1 < pixels.length
              ? decodeRgb565(pixels[at]! | (pixels[at + 1]! << 8))
              : TRANSPARENT;
        }
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
    // +0x08 pixel mode and +0x09 palette mode are separate bytes, followed by two
    // unidentified bytes at +0x0A. The embedded palette block is only present when
    // both mode bytes are zero.
    const format = reader.readUInt8() as SpfFormatType;
    const paletteMode = reader.readUInt8();
    reader.skip(2); // reserved mode bytes

    let primaryColors: Palette | undefined;
    let secondaryColors: Palette | undefined;

    if (format === SpfFormatType.Palettized && paletteMode === 0) {
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
        centerX: reader.readInt16LE(),
        centerY: reader.readInt16LE(),
        flags: reader.readUInt32LE(),
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
