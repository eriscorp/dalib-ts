import { TILE_WIDTH, TILE_HEIGHT } from '../constants.js';

/**
 * A single 56×27 ground tile whose pixel data is palette-indexed (one byte per pixel).
 */
export class Tile {
  /** Palette-indexed pixel data (TILE_WIDTH × TILE_HEIGHT bytes). */
  data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  /** Pixel width of the tile (always 56). */
  get pixelWidth(): number { return TILE_WIDTH; }
  /** Pixel height of the tile (always 27). */
  get pixelHeight(): number { return TILE_HEIGHT; }
}
