import { describe, expect, it } from 'vitest';
import type { RgbaFrame } from '../src/constants.js';
import {
  cropTransparentPixels,
  preserveNonTransparentBlacks,
  quantizeFrames,
} from '../src/utility/ImageProcessor.js';
import { mpfFrameHeight, mpfFrameWidth } from '../src/drawing/MpfFrame.js';
import { spfFrameHeight, spfFrameWidth } from '../src/drawing/SpfFrame.js';
import { epfFrameHeight, epfFrameWidth } from '../src/drawing/EpfFrame.js';
import { toImageData } from '../src/helpers/imageData.js';

/** Build an RGBA frame from a per-pixel callback. */
function frameOf(width: number, height: number, at: (x: number, y: number) => [number, number, number, number]): RgbaFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = at(x, y);
      const o = (y * width + x) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a;
    }
  }
  return { width, height, data };
}

const TRANSPARENT: [number, number, number, number] = [0, 0, 0, 0];
const BLACK: [number, number, number, number] = [0, 0, 0, 255];

describe('preserveNonTransparentBlacks', () => {
  // Pure black would collapse to the transparent color key once packed to 16-bit,
  // so an opaque black pixel is nudged just off zero to stay visible.
  it('lifts an opaque black pixel off pure zero', () => {
    const out = preserveNonTransparentBlacks(frameOf(1, 1, () => BLACK));
    const [r, g, b, a] = [out.data[0]!, out.data[1]!, out.data[2]!, out.data[3]!];
    expect(a).toBe(255);
    expect(r + g + b).toBeGreaterThan(0);
  });

  it('leaves a transparent pixel alone', () => {
    const out = preserveNonTransparentBlacks(frameOf(1, 1, () => TRANSPARENT));
    expect(Array.from(out.data)).toEqual([0, 0, 0, 0]);
  });

  it('leaves an ordinary color alone', () => {
    const out = preserveNonTransparentBlacks(frameOf(1, 1, () => [10, 20, 30, 255]));
    expect(Array.from(out.data)).toEqual([10, 20, 30, 255]);
  });

  it('does not mutate the source frame', () => {
    const src = frameOf(1, 1, () => BLACK);
    preserveNonTransparentBlacks(src);
    expect(Array.from(src.data)).toEqual([0, 0, 0, 255]);
  });
});

describe('cropTransparentPixels', () => {
  it('crops to the non-transparent bounding box and reports the offset', () => {
    // A single opaque pixel at (2, 1) inside a 4×3 frame.
    const src = frameOf(4, 3, (x, y) => (x === 2 && y === 1 ? [9, 9, 9, 255] : TRANSPARENT));
    const { frame, offsetX, offsetY } = cropTransparentPixels(src);

    expect(offsetX).toBe(2);
    expect(offsetY).toBe(1);
    expect(frame.width).toBe(1);
    expect(frame.height).toBe(1);
    expect(frame.data[0]).toBe(9);
  });

  it('keeps a frame that is already tight', () => {
    const src = frameOf(2, 2, () => [1, 2, 3, 255]);
    const { frame, offsetX, offsetY } = cropTransparentPixels(src);
    expect(offsetX).toBe(0);
    expect(offsetY).toBe(0);
    expect(frame.width).toBe(2);
    expect(frame.height).toBe(2);
  });

  it('collapses a fully transparent frame', () => {
    const { frame } = cropTransparentPixels(frameOf(3, 3, () => TRANSPARENT));
    expect(frame.width * frame.height).toBe(0);
  });

  it('spans a multi-pixel region', () => {
    const src = frameOf(5, 5, (x, y) => (x >= 1 && x <= 3 && y >= 2 && y <= 3 ? [1, 1, 1, 255] : TRANSPARENT));
    const { frame, offsetX, offsetY } = cropTransparentPixels(src);
    expect([offsetX, offsetY]).toEqual([1, 2]);
    expect([frame.width, frame.height]).toEqual([3, 2]);
  });
});

