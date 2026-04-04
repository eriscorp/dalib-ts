/** Length of a data archive entry name (null-padded ASCII). */
export const DATA_ARCHIVE_ENTRY_NAME_LENGTH = 13;

/** Starting index for dye colors in a palette. */
export const PALETTE_DYE_INDEX_START = 98;

/** Maximum number of colors in a palette. */
export const COLORS_PER_PALETTE = 256;

/** Width of a ground tile in pixels. */
export const TILE_WIDTH = 56;

/** Height of a ground tile in pixels. */
export const TILE_HEIGHT = 27;

/** Width of a foreground (HPF) tile in pixels. */
export const HPF_TILE_WIDTH = 28;

/** Half of the tile width. */
export const HALF_TILE_WIDTH = 28;

/** Half of the tile height (rounded up). */
export const HALF_TILE_HEIGHT = 14;

/** Area of a tile in pixels. */
export const TILE_SIZE = TILE_WIDTH * TILE_HEIGHT;

/** Mask for 5-bit color channels. */
export const FIVE_BIT_MASK = 0b11111;

/** Mask for 6-bit color channels. */
export const SIX_BIT_MASK = 0b111111;

/** Transparent black — the standard transparency color in Dark Ages image formats. */
export const TRANSPARENT: Color = { r: 0, g: 0, b: 0, a: 0 };

/**
 * The darkest non-transparent black that survives RGB555 downscaling.
 * Values below this threshold collapse to true black (transparent) when
 * converted to 5-bit channels.
 */
export const RGB555_ALMOST_BLACK: Color = { r: 9, g: 9, b: 9, a: 255 };

/** Color-loss factor when converting from 8-bit to 5-bit (255 / 31 ≈ 8.23). */
export const RGB555_COLOR_LOSS_FACTOR = Math.round(255 / FIVE_BIT_MASK);

/**
 * RGBA color — the fundamental color type used throughout dalib.
 * All channels are in the 0-255 range. Alpha defaults to 255 (opaque).
 */
export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * A decoded image frame ready for rendering.
 * `data` is a flat RGBA byte array: [r, g, b, a, r, g, b, a, ...], row-major.
 */
export interface RgbaFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
