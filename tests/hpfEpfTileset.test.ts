import { describe, expect, it } from 'vitest';
import { buildArchive } from './archiveFixture.js';
import type { RgbaFrame } from '../src/constants.js';
import { HPF_TILE_WIDTH, TILE_HEIGHT, TILE_SIZE, TILE_WIDTH } from '../src/constants.js';
import { HpfFile } from '../src/drawing/HpfFile.js';
import { EpfFile } from '../src/drawing/EpfFile.js';
import { epfFrameHeight, epfFrameWidth } from '../src/drawing/EpfFrame.js';
import { Tile } from '../src/drawing/Tile.js';
import { Tileset } from '../src/drawing/Tileset.js';
import { compressHpf } from '../src/io/Compression.js';
import { SpanWriter } from '../src/io/SpanWriter.js';

describe('HpfFile', () => {
  /** 8 private header bytes then width×height palette indexes. */
  function hpfBytes(height: number): Uint8Array {
    const out = new Uint8Array(8 + HPF_TILE_WIDTH * height);
    for (let i = 0; i < 8; i++) out[i] = i;
    for (let i = 8; i < out.length; i++) out[i] = (i - 8) & 0xff;
    return out;
  }

  it('splits the eight-byte header from the pixel data', () => {
    const hpf = HpfFile.fromBuffer(hpfBytes(3));
    expect(Array.from(hpf.headerBytes)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(hpf.data).toHaveLength(HPF_TILE_WIDTH * 3);
  });

  it('is always 28 pixels wide and derives its height', () => {
    const hpf = HpfFile.fromBuffer(hpfBytes(5));
    expect(hpf.pixelWidth).toBe(HPF_TILE_WIDTH);
    expect(hpf.pixelWidth).toBe(28);
    expect(hpf.pixelHeight).toBe(5);
  });

  it('round-trips through toUint8Array', () => {
    const original = hpfBytes(4);
    expect(Array.from(HpfFile.fromBuffer(original).toUint8Array())).toEqual(Array.from(original));
  });

  // A stream that starts with 0xFF02AA55 is tree-compressed; anything else is copied
  // verbatim. The client relies on that raw fallback, so both paths must work.
  it('transparently decompresses a compressed stream', () => {
    const raw = hpfBytes(2);
    const compressed = compressHpf(raw);
    expect(new DataView(compressed.buffer, compressed.byteOffset).getUint32(0, true)).toBe(0xff02aa55);

    const hpf = HpfFile.fromBuffer(compressed);
    expect(Array.from(hpf.toUint8Array())).toEqual(Array.from(raw));
  });

  it('accepts an ArrayBuffer and a constructed instance', () => {
    const bytes = hpfBytes(1);
    expect(HpfFile.fromBuffer(bytes.buffer as ArrayBuffer).pixelHeight).toBe(1);

    const built = new HpfFile(new Uint8Array(8), new Uint8Array(HPF_TILE_WIDTH * 2));
    expect(built.pixelHeight).toBe(2);
  });
});

describe('EpfFile', () => {
  function buildTwoFrameEpf(): EpfFile {
    const epf = new EpfFile();
    epf.pixelWidth = 10;
    epf.pixelHeight = 8;
    epf.unknownBytes = new Uint8Array([0xaa, 0xbb]);
    epf.frames.push({ top: 0, left: 0, bottom: 2, right: 3, data: new Uint8Array([1, 2, 3, 4, 5, 6]) });
    epf.frames.push({ top: 1, left: 1, bottom: 3, right: 3, data: new Uint8Array([7, 8, 9, 10]) });
    return epf;
  }

  /**
   * Raw bytes shaped like the client's Legend.dat/emo32.epf: eight declared frames with
   * placeholders at 3, 4 and 5. The real file encodes a placeholder as top === bottom === 0
   * and left === right at a negative multiple of pixelWidth, with startAddress === endAddress.
   * Built by hand rather than through toUint8Array so the declared count is the fixture's own.
   */
  function placeholderEpfBytes(): Uint8Array {
    const FRAME_W = 12;
    const FRAME_H = 14;
    const FRAME_SIZE = FRAME_W * FRAME_H;
    const placeholderLefts = new Map([[3, -240], [4, -320], [5, -400]]);

    const toc: number[][] = [];
    const data = new SpanWriter();
    let address = 0;

    for (let i = 0; i < 8; i++) {
      const placeholderLeft = placeholderLefts.get(i);
      if (placeholderLeft !== undefined) {
        toc.push([0, placeholderLeft, 0, placeholderLeft, address, address]);
        continue;
      }
      data.writeBytes(new Uint8Array(FRAME_SIZE).fill(i + 1));
      toc.push([0, 0, FRAME_H, FRAME_W, address, address + FRAME_SIZE]);
      address += FRAME_SIZE;
    }

    const writer = new SpanWriter();
    writer.writeInt16LE(8);
    writer.writeInt16LE(80);
    writer.writeInt16LE(80);
    writer.writeBytes(new Uint8Array(2));
    writer.writeInt32LE(address);
    writer.writeBytes(data.toUint8Array());
    for (const [top, left, bottom, right, start, end] of toc) {
      writer.writeInt16LE(top!);
      writer.writeInt16LE(left!);
      writer.writeInt16LE(bottom!);
      writer.writeInt16LE(right!);
      writer.writeInt32LE(start!);
      writer.writeInt32LE(end!);
    }

    return writer.toUint8Array();
  }

  it('round-trips the container, frame bounds and pixels', () => {
    const source = buildTwoFrameEpf();
    const parsed = EpfFile.fromBuffer(source.toUint8Array());

    expect(parsed.pixelWidth).toBe(10);
    expect(parsed.pixelHeight).toBe(8);
    expect(Array.from(parsed.unknownBytes)).toEqual([0xaa, 0xbb]);
    expect(parsed.frames).toHaveLength(2);

    expect(parsed.frames[0]).toMatchObject({ top: 0, left: 0, bottom: 2, right: 3 });
    expect(Array.from(parsed.frames[0]!.data)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(parsed.frames[1]!.data)).toEqual([7, 8, 9, 10]);
  });

  it('derives frame dimensions from the bounds', () => {
    const parsed = EpfFile.fromBuffer(buildTwoFrameEpf().toUint8Array());
    expect(epfFrameWidth(parsed.frames[0]!)).toBe(3);
    expect(epfFrameHeight(parsed.frames[0]!)).toBe(2);
    expect(epfFrameWidth(parsed.frames[1]!)).toBe(2);
    expect(epfFrameHeight(parsed.frames[1]!)).toBe(2);
  });

  // A zero-area frame is a placeholder, not padding: upstream DALib keeps it (c9c62ee) so a
  // caller indexing by the client's animation-frame number lands on the frame the file numbers
  // that way. Dropping it shifts every later frame down one.
  it('preserves a zero-area frame with empty data, leaving later frames at their own index', () => {
    const epf = new EpfFile();
    epf.frames.push({ top: 0, left: 0, bottom: 0, right: 0, data: new Uint8Array(0) });
    // Either dimension alone being zero makes the frame a placeholder.
    epf.frames.push({ top: 4, left: 0, bottom: 4, right: 3, data: new Uint8Array(0) });
    epf.frames.push({ top: 0, left: 0, bottom: 1, right: 2, data: new Uint8Array([1, 2]) });
    const parsed = EpfFile.fromBuffer(epf.toUint8Array());
    expect(parsed.frames).toHaveLength(3);
    expect(parsed.frames[0]).toMatchObject({ top: 0, left: 0, bottom: 0, right: 0 });
    expect(parsed.frames[0]!.data).toHaveLength(0);
    expect(parsed.frames[1]).toMatchObject({ top: 4, left: 0, bottom: 4, right: 3 });
    expect(parsed.frames[1]!.data).toHaveLength(0);
    expect(Array.from(parsed.frames[2]!.data)).toEqual([1, 2]);
  });

  it('keeps one frame per declared frame, so a placeholder does not renumber later frames', () => {
    const bytes = placeholderEpfBytes();
    const declaredFrameCount = new DataView(bytes.buffer, bytes.byteOffset).getInt16(0, true);
    const parsed = EpfFile.fromBuffer(bytes);

    expect(declaredFrameCount).toBe(8);
    expect(parsed.frames).toHaveLength(declaredFrameCount);

    for (const i of [3, 4, 5]) {
      expect(epfFrameWidth(parsed.frames[i]!)).toBe(0);
      expect(parsed.frames[i]!.data).toHaveLength(0);
    }

    // Each real frame is filled with its own frame number, so a shift would be visible here.
    for (const i of [0, 1, 2, 6, 7]) {
      expect(epfFrameWidth(parsed.frames[i]!)).toBe(12);
      expect(parsed.frames[i]!.data[0]).toBe(i + 1);
    }
  });

  it('handles an EPF with no frames', () => {
    const parsed = EpfFile.fromBuffer(new EpfFile().toUint8Array());
    expect(parsed.frames).toHaveLength(0);
  });

  it('accepts an ArrayBuffer', () => {
    const bytes = buildTwoFrameEpf().toUint8Array();
    const copy = new Uint8Array(bytes);
    expect(EpfFile.fromBuffer(copy.buffer as ArrayBuffer).frames).toHaveLength(2);
  });

  it('reads from an entry, with or without the extension', () => {
    const archive = buildArchive([{ name: 'item001.epf', data: buildTwoFrameEpf().toUint8Array() }]);
    expect(EpfFile.fromEntry(archive.get('item001.epf')!).frames).toHaveLength(2);
    expect(EpfFile.fromArchive('item001', archive).frames).toHaveLength(2);
    expect(EpfFile.fromArchive('item001.epf', archive).frames).toHaveLength(2);
  });

  it('throws when the entry is missing', () => {
    expect(() => EpfFile.fromArchive('nope', buildArchive([]))).toThrow(/not found/);
  });

  describe('fromRgbaFrames', () => {
    /** An RGBA frame with one opaque pixel at (x, y); everything else transparent. */
    function dot(width: number, height: number, x: number, y: number, r: number, g: number, b: number): RgbaFrame {
      const data = new Uint8ClampedArray(width * height * 4);
      const o = (y * width + x) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
      return { width, height, data };
    }

    it('sets the sprite size from the largest source frame', () => {
      const { entity } = EpfFile.fromRgbaFrames([dot(8, 6, 0, 0, 1, 1, 1), dot(4, 10, 0, 0, 1, 1, 1)]);
      expect(entity.pixelWidth).toBe(8);
      expect(entity.pixelHeight).toBe(10);
    });

    it('crops each frame to its ink and makes the crop offset the anchor', () => {
      const { entity } = EpfFile.fromRgbaFrames([dot(8, 6, 3, 2, 255, 0, 0)]);
      expect(entity.frames[0]).toMatchObject({ left: 3, top: 2, right: 4, bottom: 3 });
      expect(entity.frames[0]!.data).toHaveLength(1);
    });

    it('quantizes every frame against one shared palette', () => {
      const { entity, palette } = EpfFile.fromRgbaFrames([
        dot(4, 4, 0, 0, 255, 0, 0),
        dot(4, 4, 0, 0, 0, 0, 255),
      ]);
      expect(entity.frames).toHaveLength(2);
      expect(palette.length).toBe(256);
      expect(entity.frames[0]!.data[0]).not.toBe(entity.frames[1]!.data[0]);
    });

    // Upstream FromImages adds every source image unconditionally, so the built file has one
    // frame per input and the caller's frame numbering survives the round trip.
    it('keeps a fully transparent frame, which crops to zero area, at its own index', () => {
      const blank: RgbaFrame = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4) };
      const { entity } = EpfFile.fromRgbaFrames([blank, dot(4, 4, 1, 1, 9, 9, 9)]);
      expect(entity.frames).toHaveLength(2);
      expect(entity.frames[0]).toMatchObject({ top: 0, left: 0, bottom: 0, right: 0 });
      expect(entity.frames[0]!.data).toHaveLength(0);
      expect(entity.frames[1]!.left).toBe(1);
    });

    it('round-trips the built file back through the parser', () => {
      const { entity } = EpfFile.fromRgbaFrames([dot(4, 4, 1, 1, 200, 100, 50)]);
      const reparsed = EpfFile.fromBuffer(entity.toUint8Array());
      expect(reparsed.pixelWidth).toBe(4);
      expect(reparsed.frames).toHaveLength(1);
      expect(Array.from(reparsed.frames[0]!.data)).toEqual(Array.from(entity.frames[0]!.data));
    });

    it('handles an empty frame list', () => {
      const { entity } = EpfFile.fromRgbaFrames([]);
      expect(entity.frames).toHaveLength(0);
      expect(entity.pixelWidth).toBe(0);
    });
  });
});

