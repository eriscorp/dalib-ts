import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildArchive } from './archiveFixture.js';
import { EfaFile } from '../src/drawing/EfaFile.js';
import { MpfFile } from '../src/drawing/MpfFile.js';
import { EfaView } from '../src/drawing/virtualized/EfaView.js';
import { MpfView } from '../src/drawing/virtualized/MpfView.js';
import { EfaBlendingType, MpfFormatType, MpfHeaderType } from '../src/enums.js';
import type { RgbaFrame } from '../src/constants.js';
import type { MpfFrame } from '../src/drawing/MpfFrame.js';

const deflate = (d: Uint8Array) => new Uint8Array(deflateSync(Buffer.from(d)));
const inflate = (d: Uint8Array) => new Uint8Array(inflateSync(Buffer.from(d)));

// ---------------------------------------------------------------------------
// MpfView
// ---------------------------------------------------------------------------

describe('MpfView', () => {
  /** A frame whose pixels are a distinct constant, so a mis-sliced frame is obvious. */
  function frame(left: number, top: number, w: number, h: number, fill: number): MpfFrame {
    return {
      left,
      top,
      right: left + w,
      bottom: top + h,
      centerX: 1,
      centerY: 2,
      startAddress: 0,
      data: new Uint8Array(w * h).fill(fill),
    };
  }

  /** Build a serialized MPF and return both the bytes and the source object. */
  function buildMpf(configure: (mpf: MpfFile) => void = () => {}): Uint8Array {
    const mpf = new MpfFile();
    mpf.pixelWidth = 16;
    mpf.pixelHeight = 16;
    mpf.paletteNumber = 77;
    mpf.walkFrameIndex = 1;
    mpf.walkFrameCount = 2;
    mpf.attackFrameIndex = 3;
    mpf.attackFrameCount = 4;
    mpf.standingFrameCount = 4;
    mpf.optionalAnimationFrameCount = 4;
    mpf.frames.push(frame(0, 0, 4, 3, 0x11), frame(2, 1, 5, 2, 0x22));
    configure(mpf);
    return mpf.toUint8Array();
  }

  const viewOf = (bytes: Uint8Array) =>
    MpfView.fromArchive('mon', buildArchive([{ name: 'mon.mpf', data: bytes }]));

  it('excludes the palette sentinel from the frame count', () => {
    // The on-disk count includes a sentinel record; only real frames are addressable.
    const view = viewOf(buildMpf());
    expect(view.count).toBe(2);
    expect(view.paletteNumber).toBe(77);
  });

  it('exposes the same header fields as the eager parser', () => {
    const bytes = buildMpf();
    const view = viewOf(bytes);
    const eager = MpfFile.fromBuffer(bytes);

    expect(view.pixelWidth).toBe(eager.pixelWidth);
    expect(view.pixelHeight).toBe(eager.pixelHeight);
    expect(view.paletteNumber).toBe(eager.paletteNumber);
    expect(view.walkFrameIndex).toBe(eager.walkFrameIndex);
    expect(view.walkFrameCount).toBe(eager.walkFrameCount);
    expect(view.attackFrameIndex).toBe(eager.attackFrameIndex);
    expect(view.attackFrameCount).toBe(eager.attackFrameCount);
    expect(view.standingFrameIndex).toBe(eager.standingFrameIndex);
    expect(view.standingFrameCount).toBe(eager.standingFrameCount);
    expect(view.optionalAnimationFrameCount).toBe(eager.optionalAnimationFrameCount);
  });

  it('slices frame pixels that match the eager parser', () => {
    const bytes = buildMpf();
    const view = viewOf(bytes);
    const eager = MpfFile.fromBuffer(bytes);

    for (let i = 0; i < view.count; i++) {
      const lazy = view.get(i);
      const want = eager.frames[i]!;
      expect(lazy).toMatchObject({
        left: want.left, top: want.top, right: want.right, bottom: want.bottom,
        centerX: want.centerX, centerY: want.centerY, startAddress: want.startAddress,
      });
      expect(Array.from(lazy.data)).toEqual(Array.from(want.data));
    }
  });

  it('sizes each frame from its own bounds, not the sprite bounds', () => {
    const view = viewOf(buildMpf());
    expect(view.get(0).data).toHaveLength(4 * 3);
    expect(view.get(1).data).toHaveLength(5 * 2);
    expect(view.get(1).data[0]).toBe(0x22);
  });

  it('copies the sliced pixels rather than aliasing the archive buffer', () => {
    const view = viewOf(buildMpf());
    const first = view.get(0);
    first.data[0] = 0x99;
    expect(view.get(0).data[0]).toBe(0x11);
  });

  it('reads the SingleAttack layout, where the format field is re-read as attack bytes', () => {
    // SingleAttack has no explicit format word: the parser seeks back two bytes and
    // reads them as attackFrameIndex and attackFrameCount.
    const bytes = buildMpf(mpf => {
      mpf.formatType = MpfFormatType.SingleAttack;
      mpf.attackFrameIndex = 9;
      mpf.attackFrameCount = 5;
    });
    const view = viewOf(bytes);
    const eager = MpfFile.fromBuffer(bytes);

    expect(view.attackFrameIndex).toBe(9);
    expect(view.attackFrameCount).toBe(5);
    expect(view.attackFrameIndex).toBe(eager.attackFrameIndex);
    expect(view.count).toBe(2);
  });

  it('reads the MultipleAttacks layout, including the second and third attack runs', () => {
    const bytes = buildMpf(mpf => {
      mpf.formatType = MpfFormatType.MultipleAttacks;
      mpf.attack2StartIndex = 6;
      mpf.attack2FrameCount = 2;
      mpf.attack3StartIndex = 8;
      mpf.attack3FrameCount = 3;
    });
    const view = viewOf(bytes);

    expect(view.attack2StartIndex).toBe(6);
    expect(view.attack2FrameCount).toBe(2);
    expect(view.attack3StartIndex).toBe(8);
    expect(view.attack3FrameCount).toBe(3);
  });

  it('skips a fixed four-byte unknown header when the flags run bit is clear', () => {
    const bytes = buildMpf(mpf => {
      mpf.headerType = MpfHeaderType.Unknown;
      mpf.unknownHeaderBytes = new Uint8Array([0x01, 0x00, 0x00, 0x00]); // bit 2 clear
    });
    const view = viewOf(bytes);
    expect(view.count).toBe(2);
    expect(view.pixelWidth).toBe(16);
  });

  it('skips a variable-length unknown header whose count is greater than one', () => {
    // Flags bit 2 set means a u32 count follows, then count × 4 bytes. A fixed
    // eight-byte skip would be correct only for count === 1 and would desync
    // every field after the header.
    const unknown = new Uint8Array(8 + 3 * 4);
    const view32 = new DataView(unknown.buffer);
    view32.setInt32(0, 4, true); // flags: run bit set
    view32.setInt32(4, 3, true); // count
    const bytes = buildMpf(mpf => {
      mpf.headerType = MpfHeaderType.Unknown;
      mpf.unknownHeaderBytes = unknown;
    });

    const view = viewOf(bytes);
    const eager = MpfFile.fromBuffer(bytes);
    expect(view.count).toBe(2);
    expect(view.pixelWidth).toBe(16);
    expect(view.paletteNumber).toBe(eager.paletteNumber);
    expect(Array.from(view.get(1).data)).toEqual(Array.from(eager.frames[1]!.data));
  });

  it('handles a file whose only record is the palette sentinel', () => {
    const view = viewOf(buildMpf(mpf => { mpf.frames.length = 0; }));
    expect(view.count).toBe(0);
    expect(view.paletteNumber).toBe(77);
    expect(view.tryGet(0)).toBeUndefined();
  });

  it('bounds-checks the frame index', () => {
    const view = viewOf(buildMpf());
    expect(() => view.get(2)).toThrow(RangeError);
    expect(() => view.get(-1)).toThrow(RangeError);
    expect(view.tryGet(2)).toBeUndefined();
    expect(view.tryGet(-1)).toBeUndefined();
    expect(view.tryGet(0)).toBeDefined();
  });

  it('appends the extension when the caller omits it', () => {
    const archive = buildArchive([{ name: 'mon.mpf', data: buildMpf() }]);
    expect(MpfView.fromArchive('mon', archive).count).toBe(2);
    expect(MpfView.fromArchive('mon.mpf', archive).count).toBe(2);
  });

  it('throws when the entry is missing', () => {
    expect(() => MpfView.fromArchive('nope', buildArchive([]))).toThrow(/not found/);
  });
});

