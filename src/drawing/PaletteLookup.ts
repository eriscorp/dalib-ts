import { COLORS_PER_PALETTE } from '../constants.js';
import { KhanPalOverrideType } from '../enums.js';
import type { DataArchive } from '../data/DataArchive.js';
import { Palette } from './Palette.js';
import { PaletteTable } from './PaletteTable.js';

/**
 * Luminance-based alpha look-up table (11 entries, index 0..10).
 * Extracted from DAT_006d1f08 in the Dark Ages client.
 * tableIndex = Math.min(maxChannel / 25, 10)
 * alpha = LUT[tableIndex] * 255 / 10
 */
const ALPHA_LUT = [0, 0, 0, 1, 2, 3, 5, 6, 7, 9, 10] as const;

/**
 * Combines a PaletteTable (ID → palette number mapping) with a palette dictionary
 * (palette number → Palette) to resolve the correct Palette for any external ID.
 */
export class PaletteLookup {
  palettes: Map<number, Palette>;
  table: PaletteTable;

  constructor(palettes: Map<number, Palette>, table: PaletteTable) {
    this.palettes = palettes;
    this.table = table;
  }

  /** Returns the highest palette number + 1. */
  getNextPaletteId(): number {
    let max = -1;
    for (const k of this.palettes.keys()) if (k > max) max = k;
    return max + 1;
  }

  /**
   * Gets the Palette for the given external ID.
   * When the palette number is ≥ 1000, subtracts 1000 and applies luminance blending
   * (each color's alpha is set proportional to its brightest channel).
   */
  getPaletteForId(id: number, khanPalOverrideType: KhanPalOverrideType = KhanPalOverrideType.None): Palette {
    let paletteNumber = this.table.getPaletteNumber(id, khanPalOverrideType);
    let useLuminanceBlending = false;

    if (paletteNumber >= 1000) {
      paletteNumber -= 1000;
      useLuminanceBlending = true;
    }

    const palette = this.palettes.get(paletteNumber);
    if (!palette) throw new Error(`Palette ${paletteNumber} not found`);

    if (!useLuminanceBlending) return palette;

    const blended = new Palette();
    for (let i = 0; i < COLORS_PER_PALETTE; i++) {
      const c = palette.colors[i]!;
      const maxChannel = Math.max(c.r, c.g, c.b);
      const tableIndex = Math.min(Math.floor(maxChannel / 25), 10);
      const alpha = Math.round(Math.min(ALPHA_LUT[tableIndex]! * 255 / 10, 255));
      blended.colors[i] = { r: c.r, g: c.g, b: c.b, a: alpha };
    }
    return blended;
  }

  // ---------------------------------------------------------------------------
  // Factory methods
  // ---------------------------------------------------------------------------

  static fromArchive(pattern: string, archive: DataArchive): PaletteLookup {
    return new PaletteLookup(
      Palette.fromArchive(pattern, archive),
      PaletteTable.fromArchive(pattern, archive),
    );
  }

  static fromArchivePatterns(
    tablePattern: string,
    palettePattern: string,
    archive: DataArchive,
  ): PaletteLookup {
    return new PaletteLookup(
      Palette.fromArchive(palettePattern, archive),
      PaletteTable.fromArchive(tablePattern, archive),
    );
  }
}
