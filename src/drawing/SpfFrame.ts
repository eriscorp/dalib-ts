import type { Color } from '../constants.js';

/** A single frame within an SPF file. */
export interface SpfFrame {
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Anchor X (signed). Meaningful only when {@link hasCenterPoint} is true. */
  centerX: number;
  /** Anchor Y (signed). Meaningful only when {@link hasCenterPoint} is true. */
  centerY: number;
  /**
   * Raw per-frame flag word (uint32).
   * Bit 0 is aliased as {@link hasCenterPoint}; other bits are preserved as-is for
   * byte-identical round-tripping but have no known semantic meaning yet.
   */
  flags: number;
  /** `(flags & 1) !== 0`. Indicates that {@link centerX} / {@link centerY} are valid. */
  hasCenterPoint: boolean;
  /** Offset of this frame's data within the file's data segment. */
  startAddress: number;
  /** Width of pixel data in bytes (pixelWidth × 2 for colorized). */
  byteWidth: number;
  /** Total bytes of pixel data in the file for this frame. */
  byteCount: number;
  /** Number of pixels (width × height). */
  imageByteCount: number;

  // Palettized mode: 1 byte per pixel (palette index)
  data?: Uint8Array;

  // Colorized mode: decoded Color array (RGB565 per pixel, full RGBA stored)
  colorData?: Color[];
}

export function spfFrameWidth(frame: SpfFrame): number {
  return frame.right - frame.left;
}

export function spfFrameHeight(frame: SpfFrame): number {
  return frame.bottom - frame.top;
}