// ---------------------------------------------------------------------------
// EfaView
// ---------------------------------------------------------------------------

describe('EfaView', () => {
  /** A solid RGBA frame. */
  function solid(width: number, height: number, r: number, g: number, b: number): RgbaFrame {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
    }
    return { width, height, data };
  }

  function buildEfa(): Uint8Array {
    const efa = EfaFile.fromRgbaFrames(
      [solid(4, 3, 255, 0, 0), solid(2, 2, 0, 0, 255)],
      EfaBlendingType.SelfAlpha,
      120,
    );
    return efa.toUint8Array(deflate);
  }

  const viewOf = (bytes: Uint8Array, inflateFn?: (d: Uint8Array) => Uint8Array) =>
    EfaView.fromArchive('spell', buildArchive([{ name: 'spell.efa', data: bytes }]), inflateFn);

  it('reads the header and frame table without decompressing anything', () => {
    const view = viewOf(buildEfa(), inflate);
    expect(view.count).toBe(2);
    expect(view.blendingType).toBe(EfaBlendingType.SelfAlpha);
    expect(view.frameIntervalMs).toBe(120);
  });

  it('decompresses a frame that matches the eager parser', () => {
    const bytes = buildEfa();
    const view = viewOf(bytes, inflate);
    const eager = EfaFile.fromBuffer(bytes, inflate);

    for (let i = 0; i < view.count; i++) {
      const lazy = view.get(i);
      const want = eager.frames[i]!;
      expect(lazy).toMatchObject({
        framePixelWidth: want.framePixelWidth,
        framePixelHeight: want.framePixelHeight,
        byteWidth: want.byteWidth,
        byteCount: want.byteCount,
        compressedSize: want.compressedSize,
        startAddress: want.startAddress,
      });
      expect(Array.from(lazy.data)).toEqual(Array.from(want.data));
    }
  });

  it('falls back to the Node inflate when no function is supplied', () => {
    const view = viewOf(buildEfa());
    expect(view.get(0).data.length).toBe(4 * 3 * 2);
  });

  it('getAsync returns the same frame as the sync path', async () => {
    const view = viewOf(buildEfa(), inflate);
    const sync = view.get(1);
    const async = await view.getAsync(1);
    expect(Array.from(async.data)).toEqual(Array.from(sync.data));
    expect(async.framePixelWidth).toBe(sync.framePixelWidth);
  });

  it('splits trailing alpha bytes out of the decompressed payload', () => {
    // decompressedSize exceeds byteCount, so the tail is a separate alpha plane.
    const efa = EfaFile.fromRgbaFrames([solid(2, 2, 1, 2, 3)]);
    const alpha = new Uint8Array([9, 8, 7, 6]);
    efa.frames[0]!.alphaData = alpha;
    efa.frames[0]!.decompressedSize = efa.frames[0]!.byteCount + alpha.length;

    const view = viewOf(efa.toUint8Array(deflate), inflate);
    const frame = view.get(0);
    expect(frame.data.length).toBe(2 * 2 * 2);
    expect(Array.from(frame.alphaData!)).toEqual([9, 8, 7, 6]);
  });

  it('leaves alphaData unset when the payload holds pixels only', () => {
    expect(viewOf(buildEfa(), inflate).get(0).alphaData).toBeUndefined();
  });

  it('getAsync also splits the alpha plane', async () => {
    const efa = EfaFile.fromRgbaFrames([solid(2, 1, 1, 2, 3)]);
    efa.frames[0]!.alphaData = new Uint8Array([4, 5]);
    efa.frames[0]!.decompressedSize = efa.frames[0]!.byteCount + 2;

    const frame = await viewOf(efa.toUint8Array(deflate), inflate).getAsync(0);
    expect(Array.from(frame.alphaData!)).toEqual([4, 5]);
  });

  it('handles a file with no frames', () => {
    const view = viewOf(EfaFile.fromRgbaFrames([]).toUint8Array(deflate), inflate);
    expect(view.count).toBe(0);
    expect(view.tryGet(0)).toBeUndefined();
  });

  it('bounds-checks the frame index on every accessor', async () => {
    const view = viewOf(buildEfa(), inflate);
    expect(() => view.get(2)).toThrow(RangeError);
    expect(() => view.get(-1)).toThrow(RangeError);
    expect(view.tryGet(2)).toBeUndefined();
    expect(view.tryGet(-1)).toBeUndefined();
    expect(view.tryGet(0)).toBeDefined();
    await expect(view.getAsync(2)).rejects.toThrow(RangeError);
  });

  it('appends the extension when the caller omits it', () => {
    const archive = buildArchive([{ name: 'spell.efa', data: buildEfa() }]);
    expect(EfaView.fromArchive('spell', archive, inflate).count).toBe(2);
    expect(EfaView.fromArchive('spell.efa', archive, inflate).count).toBe(2);
  });

  it('throws when the entry is missing', () => {
    expect(() => EfaView.fromArchive('nope', buildArchive([]), inflate)).toThrow(/not found/);
  });
});
