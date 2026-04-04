import type { Palette } from '../drawing/Palette.js';

/**
 * Associates an entity (e.g. Tileset, SpfFile) with the Palette that was generated from it.
 * Returned by `FromImages` write paths after quantization.
 */
export interface Palettized<T> {
  entity: T;
  palette: Palette;
}
