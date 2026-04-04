import type { DataArchive } from '../../data/DataArchive.js';
import type { DataArchiveEntry } from '../../data/DataArchiveEntry.js';
import { SpanReader } from '../../io/SpanReader.js';
import type { EpfFrame } from '../EpfFrame.js';

const HEADER_LENGTH = 12;
const TOC_ENTRY_SIZE = 16;

interface EpfTocEntry {
  top: number; left: number; bottom: number; right: number;
  startAddress: number; endAddress: number;
}

/**
 * Lightweight view over an EPF file. Parses the header and TOC on construction;
 * per-frame pixel data is sliced from the archive buffer on demand.
 */
export class EpfView {
  private readonly entry: DataArchiveEntry;
  private readonly toc: EpfTocEntry[];
  private readonly tocAddress: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;

  get count(): number { return this.toc.length; }

  private constructor(
    entry: DataArchiveEntry,
    pixelWidth: number,
    pixelHeight: number,
    tocAddress: number,
    toc: EpfTocEntry[],
  ) {
    this.entry = entry;
    this.pixelWidth = pixelWidth;
    this.pixelHeight = pixelHeight;
    this.tocAddress = tocAddress;
    this.toc = toc;
  }

  get(index: number): EpfFrame {
    if (index < 0 || index >= this.toc.length) throw new RangeError(`EPF frame index ${index} out of range`);
    const t = this.toc[index]!;
    const buf = this.entry.toUint8Array();
    const width = t.right - t.left;
    const height = t.bottom - t.top;
    const dataLen = (t.endAddress - t.startAddress) === width * height
      ? t.endAddress - t.startAddress
      : this.tocAddress - t.startAddress;
    return {
      top: t.top,
      left: t.left,
      bottom: t.bottom,
      right: t.right,
      data: new Uint8Array(buf.subarray(HEADER_LENGTH + t.startAddress, HEADER_LENGTH + t.startAddress + dataLen)),
    };
  }

  tryGet(index: number): EpfFrame | undefined {
    if (index < 0 || index >= this.toc.length) return undefined;
    return this.get(index);
  }

  static fromEntry(entry: DataArchiveEntry): EpfView {
    const buf = entry.toUint8Array();
    const reader = new SpanReader(buf);

    const frameCount = reader.readInt16LE();
    const pixelWidth = reader.readInt16LE();
    const pixelHeight = reader.readInt16LE();
    reader.skip(2);
    const tocAddress = reader.readInt32LE();

    const toc: EpfTocEntry[] = [];

    for (let i = 0; i < frameCount; i++) {
      // TOC starts at HEADER_LENGTH + tocAddress
      reader.seek(HEADER_LENGTH + tocAddress + i * TOC_ENTRY_SIZE);
      const top = reader.readInt16LE();
      const left = reader.readInt16LE();
      const bottom = reader.readInt16LE();
      const right = reader.readInt16LE();
      const startAddress = reader.readInt32LE();
      const endAddress = reader.readInt32LE();

      if ((right - left) === 0 || (bottom - top) === 0) continue;
      toc.push({ top, left, bottom, right, startAddress, endAddress });
    }

    return new EpfView(entry, pixelWidth, pixelHeight, tocAddress, toc);
  }

  static fromArchive(fileName: string, archive: DataArchive): EpfView {
    const name = fileName.endsWith('.epf') ? fileName : `${fileName}.epf`;
    const entry = archive.get(name);
    if (!entry) throw new Error(`EPF file "${fileName}" not found in archive`);
    return EpfView.fromEntry(entry);
  }
}