describe('Tileset', () => {
  function tilesetBytes(count: number): Uint8Array {
    const bytes = new Uint8Array(count * TILE_SIZE);
    for (let t = 0; t < count; t++) bytes.fill(t + 1, t * TILE_SIZE, (t + 1) * TILE_SIZE);
    return bytes;
  }

  it('splits a headerless bank into fixed-size tiles', () => {
    const ts = Tileset.fromBuffer(tilesetBytes(3));
    expect(ts.length).toBe(3);
    expect(ts.tiles[0]!.data).toHaveLength(TILE_SIZE);
    expect(ts.tiles[2]!.data[0]).toBe(3);
  });

  it('ignores a trailing partial record', () => {
    const bytes = new Uint8Array(TILE_SIZE * 2 + 10);
    expect(Tileset.fromBuffer(bytes).length).toBe(2);
  });

  it('round-trips through toUint8Array', () => {
    const original = tilesetBytes(2);
    expect(Array.from(Tileset.fromBuffer(original).toUint8Array())).toEqual(Array.from(original));
  });

  it('rejects a tile whose data is the wrong size on serialize', () => {
    const ts = new Tileset();
    ts.tiles.push(new Tile(new Uint8Array(10)));
    expect(() => ts.toUint8Array()).toThrow(/invalid size/);
  });

  it('accepts an ArrayBuffer', () => {
    const bytes = tilesetBytes(1);
    expect(Tileset.fromBuffer(bytes.buffer as ArrayBuffer).length).toBe(1);
  });

  it('reads from an archive entry, with or without the extension', () => {
    const archive = buildArchive([{ name: 'tilea.bmp', data: tilesetBytes(2) }]);
    expect(Tileset.fromEntry(archive.get('tilea.bmp')!).length).toBe(2);
    expect(Tileset.fromArchive('tilea', archive).length).toBe(2);
    expect(Tileset.fromArchive('tilea.bmp', archive).length).toBe(2);
  });

  it('throws when the entry is missing', () => {
    expect(() => Tileset.fromArchive('nope', buildArchive([]))).toThrow(/not found/);
  });

  describe('fromRgbaFrames', () => {
    /** A solid ground-tile-sized RGBA frame. */
    function groundFrame(r: number, g: number, b: number): RgbaFrame {
      const data = new Uint8ClampedArray(TILE_WIDTH * TILE_HEIGHT * 4);
      for (let i = 0; i < TILE_WIDTH * TILE_HEIGHT; i++) {
        data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
      }
      return { width: TILE_WIDTH, height: TILE_HEIGHT, data };
    }

    it('quantizes every frame against one shared palette', () => {
      const { entity, palette } = Tileset.fromRgbaFrames([
        groundFrame(255, 0, 0),
        groundFrame(0, 0, 255),
      ]);

      expect(entity.length).toBe(2);
      expect(palette.length).toBe(256);
      // Distinct source colors must land on distinct palette indexes.
      expect(entity.tiles[0]!.data[0]).not.toBe(entity.tiles[1]!.data[0]);
    });

    it('produces tiles of exactly TILE_SIZE, so the result serializes', () => {
      const { entity } = Tileset.fromRgbaFrames([groundFrame(10, 20, 30)]);
      expect(entity.tiles[0]!.data).toHaveLength(TILE_SIZE);
      expect(entity.toUint8Array()).toHaveLength(TILE_SIZE);
    });

    it('round-trips the quantized indexes back through the parser', () => {
      const { entity } = Tileset.fromRgbaFrames([groundFrame(200, 100, 50)]);
      const reparsed = Tileset.fromBuffer(entity.toUint8Array());
      expect(Array.from(reparsed.tiles[0]!.data)).toEqual(Array.from(entity.tiles[0]!.data));
    });

    it('handles an empty frame list', () => {
      const { entity, palette } = Tileset.fromRgbaFrames([]);
      expect(entity.length).toBe(0);
      expect(palette.length).toBe(256);
    });
  });
});

describe('Tile', () => {
  it('reports the fixed ground-tile dimensions', () => {
    const tile = new Tile(new Uint8Array(TILE_SIZE));
    expect(tile.pixelWidth).toBe(TILE_WIDTH);
    expect(tile.pixelHeight).toBe(TILE_HEIGHT);
    expect(TILE_SIZE).toBe(TILE_WIDTH * TILE_HEIGHT);
  });
});
