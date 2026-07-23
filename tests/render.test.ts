import { describe, expect, it } from 'vitest';
import { HPF_TILE_WIDTH, TILE_HEIGHT, TILE_SIZE, TILE_WIDTH } from '../src/constants.js';
import type { Color, RgbaFrame } from '../src/constants.js';
import { AlphaMode, EfaBlendingType } from '../src/enums.js';
import { Palette } from '../src/drawing/Palette.js';
import { Tile } from '../src/drawing/Tile.js';
import { HpfFile } from '../src/drawing/HpfFile.js';
import { encodeRgb565 } from '../src/utility/ColorCodec.js';
import {
  renderColorized,
  renderEfa,
  renderEpf,
  renderHpf,
  renderMpf,
  renderPalettized,
  renderSpfColorized,
  renderSpfPalettized,
  renderTile,
} from '../src/drawing/Graphics.js';
import type { EfaFrame } from '../src/drawing/EfaFrame.js';

const OPAQUE = { r: 10, g: 20, b: 30, a: 255 };

/** A palette where index 1 is a known opaque color and index 2 is half-alpha. */
function testPalette(): Palette {
  const p = new Palette();
  p.set(0, { r: 90, g: 90, b: 90, a: 255 });
  p.set(1, OPAQUE);
  p.set(2, { r: 200, g: 100, b: 50, a: 128 });
  return p;
}

/** Read one RGBA pixel out of a frame. */
function px(frame: RgbaFrame, x: number, y: number): Color {
  const o = (y * frame.width + x) * 4;
  return { r: frame.data[o]!, g: frame.data[o + 1]!, b: frame.data[o + 2]!, a: frame.data[o + 3]! };
}

describe('renderPalettized', () => {
  it('maps indexes through the palette and color-keys index 0', () => {
    const frame = renderPalettized(0, 0, 2, 1, new Uint8Array([0, 1]), testPalette());
    expect(frame.width).toBe(2);
    expect(frame.height).toBe(1);
    expect(px(frame, 0, 0).a).toBe(0);
    expect(px(frame, 1, 0)).toEqual(OPAQUE);
  });

  it('draws index 0 opaque when the color key is disabled', () => {
    const frame = renderPalettized(0, 0, 1, 1, new Uint8Array([0]), testPalette(), AlphaMode.Straight, false);
    expect(px(frame, 0, 0)).toEqual({ r: 90, g: 90, b: 90, a: 255 });
  });

  it('offsets the image by left/top and grows the bitmap to fit', () => {
    const frame = renderPalettized(2, 3, 1, 1, new Uint8Array([1]), testPalette());
    expect(frame.width).toBe(3);
    expect(frame.height).toBe(4);
    expect(px(frame, 2, 3)).toEqual(OPAQUE);
    // Everything outside the placed pixel is untouched.
    expect(px(frame, 0, 0).a).toBe(0);
  });

  it('treats a negative offset as zero', () => {
    const frame = renderPalettized(-5, -5, 1, 1, new Uint8Array([1]), testPalette());
    expect(frame.width).toBe(1);
    expect(frame.height).toBe(1);
  });

  it('premultiplies RGB by alpha when asked', () => {
    const straight = renderPalettized(0, 0, 1, 1, new Uint8Array([2]), testPalette(), AlphaMode.Straight);
    const premul = renderPalettized(0, 0, 1, 1, new Uint8Array([2]), testPalette(), AlphaMode.Premultiplied);

    expect(px(straight, 0, 0).r).toBe(200);
    // 200 * 128/255 ≈ 100, so premultiplied must be darker while alpha is unchanged.
    expect(px(premul, 0, 0).r).toBeLessThan(px(straight, 0, 0).r);
    expect(px(premul, 0, 0).a).toBe(128);
  });
});

describe('renderColorized', () => {
  it('writes direct colors and treats pure black as transparent', () => {
    const colors: Color[] = [
      { r: 0, g: 0, b: 0, a: 255 },
      { r: 1, g: 2, b: 3, a: 255 },
    ];
    const frame = renderColorized(0, 0, 2, 1, colors);
    expect(px(frame, 0, 0).a).toBe(0);
    expect(px(frame, 1, 0)).toEqual({ r: 1, g: 2, b: 3, a: 255 });
  });

  it('honours left/top offsets', () => {
    const frame = renderColorized(1, 1, 1, 1, [{ r: 5, g: 5, b: 5, a: 255 }]);
    expect(frame.width).toBe(2);
    expect(px(frame, 1, 1).r).toBe(5);
  });
});

