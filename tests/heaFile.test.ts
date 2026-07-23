import { describe, expect, it } from 'vitest';
import { HeaFile } from '../src/drawing/HeaFile.js';
import { renderDarknessLayer, renderDarknessOverlay } from '../src/drawing/Graphics.js';

/**
 * Hand-build a HEA: ten int32 header fields, then the per-layer thresholds, then
 * layerCount × scanlineCount int32 word offsets, then the packed run bytes.
 */
function buildHea(opts: {
  scanlineWidth: number;
  scanlineCount: number;
  thresholds: number[];
  offsets: number[];
  runs: number[];
}): Uint8Array {
  const { scanlineWidth, scanlineCount, thresholds, offsets, runs } = opts;
  const header = [0, 640, 480, 640, 480, 2, 3, scanlineWidth, scanlineCount, thresholds.length];
  const ints = [...header, ...thresholds, ...offsets];

  const bytes = new Uint8Array(ints.length * 4 + runs.length);
  const view = new DataView(bytes.buffer);
  ints.forEach((v, i) => view.setInt32(i * 4, v, true));
  bytes.set(new Uint8Array(runs), ints.length * 4);
  return bytes;
}

describe('HeaFile', () => {
  // One layer, two scanlines of four pixels. Each scanline is a single (value,
  // count) run. Offsets are counted in 16-bit words, so the second scanline's run
  // at byte 2 is word offset 1.
  const SIMPLE = buildHea({
    scanlineWidth: 4,
    scanlineCount: 2,
    thresholds: [0],
    offsets: [0, 1],
    runs: [5, 4, 7, 4],
  });

  it('parses the header', () => {
    const hea = HeaFile.fromBuffer(SIMPLE);
    expect(hea.screenWidth).toBe(640);
    expect(hea.screenHeight).toBe(480);
    expect(hea.tileWidth).toBe(2);
    expect(hea.tileHeight).toBe(3);
    expect(hea.scanlineWidth).toBe(4);
    expect(hea.scanlineCount).toBe(2);
    expect(hea.layerCount).toBe(1);
  });

  it('decodes a run-length scanline', () => {
    const hea = HeaFile.fromBuffer(SIMPLE);
    expect(Array.from(hea.decodeScanline(0, 0))).toEqual([5, 5, 5, 5]);
    expect(Array.from(hea.decodeScanline(0, 1))).toEqual([7, 7, 7, 7]);
  });

  it('decodes into a caller-supplied buffer', () => {
    const hea = HeaFile.fromBuffer(SIMPLE);
    const buf = new Uint8Array(4);
    hea.decodeScanline(0, 0, buf);
    expect(Array.from(buf)).toEqual([5, 5, 5, 5]);
  });

  // Only the low six bits of the run byte are intensity; the top two are flags
  // whose meaning is unconfirmed. 0xC5 & 0x3F === 5.
  it('masks the intensity to the low six bits', () => {
    const masked = buildHea({
      scanlineWidth: 2, scanlineCount: 1, thresholds: [0], offsets: [0], runs: [0xc5, 2],
    });
    expect(Array.from(HeaFile.fromBuffer(masked).decodeScanline(0, 0))).toEqual([5, 5]);
  });

  it('stops once the requested width is filled', () => {
    const overrun = buildHea({
      scanlineWidth: 3, scanlineCount: 1, thresholds: [0], offsets: [0], runs: [9, 255],
    });
    expect(Array.from(HeaFile.fromBuffer(overrun).decodeScanline(0, 0))).toEqual([9, 9, 9]);
  });

  it('skips a zero-length run', () => {
    const withZero = buildHea({
      scanlineWidth: 2, scanlineCount: 1, thresholds: [0], offsets: [0], runs: [1, 0, 4, 2],
    });
    expect(Array.from(HeaFile.fromBuffer(withZero).decodeScanline(0, 0))).toEqual([4, 4]);
  });

  it('computes each layer width from the thresholds', () => {
    const twoLayer = buildHea({
      scanlineWidth: 2500, scanlineCount: 1, thresholds: [0, 1000], offsets: [0, 0], runs: [1, 255],
    });
    const hea = HeaFile.fromBuffer(twoLayer);
    expect(hea.getLayerWidth(0)).toBe(1000);
    // The final layer runs to the end of the scanline.
    expect(hea.getLayerWidth(1)).toBe(1500);
  });

  it('rejects out-of-range layer and scanline indexes', () => {
    const hea = HeaFile.fromBuffer(SIMPLE);
    expect(() => hea.getLayerWidth(-1)).toThrow(RangeError);
    expect(() => hea.getLayerWidth(9)).toThrow(RangeError);
    expect(() => hea.decodeScanline(9, 0)).toThrow(RangeError);
    expect(() => hea.decodeScanline(0, 9)).toThrow(RangeError);
  });

  it('round-trips through toUint8Array', () => {
    const out = HeaFile.fromBuffer(SIMPLE).toUint8Array();
    expect(Array.from(out)).toEqual(Array.from(SIMPLE));
  });

  it('accepts an ArrayBuffer', () => {
    const copy = new Uint8Array(SIMPLE);
    expect(HeaFile.fromBuffer(copy.buffer as ArrayBuffer).scanlineCount).toBe(2);
  });

  describe('fromRgbaFrame', () => {
    // Alpha maps to light: 0 is fully dark, 255 is MAX_LIGHT_VALUE.
    const frame = {
      width: 4,
      height: 4,
      data: new Uint8ClampedArray(4 * 4 * 4).fill(255),
    };

    it('builds a light map sized from the tile dimensions', () => {
      const hea = HeaFile.fromRgbaFrame(frame, 1, 1);
      expect(hea.tileWidth).toBe(1);
      expect(hea.tileHeight).toBe(1);
      expect(hea.scanlineWidth).toBe(28 * 2 + 640 * 2);
      expect(hea.scanlineCount).toBe(14 * 2 + 480 * 2);
      expect(hea.layerCount).toBe(Math.ceil(hea.scanlineWidth / HeaFile.LAYER_STRIP_WIDTH));
    });

    it('places thresholds one strip apart', () => {
      const hea = HeaFile.fromRgbaFrame(frame, 1, 1);
      expect(hea.thresholds[0]).toBe(0);
      expect(hea.thresholds[1]).toBe(HeaFile.LAYER_STRIP_WIDTH);
    });

    it('encodes the padding around the frame as fully dark', () => {
      const hea = HeaFile.fromRgbaFrame(frame, 1, 1);
      // Row 0 is far above the centred frame, so it is entirely unlit.
      expect(Array.from(hea.decodeScanline(0, 0)).every(v => v === 0)).toBe(true);
    });

    it('round-trips the generated file back through the parser', () => {
      const hea = HeaFile.fromRgbaFrame(frame, 1, 1);
      const reparsed = HeaFile.fromBuffer(hea.toUint8Array());
      expect(reparsed.scanlineWidth).toBe(hea.scanlineWidth);
      expect(reparsed.layerCount).toBe(hea.layerCount);
      expect(Array.from(reparsed.decodeScanline(0, 0))).toEqual(Array.from(hea.decodeScanline(0, 0)));
    });
  });
});

