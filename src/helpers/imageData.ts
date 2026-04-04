import type { RgbaFrame } from '../constants.js';

/**
 * Convert an RgbaFrame to a browser ImageData object.
 * The data is copied (not shared) to satisfy the ImageData constructor.
 *
 * **Browser only** — throws in Node.js unless a polyfill provides ImageData.
 *
 * @example
 * ```ts
 * import { toImageData } from 'dalib/helpers/imageData';
 *
 * const frame = renderHpf(hpf, palette);
 * const imageData = toImageData(frame);
 * ctx.putImageData(imageData, 0, 0);
 * ```
 */
export function toImageData(frame: RgbaFrame): ImageData {
  return new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height);
}

/**
 * Draw an RgbaFrame directly onto a Canvas 2D context at position (dx, dy).
 * Convenience wrapper around toImageData + putImageData.
 *
 * **Browser only**.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  frame: RgbaFrame,
  dx = 0,
  dy = 0,
): void {
  ctx.putImageData(toImageData(frame), dx, dy);
}
