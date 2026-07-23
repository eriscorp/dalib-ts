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

  it('skips a zero-area frame', () => {
    const epf = new EpfFile();
    epf.frames.push({ top: 0, left: 0, bottom: 0, right: 0, data: new Uint8Array(0) });
    epf.frames.push({ top: 0, left: 0, bottom: 1, right: 2, data: new Uint8Array([1, 2]) });
    const parsed = EpfFile.fromBuffer(epf.toUint8Array());
    expect(parsed.frames).toHaveLength(1);
    expect(Array.from(parsed.frames[0]!.data)).toEqual([1, 2]);
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
