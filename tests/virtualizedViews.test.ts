import { describe, expect, it } from 'vitest';
import { buildArchive } from './archiveFixture.js';
import { TILE_SIZE } from '../src/constants.js';
import { SpanWriter } from '../src/io/SpanWriter.js';
import { encodeRgb565 } from '../src/utility/ColorCodec.js';
import { EpfFile } from '../src/drawing/EpfFile.js';
import { SpfFile } from '../src/drawing/SpfFile.js';
import { SpfFormatType } from '../src/enums.js';
import { Palette } from '../src/drawing/Palette.js';
import { EpfView } from '../src/drawing/virtualized/EpfView.js';
import { SpfView } from '../src/drawing/virtualized/SpfView.js';
import { TilesetView } from '../src/drawing/virtualized/TilesetView.js';

describe('TilesetView', () => {
  const tilesetBytes = (count: number) => {
    const bytes = new Uint8Array(count * TILE_SIZE);
    for (let t = 0; t < count; t++) bytes.fill(t + 1, t * TILE_SIZE, (t + 1) * TILE_SIZE);
    return bytes;
  };

  it('counts tiles without reading their pixels', () => {
    const archive = buildArchive([{ name: 'tilea.bmp', data: tilesetBytes(3) }]);
    expect(TilesetView.fromArchive('tilea', archive).count).toBe(3);
  });

  it('slices a tile on demand', () => {
    const archive = buildArchive([{ name: 'tilea.bmp', data: tilesetBytes(3) }]);
    const view = TilesetView.fromArchive('tilea.bmp', archive);
    expect(view.get(1).data).toHaveLength(TILE_SIZE);
    expect(view.get(2).data[0]).toBe(3);
  });

  it('throws on an out-of-range index but tryGet returns undefined', () => {
    const view = TilesetView.fromArchive('tilea', buildArchive([{ name: 'tilea.bmp', data: tilesetBytes(1) }]));
    expect(() => view.get(5)).toThrow(RangeError);
    expect(() => view.get(-1)).toThrow(RangeError);
    expect(view.tryGet(5)).toBeUndefined();
    expect(view.tryGet(0)).toBeDefined();
  });

  it('throws when the entry is missing', () => {
    expect(() => TilesetView.fromArchive('nope', buildArchive([]))).toThrow(/not found/);
  });
});

describe('EpfView', () => {
  function epfBytes(): Uint8Array {
    const epf = new EpfFile();
    epf.pixelWidth = 8;
    epf.pixelHeight = 6;
    epf.frames.push({ top: 0, left: 0, bottom: 2, right: 3, data: new Uint8Array([1, 2, 3, 4, 5, 6]) });
    epf.frames.push({ top: 1, left: 1, bottom: 3, right: 3, data: new Uint8Array([7, 8, 9, 10]) });
    return epf.toUint8Array();
  }

  it('parses the header and TOC without decoding pixels', () => {
    const view = EpfView.fromArchive('sprite.epf', buildArchive([{ name: 'sprite.epf', data: epfBytes() }]));
    expect(view.count).toBe(2);
    expect(view.pixelWidth).toBe(8);
    expect(view.pixelHeight).toBe(6);
  });

  it('slices a frame on demand, matching the eager parser', () => {
    const bytes = epfBytes();
    const view = EpfView.fromArchive('sprite', buildArchive([{ name: 'sprite.epf', data: bytes }]));
    const eager = EpfFile.fromBuffer(bytes);

    const frame = view.get(0);
    expect(frame).toMatchObject({ top: 0, left: 0, bottom: 2, right: 3 });
    expect(Array.from(frame.data)).toEqual(Array.from(eager.frames[0]!.data));
    expect(Array.from(view.get(1).data)).toEqual(Array.from(eager.frames[1]!.data));
  });

  it('bounds-checks the frame index', () => {
    const view = EpfView.fromArchive('sprite', buildArchive([{ name: 'sprite.epf', data: epfBytes() }]));
    expect(() => view.get(99)).toThrow(RangeError);
    expect(view.tryGet(99)).toBeUndefined();
    expect(view.tryGet(0)).toBeDefined();
  });

  it('throws when the entry is missing', () => {
    expect(() => EpfView.fromArchive('nope', buildArchive([]))).toThrow(/not found/);
  });
});