describe('renderTile', () => {
  // Only the isometric diamond inside the 56×27 record is visible, and ground art
  // draws palette index 0 as an ordinary opaque color rather than a color key.
  const diamond = (y: number) => {
    const left = Math.abs(13 - y) * 2;
    return { left, right: TILE_WIDTH - left };
  };

  it('renders at the fixed ground-tile size', () => {
    const frame = renderTile(new Tile(new Uint8Array(TILE_SIZE)), testPalette());
    expect(frame.width).toBe(TILE_WIDTH);
    expect(frame.height).toBe(TILE_HEIGHT);
  });

  it('draws index 0 opaque inside the diamond', () => {
    const frame = renderTile(new Tile(new Uint8Array(TILE_SIZE)), testPalette());
    expect(px(frame, 28, 13)).toEqual({ r: 90, g: 90, b: 90, a: 255 });
  });

  it('masks everything outside the diamond to transparent', () => {
    const data = new Uint8Array(TILE_SIZE).fill(1);
    const frame = renderTile(new Tile(data), testPalette());

    let visible = 0;
    for (let y = 0; y < TILE_HEIGHT; y++) {
      const { left, right } = diamond(y);
      for (let x = 0; x < TILE_WIDTH; x++) {
        const a = px(frame, x, y).a;
        if (x >= left && x < right) {
          expect(a).toBe(255);
          visible++;
        } else {
          expect(a).toBe(0);
        }
      }
    }
    expect(visible).toBe(784);
  });
});

describe('renderHpf', () => {
  it('renders at 28 pixels wide with the derived height', () => {
    const bytes = new Uint8Array(8 + HPF_TILE_WIDTH * 2).fill(1, 8);
    const frame = renderHpf(HpfFile.fromBuffer(bytes), testPalette());
    expect(frame.width).toBe(HPF_TILE_WIDTH);
    expect(frame.height).toBe(2);
    expect(px(frame, 0, 0)).toEqual(OPAQUE);
  });
});

describe('renderMpf / renderEpf', () => {
  it('renders an MPF frame at its bounds', () => {
    const frame = renderMpf(
      { left: 0, top: 0, right: 2, bottom: 2, data: new Uint8Array([1, 1, 1, 1]) },
      testPalette(),
    );
    expect(frame.width).toBe(2);
    expect(frame.height).toBe(2);
    expect(px(frame, 1, 1)).toEqual(OPAQUE);
  });

  it('renders an EPF frame at its bounds', () => {
    const frame = renderEpf(
      { top: 0, left: 0, bottom: 2, right: 2, data: new Uint8Array([1, 1, 1, 1]) },
      testPalette(),
    );
    expect(frame.width).toBe(2);
    expect(frame.height).toBe(2);
  });

  it('returns a 1×1 transparent frame for a zero-area EPF frame', () => {
    const frame = renderEpf({ top: 0, left: 0, bottom: 0, right: 0, data: new Uint8Array(0) }, testPalette());
    expect(frame.width).toBe(1);
    expect(frame.height).toBe(1);
    expect(px(frame, 0, 0).a).toBe(0);
  });
});

describe('renderSpf', () => {
  it('renders a palettized SPF frame using its bounds', () => {
    const frame = renderSpfPalettized(
      {
        left: 0, top: 0, right: 2, bottom: 2,
        centerX: 0, centerY: 0, flags: 0, hasCenterPoint: false,
        startAddress: 0, byteWidth: 2, byteCount: 4, imageByteCount: 4,
        data: new Uint8Array([1, 1, 1, 1]),
      },
      testPalette(),
    );
    expect(frame.width).toBe(2);
    expect(px(frame, 0, 0)).toEqual(OPAQUE);
  });

  // Rows advance by the frame's pitch, which is not always the row's pixel width.
  it('repacks a palettized frame whose pitch exceeds its width', () => {
    const frame = renderSpfPalettized(
      {
        left: 0, top: 0, right: 2, bottom: 2,
        centerX: 0, centerY: 0, flags: 0, hasCenterPoint: false,
        startAddress: 0, byteWidth: 4, byteCount: 8, imageByteCount: 4,
        // Two rows of stride 4: the trailing two bytes of each row are padding.
        data: new Uint8Array([1, 1, 0, 0, 1, 1, 0, 0]),
      },
      testPalette(),
    );
    expect(frame.width).toBe(2);
    expect(frame.height).toBe(2);
    // Every visible pixel came from the leading two bytes of its row.
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) expect(px(frame, x, y)).toEqual(OPAQUE);
  });

  it('renders a colorized SPF frame from its decoded colors', () => {
    const frame = renderSpfColorized({
      left: 0, top: 0, right: 2, bottom: 1,
      centerX: 0, centerY: 0, flags: 0, hasCenterPoint: false,
      startAddress: 0, byteWidth: 4, byteCount: 4, imageByteCount: 2,
      colorData: [{ r: 8, g: 9, b: 10, a: 255 }, { r: 0, g: 0, b: 0, a: 255 }],
    });
    expect(px(frame, 0, 0).r).toBe(8);
    expect(px(frame, 1, 0).a).toBe(0);
  });
});