describe('quantizeFrames', () => {
  it('returns an empty result for no frames', () => {
    const { palette, indexedFrames } = quantizeFrames([]);
    expect(indexedFrames).toEqual([]);
    expect(palette.length).toBe(256);
  });

  it('indexes each frame and shares one palette', () => {
    const frames = [
      frameOf(2, 2, () => [255, 0, 0, 255]),
      frameOf(2, 2, () => [0, 0, 255, 255]),
    ];
    const { palette, indexedFrames } = quantizeFrames(frames);

    expect(indexedFrames).toHaveLength(2);
    expect(indexedFrames[0]).toHaveLength(4);
    expect(palette.length).toBe(256);
    // Index 0 is reserved as the transparent key.
    expect(palette.get(0).a).toBe(0);
  });

  it('maps a transparent pixel to index 0', () => {
    const { indexedFrames } = quantizeFrames([
      frameOf(2, 1, x => (x === 0 ? TRANSPARENT : [200, 100, 50, 255])),
    ]);
    expect(indexedFrames[0]![0]).toBe(0);
    expect(indexedFrames[0]![1]).not.toBe(0);
  });

  it('keeps distinct colors on distinct indexes', () => {
    const { indexedFrames } = quantizeFrames([
      frameOf(2, 1, x => (x === 0 ? [255, 0, 0, 255] : [0, 255, 0, 255])),
    ]);
    expect(indexedFrames[0]![0]).not.toBe(indexedFrames[0]![1]);
  });
});

describe('frame dimension helpers', () => {
  it('derive width and height from bounds for every frame type', () => {
    const bounds = { left: 2, top: 3, right: 7, bottom: 9 };
    expect(mpfFrameWidth({ ...bounds, centerX: 0, centerY: 0, startAddress: 0, data: new Uint8Array(0) })).toBe(5);
    expect(mpfFrameHeight({ ...bounds, centerX: 0, centerY: 0, startAddress: 0, data: new Uint8Array(0) })).toBe(6);

    expect(spfFrameWidth({
      ...bounds, centerX: 0, centerY: 0, flags: 0, hasCenterPoint: false,
      startAddress: 0, byteWidth: 0, byteCount: 0, imageByteCount: 0,
    })).toBe(5);
    expect(spfFrameHeight({
      ...bounds, centerX: 0, centerY: 0, flags: 0, hasCenterPoint: false,
      startAddress: 0, byteWidth: 0, byteCount: 0, imageByteCount: 0,
    })).toBe(6);

    expect(epfFrameWidth({ ...bounds, data: new Uint8Array(0) })).toBe(5);
    expect(epfFrameHeight({ ...bounds, data: new Uint8Array(0) })).toBe(6);
  });
});

describe('toImageData', () => {
  // ImageData is a browser global. Node exposes it only in some builds, so this
  // suite runs against a minimal stand-in when it is absent.
  it('copies the frame into an ImageData-shaped object', () => {
    const original = (globalThis as Record<string, unknown>).ImageData;
    if (original === undefined) {
      (globalThis as Record<string, unknown>).ImageData = class {
        data: Uint8ClampedArray;
        width: number;
        height: number;
        constructor(data: Uint8ClampedArray, width: number, height: number) {
          this.data = data;
          this.width = width;
          this.height = height;
        }
      };
    }

    try {
      const frame = frameOf(2, 1, () => [1, 2, 3, 255]);
      const imageData = toImageData(frame);
      expect(imageData.width).toBe(2);
      expect(imageData.height).toBe(1);
      expect(imageData.data[0]).toBe(1);
      // The data is copied, not shared with the source frame.
      expect(imageData.data).not.toBe(frame.data);
    } finally {
      if (original === undefined) delete (globalThis as Record<string, unknown>).ImageData;
    }
  });
});