describe('SpfView', () => {
  function palettizedSpf(): Uint8Array {
    const spf = new SpfFile(SpfFormatType.Palettized);
    spf.primaryColors = new Palette();
    spf.secondaryColors = new Palette();
    spf.primaryColors.set(1, { r: 255, g: 0, b: 0, a: 255 });
    spf.frames.push({
      left: 0, top: 0, right: 2, bottom: 2,
      centerX: 0, centerY: 0, flags: 0, hasCenterPoint: false,
      startAddress: 0, byteWidth: 2, byteCount: 4, imageByteCount: 4,
      data: new Uint8Array([1, 1, 1, 1]),
    });
    return spf.toUint8Array();
  }

  it('reads the frame table and the embedded palette', () => {
    const view = SpfView.fromArchive('art.spf', buildArchive([{ name: 'art.spf', data: palettizedSpf() }]));
    expect(view.count).toBe(1);
    expect(view.format).toBe(SpfFormatType.Palettized);
    expect(view.primaryColors).toBeDefined();
  });

  it('slices a frame whose pixels match the eager parser', () => {
    const bytes = palettizedSpf();
    const view = SpfView.fromArchive('art', buildArchive([{ name: 'art.spf', data: bytes }]));
    const eager = SpfFile.fromBuffer(bytes);

    const frame = view.get(0);
    expect(frame.right - frame.left).toBe(2);
    expect(Array.from(frame.data!)).toEqual(Array.from(eager.frames[0]!.data!));
  });

  it('bounds-checks the frame index', () => {
    const view = SpfView.fromArchive('art', buildArchive([{ name: 'art.spf', data: palettizedSpf() }]));
    expect(() => view.get(9)).toThrow(RangeError);
    expect(view.tryGet(9)).toBeUndefined();
  });

  it('throws when the entry is missing', () => {
    expect(() => SpfView.fromArchive('nope', buildArchive([]))).toThrow(/not found/);
  });

  describe('colorized', () => {
    function colorizedSpf(): Uint8Array {
      return SpfFile.fromColorizedRgbaFrames([
        {
          width: 2,
          height: 2,
          data: new Uint8ClampedArray([
            255, 0, 0, 255, 0, 255, 0, 255,
            0, 0, 255, 255, 255, 255, 255, 255,
          ]),
        },
      ]).toUint8Array();
    }

    it('reads direct colors and carries no embedded palette', () => {
      const view = SpfView.fromArchive('fx', buildArchive([{ name: 'fx.spf', data: colorizedSpf() }]));
      expect(view.format).toBe(SpfFormatType.Colorized);
      expect(view.primaryColors).toBeUndefined();
      expect(view.count).toBe(1);
    });

    it('slices colors that match the eager parser', () => {
      const bytes = colorizedSpf();
      const view = SpfView.fromArchive('fx', buildArchive([{ name: 'fx.spf', data: bytes }]));
      const eager = SpfFile.fromBuffer(bytes);

      const frame = view.get(0);
      expect(frame.colorData).toHaveLength(4);
      expect(frame.data).toBeUndefined();
      expect(frame.colorData![0]!.r).toBeGreaterThan(240);
      expect(frame.colorData![0]).toEqual(eager.frames[0]!.colorData![0]);
      expect(frame.colorData![2]!.b).toBeGreaterThan(240);
    });

    it('bounds-checks the frame index', () => {
      const view = SpfView.fromArchive('fx', buildArchive([{ name: 'fx.spf', data: colorizedSpf() }]));
      expect(() => view.get(1)).toThrow(RangeError);
      expect(view.tryGet(1)).toBeUndefined();
      expect(view.tryGet(0)).toBeDefined();
    });

    /**
     * The parity test above cannot catch an origin or pitch bug on its own: every
     * frame `fromColorizedRgbaFrames` builds has left = top = 0 and
     * byteWidth = width * 2, which is exactly where the correct and the incorrect
     * conventions agree. This fixture is hand-built so they diverge.
     */
    describe('with a non-zero origin and a padded pitch', () => {
      function offsetColorizedSpf(): Uint8Array {
        const left = 2, top = 1, right = 6, bottom = 4, padding = 4;
        const w = right - left, h = bottom - top;
        const stride = w * 2 + padding;
        const byteCount = stride * h;

        const wr = new SpanWriter();
        wr.writeUInt32LE(0);
        wr.writeUInt32LE(0);
        wr.writeUInt8(2); // format = Colorized
        wr.writeUInt8(0);
        wr.writeUInt8(0);
        wr.writeUInt8(0);
        wr.writeUInt32LE(1); // frameCount

        wr.writeUInt16LE(left);
        wr.writeUInt16LE(top);
        wr.writeUInt16LE(right);
        wr.writeUInt16LE(bottom);
        wr.writeInt16LE(0);
        wr.writeInt16LE(0);
        wr.writeUInt32LE(0);
        wr.writeUInt32LE(0);
        wr.writeUInt32LE(stride);
        wr.writeUInt32LE(byteCount);
        wr.writeUInt32LE(w * h);
        wr.writeUInt32LE(byteCount);

        const rowColors = [
          { r: 255, g: 0, b: 0, a: 255 },
          { r: 0, g: 255, b: 0, a: 255 },
          { r: 0, g: 0, b: 255, a: 255 },
        ];
        for (let y = 0; y < h; y++) {
          const color = rowColors[y % rowColors.length]!;
          for (let x = 0; x < w; x++) wr.writeUInt16LE(encodeRgb565(color));
          for (let p = 0; p < padding; p++) wr.writeUInt8(0);
        }

        return wr.toUint8Array();
      }

      it('reads the same pixels as the eager parser', () => {
        const bytes = offsetColorizedSpf();
        const view = SpfView.fromArchive('fx', buildArchive([{ name: 'fx.spf', data: bytes }]));
        const eager = SpfFile.fromBuffer(bytes);

        const lazy = view.get(0);
        expect(lazy.colorData).toHaveLength(eager.frames[0]!.colorData!.length);
        expect(lazy.colorData).toEqual(eager.frames[0]!.colorData);
      });

      it('sizes the frame from the bounds and honours the pitch', () => {
        const view = SpfView.fromArchive(
          'fx',
          buildArchive([{ name: 'fx.spf', data: offsetColorizedSpf() }]),
        );
        const frame = view.get(0);
        const w = 6 - 2;

        expect(frame.colorData).toHaveLength(w * (4 - 1));
        expect(frame.colorData![0]!.r).toBeGreaterThan(240);
        expect(frame.colorData![w]!.g).toBeGreaterThan(240);
        expect(frame.colorData![2 * w]!.b).toBeGreaterThan(240);
      });
    });
  });
});
