import * as IQ from 'image-q';
import type { RgbaFrame } from '../constants.js';
import { RGB555_ALMOST_BLACK, RGB555_COLOR_LOSS_FACTOR } from '../constants.js';
import { Palette } from '../drawing/Palette.js';

/** Maximum palette colors reserved for image data (slot 0 = transparent black). */
const MAX_QUANTIZE_COLORS = 255;

/**
 * Nudge any opaque near-black pixel to {@link RGB555_ALMOST_BLACK} so it is not confused
 * with the transparent sentinel (palette index 0 = pure black) when stored in a palettized
 * format that down-samples to RGB555 channels.
 */
export function preserveNonTransparentBlacks(frame: RgbaFrame): RgbaFrame {
  const src = frame.data;
  const dst = new Uint8ClampedArray(src);
  for (let i = 0; i < dst.length; i += 4) {
    const a = dst[i + 3]!;
    if (
      a === 255 &&
      dst[i]! <= RGB555_COLOR_LOSS_FACTOR &&
      dst[i + 1]! <= RGB555_COLOR_LOSS_FACTOR &&
      dst[i + 2]! <= RGB555_COLOR_LOSS_FACTOR
    ) {
      dst[i] = RGB555_ALMOST_BLACK.r;
      dst[i + 1] = RGB555_ALMOST_BLACK.g;
      dst[i + 2] = RGB555_ALMOST_BLACK.b;
      // alpha stays 255
    }
  }
  return { width: frame.width, height: frame.height, data: dst };
}

/**
 * Crop all transparent (alpha === 0) border pixels from a frame.
 * Returns the cropped frame and its top-left offset within the original.
 */
export function cropTransparentPixels(frame: RgbaFrame): {
  frame: RgbaFrame;
  offsetX: number;
  offsetY: number;
} {
  const { width, height, data } = frame;
  let minX = width, maxX = -1, minY = height, maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Fully transparent frame — return 0×0 at origin
  if (maxX === -1) {
    return { frame: { width: 0, height: 0, data: new Uint8ClampedArray(0) }, offsetX: 0, offsetY: 0 };
  }

  const newW = maxX - minX + 1;
  const newH = maxY - minY + 1;
  const dst = new Uint8ClampedArray(newW * newH * 4);
  for (let y = 0; y < newH; y++) {
    const srcRow = ((minY + y) * width + minX) * 4;
    dst.set(data.subarray(srcRow, srcRow + newW * 4), y * newW * 4);
  }
  return { frame: { width: newW, height: newH, data: dst }, offsetX: minX, offsetY: minY };
}

/** Result of quantizing one or more RGBA frames to an indexed palette format. */
export interface QuantizeResult {
  /** Palette for the quantized frames (index 0 = transparent black). */
  palette: Palette;
  /** Per-frame palette index arrays (same order as input). */
  indexedFrames: Uint8Array[];
}

/**
 * Quantize multiple RGBA frames to a shared 256-color palette using the Wu algorithm.
 *
 * Strategy:
 *  - Slot 0 is reserved for transparent black.
 *  - Ask image-q for 255 colors (slots 1-255).
 *  - Transparent pixels (alpha === 0) always map to index 0.
 *  - Opaque pixels are snapped to the nearest palette entry.
 *
 * Callers should run {@link preserveNonTransparentBlacks} on each frame first.
 */
export function quantizeFrames(frames: RgbaFrame[]): QuantizeResult {
  if (frames.length === 0) {
    return { palette: new Palette(), indexedFrames: [] };
  }

  // Build image-q containers from each frame
  const containers = frames.map(f =>
    IQ.utils.PointContainer.fromUint8Array(
      new Uint8Array(f.data.buffer, f.data.byteOffset, f.data.byteLength),
      f.width,
      f.height,
    ),
  );

  // Build a shared palette (255 colors — slot 0 reserved for transparent)
  const iqPalette = IQ.buildPaletteSync(containers, { colors: MAX_QUANTIZE_COLORS });

  // Extract colors from the image-q palette into slots 1-255
  const palette = new Palette();
  const palettePoints = iqPalette.getPointContainer().getPointArray();
  const colorToIndex = new Map<number, number>();

  for (let i = 0; i < palettePoints.length && i < MAX_QUANTIZE_COLORS; i++) {
    const p = palettePoints[i]!;
    const slot = i + 1;
    palette.set(slot, { r: p.r, g: p.g, b: p.b, a: 255 });
    const key = p.r | (p.g << 8) | (p.b << 16) | (p.a << 24);
    colorToIndex.set(key, slot);
  }

  // Snap each frame's pixels to the palette
  const indexedFrames = frames.map((frame, fi) => {
    const snapped = IQ.applyPaletteSync(containers[fi]!, iqPalette);
    const snappedPoints = snapped.getPointArray();
    const indexed = new Uint8Array(frame.width * frame.height);
    const src = frame.data;

    for (let i = 0; i < indexed.length; i++) {
      if (src[i * 4 + 3] === 0) {
        indexed[i] = 0; // transparent → slot 0
        continue;
      }
      const sp = snappedPoints[i]!;
      const key = sp.r | (sp.g << 8) | (sp.b << 16) | (sp.a << 24);
      indexed[i] = colorToIndex.get(key) ?? 1;
    }
    return indexed;
  });

  return { palette, indexedFrames };
}