describe('darkness rendering', () => {
  const hea = HeaFile.fromBuffer(
    buildHea({
      scanlineWidth: 2,
      scanlineCount: 2,
      thresholds: [0],
      // Row 0 fully lit (MAX_LIGHT_VALUE), row 1 fully dark.
      offsets: [0, 1],
      runs: [HeaFile.MAX_LIGHT_VALUE, 2, 0, 2],
    }),
  );

  it('renders a layer as a black overlay whose alpha tracks darkness', () => {
    const frame = renderDarknessLayer(hea, 0, 200);
    expect(frame.width).toBe(2);
    expect(frame.height).toBe(2);

    // Fully lit → transparent; fully dark → the requested opacity.
    expect(frame.data[3]).toBe(0);
    expect(frame.data[(1 * 2 + 0) * 4 + 3]).toBe(200);
    // The overlay is pure black.
    expect(frame.data[0]).toBe(0);
  });

  it('honours a custom opacity', () => {
    const frame = renderDarknessLayer(hea, 0, 100);
    expect(frame.data[(1 * 2 + 0) * 4 + 3]).toBe(100);
  });

  it('rejects an out-of-range layer', () => {
    expect(() => renderDarknessLayer(hea, 5)).toThrow(RangeError);
  });

  it('renders the stitched overlay across every layer', () => {
    const frame = renderDarknessOverlay(hea, 200);
    expect(frame.width).toBe(hea.scanlineWidth);
    expect(frame.height).toBe(hea.scanlineCount);
  });
});
