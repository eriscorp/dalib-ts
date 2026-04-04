import type { Color } from '../constants.js';

/**
 * An entry in a ColorTable, associating a color index with a sequence of colors (used for dye tables).
 */
export interface ColorTableEntry {
  /** The color index as used by the client (e.g. 0 = default purple). */
  colorIndex: number;
  /** The colors associated with this index. */
  colors: Color[];
}

/** An empty ColorTableEntry with 6 transparent colors. */
export function emptyColorTableEntry(): ColorTableEntry {
  return {
    colorIndex: 0,
    colors: Array.from({ length: 6 }, () => ({ r: 0, g: 0, b: 0, a: 0 })),
  };
}