describe('renderEfa', () => {
  /** One EFA frame of solid RGB565 pixels. */
  function efaFrame(width: number, height: number, color: Color, extra: Partial<EfaFrame> = {}): EfaFrame {
    const data = new Uint8Array(width * height * 2);
    const view = new DataView(data.buffer);
    for (let i = 0; i < width * height; i++) view.setUint16(i * 2, encodeRgb565(color), true);

    return {
      startAddress: 0, compressedSize: 0, decompressedSize: data.length,
      byteCount: data.length, byteWidth: width * 2,
      framePixelWidth: width, framePixelHeight: height,
      imagePixelWidth: width, imagePixelHeight: height,
      left: 0, top: 0, centerX: 0, centerY: 0,
      data,
      unknown1: 0, unknown2: 0, unknown3: 0, unknown4: 0, unknown5: 0, unknown6: 0, unknown7: 0,
      ...extra,
    };
  }

  it('decodes RGB565 pixels onto the image canvas', () => {
    const frame = renderEfa(efaFrame(2, 2, { r: 255, g: 0, b: 0, a: 255 }));
    expect(frame.width).toBe(2);
    expect(frame.height).toBe(2);
    // RGB565 rounds the red channel, so assert the channel dominates rather than an exact value.
    expect(px(frame, 0, 0).r).toBeGreaterThan(240);
    expect(px(frame, 0, 0).g).toBe(0);
  });

  it('returns an empty canvas when the frame has no pixel data', () => {
    const frame = renderEfa(efaFrame(0, 0, OPAQUE, { byteCount: 0, byteWidth: 0, imagePixelWidth: 4, imagePixelHeight: 3 }));
    expect(frame.width).toBe(4);
    expect(frame.height).toBe(3);
    expect(px(frame, 0, 0).a).toBe(0);
  });

  it('accepts the documented blending types', () => {
    for (const blend of [EfaBlendingType.Additive, EfaBlendingType.SelfAlpha]) {
      const frame = renderEfa(efaFrame(1, 1, { r: 255, g: 255, b: 255, a: 255 }), blend);
      expect(frame.width).toBe(1);
    }
  });

  it('offsets the frame inside a larger image canvas', () => {
    const frame = renderEfa(efaFrame(2, 2, OPAQUE, {
      left: 1, top: 2,
      framePixelWidth: 8, framePixelHeight: 8,
      imagePixelWidth: 8, imagePixelHeight: 8,
    }));
    expect(frame.width).toBe(8);
    expect(frame.height).toBe(8);
    expect(px(frame, 0, 0).a).toBe(0); // outside the placed frame
    expect(px(frame, 1, 2).a).toBe(255); // the frame's own origin
  });

  it('drops pixels that fall outside the declared frame size', () => {
    // The data is 4x1 but the frame claims to be 2 wide, so the last two source
    // pixels are padding and must not be drawn.
    const frame = renderEfa(efaFrame(4, 1, OPAQUE, { framePixelWidth: 2, framePixelHeight: 1 }));
    expect(px(frame, 0, 0).a).toBe(255);
    expect(px(frame, 1, 0).a).toBe(255);
    expect(px(frame, 2, 0).a).toBe(0);
    expect(px(frame, 3, 0).a).toBe(0);
  });

  it('drops whole rows below the declared frame height', () => {
    const frame = renderEfa(efaFrame(1, 4, OPAQUE, { framePixelWidth: 1, framePixelHeight: 2 }));
    expect(px(frame, 0, 1).a).toBe(255);
    expect(px(frame, 0, 2).a).toBe(0);
  });

  describe('alpha surfaces', () => {
    /** Two 16-bit words per pixel row, little-endian. */
    function words(values: number[]): Uint8Array {
      const out = new Uint8Array(values.length * 2);
      const view = new DataView(out.buffer);
      values.forEach((v, i) => view.setUint16(i * 2, v, true));
      return out;
    }

    it('reads a raw alpha surface, scaling the five-bit value to eight', () => {
      // unknown4 !== 4 selects the raw decoder: one 16-bit alpha word per pixel,
      // holding a 0..31 value.
      const frame = renderEfa(
        efaFrame(2, 1, OPAQUE, { alphaData: words([31, 0]), unknown4: 0 }),
        EfaBlendingType.SeparateAlpha,
      );
      expect(px(frame, 0, 0).a).toBe(255);
      expect(px(frame, 1, 0).a).toBe(0);
    });

    it('clamps a raw alpha value above the five-bit range', () => {
      const frame = renderEfa(
        efaFrame(1, 1, OPAQUE, { alphaData: words([0xffff]), unknown4: 0 }),
        EfaBlendingType.SeparateAlpha,
      );
      expect(px(frame, 0, 0).a).toBe(255);
    });

    it('reads a per-channel alpha surface as the brightest channel', () => {
      // RGB555 alpha word: red 31, green 0, blue 0 → alpha 255.
      const bright = (31 << 10);
      const frame = renderEfa(
        efaFrame(2, 1, OPAQUE, { alphaData: words([bright, 0]) }),
        EfaBlendingType.PerChannelAlpha,
      );
      expect(px(frame, 0, 0).a).toBe(255);
      expect(px(frame, 1, 0).a).toBe(0);
    });

    it('reads an RLE alpha surface, whose rows start at a per-row offset table', () => {
      // unknown4 === 4 selects the RLE decoder. Layout: one int32 row offset per
      // row, then (count << 8 | alpha) words at that offset.
      const height = 2;
      const table = new Uint8Array(height * 4);
      const tableView = new DataView(table.buffer);
      tableView.setUint32(0, 8, true);  // row 0 runs start at byte 8
      tableView.setUint32(4, 12, true); // row 1 runs start at byte 12

      const runs = new Uint8Array(8);
      const runView = new DataView(runs.buffer);
      runView.setUint16(0, (2 << 8) | 31, true); // row 0: two opaque pixels
      runView.setUint16(2, 0, true);
      runView.setUint16(4, (2 << 8) | 0, true);  // row 1: two transparent pixels
      runView.setUint16(6, 0, true);

      const alphaData = new Uint8Array(table.length + runs.length);
      alphaData.set(table);
      alphaData.set(runs, table.length);

      const frame = renderEfa(
        efaFrame(2, 2, OPAQUE, { alphaData, unknown4: 4 }),
        EfaBlendingType.SeparateAlpha,
      );
      expect(px(frame, 0, 0).a).toBe(255);
      expect(px(frame, 1, 0).a).toBe(255);
      expect(px(frame, 0, 1).a).toBe(0);
    });

    it('returns a fully transparent RLE surface when the offset table is truncated', () => {
      const frame = renderEfa(
        efaFrame(2, 2, OPAQUE, { alphaData: new Uint8Array(2), unknown4: 4 }),
        EfaBlendingType.SeparateAlpha,
      );
      expect(px(frame, 0, 0).a).toBe(0);
    });

    it('stops early when the alpha surface is shorter than the frame', () => {
      const frame = renderEfa(
        efaFrame(4, 1, OPAQUE, { alphaData: words([31]), unknown4: 0 }),
        EfaBlendingType.SeparateAlpha,
      );
      expect(px(frame, 0, 0).a).toBe(255);
      // Pixels past the end of the surface decode to zero.
      expect(px(frame, 3, 0).a).toBe(0);
    });

    it('falls back to the brightest color channel when no alpha surface is present', () => {
      const dim = renderEfa(efaFrame(1, 1, { r: 0, g: 0, b: 0, a: 255 }), EfaBlendingType.SeparateAlpha);
      const bright = renderEfa(efaFrame(1, 1, { r: 255, g: 255, b: 255, a: 255 }), EfaBlendingType.SeparateAlpha);
      expect(px(dim, 0, 0).a).toBe(0);
      expect(px(bright, 0, 0).a).toBeGreaterThan(240);
    });

    it('ignores an empty alpha surface and uses the channel fallback', () => {
      const frame = renderEfa(
        efaFrame(1, 1, { r: 255, g: 255, b: 255, a: 255 }, { alphaData: new Uint8Array(0) }),
        EfaBlendingType.SeparateAlpha,
      );
      expect(px(frame, 0, 0).a).toBeGreaterThan(240);
    });

    it('ignores an alpha surface for a blend mode that does not use one', () => {
      const frame = renderEfa(
        efaFrame(1, 1, { r: 0, g: 0, b: 0, a: 255 }, { alphaData: words([0]), unknown4: 0 }),
        EfaBlendingType.Additive,
      );
      expect(px(frame, 0, 0).a).toBe(255);
    });

    it('treats an unrecognised blend mode as fully opaque', () => {
      const frame = renderEfa(efaFrame(1, 1, OPAQUE), 99 as EfaBlendingType);
      expect(px(frame, 0, 0).a).toBe(255);
    });

    it('honours the premultiplied alpha mode', () => {
      const frame = renderEfa(
        efaFrame(1, 1, { r: 255, g: 255, b: 255, a: 255 }, { alphaData: words([15]), unknown4: 0 }),
        EfaBlendingType.SeparateAlpha,
        AlphaMode.Premultiplied,
      );
      const p = px(frame, 0, 0);
      expect(p.a).toBeLessThan(255);
      expect(p.r).toBeLessThan(255);
    });
  });
});
