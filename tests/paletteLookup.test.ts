import { describe, expect, it } from 'vitest';
import { COLORS_PER_PALETTE } from '../src/constants.js';
import { KhanPalOverrideType } from '../src/enums.js';
import { Palette } from '../src/drawing/Palette.js';
import { PaletteLookup } from '../src/drawing/PaletteLookup.js';
import { PaletteTable } from '../src/drawing/PaletteTable.js';
import { scaleRangeByte } from '../src/utility/MathEx.js';

/** A palette whose every slot is one flat color, so lookups are identifiable. */
function flat(r: number, g = r, b = r): Palette {
  const p = new Palette();
  for (let i = 0; i < COLORS_PER_PALETTE; i++) p.set(i, { r, g, b, a: 255 });
  return p;
}

const table = (text: string) => PaletteTable.fromBuffer(new TextEncoder().encode(text));

describe('PaletteLookup', () => {
  it('resolves an ID through the table to a palette', () => {
    const lookup = new PaletteLookup(new Map([[7, flat(1)]]), table('5 7'));
    expect(lookup.getPaletteForId(5).get(0).r).toBe(1);
  });

  it('throws when the resolved palette number is absent', () => {
    const lookup = new PaletteLookup(new Map([[1, flat(1)]]), table('5 7'));
    expect(() => lookup.getPaletteForId(5)).toThrow(/Palette 7 not found/);
  });

  it('getNextPaletteId is one past the highest key', () => {
    expect(new PaletteLookup(new Map([[0, flat(1)], [9, flat(2)]]), new PaletteTable()).getNextPaletteId()).toBe(10);
    // An empty dictionary starts at zero.
    expect(new PaletteLookup(new Map(), new PaletteTable()).getNextPaletteId()).toBe(0);
  });

  it('passes the male/female override through to the table', () => {
    // "id value -1" is a male override, "-2" female; a bare pair is the general one.
    const lookup = new PaletteLookup(
      new Map([[1, flat(10)], [2, flat(20)], [3, flat(30)]]),
      table('5 1\n5 2 -1\n5 3 -2\n'),
    );
    expect(lookup.getPaletteForId(5).get(0).r).toBe(10);
    expect(lookup.getPaletteForId(5, KhanPalOverrideType.Male).get(0).r).toBe(20);
    expect(lookup.getPaletteForId(5, KhanPalOverrideType.Female).get(0).r).toBe(30);
  });

  describe('luminance blending', () => {
    // A palette number of 1000 or more means "subtract 1000 and blend by luminance":
    // each color's alpha is derived from its brightest channel.
    it('subtracts 1000 and selects the underlying palette', () => {
      const lookup = new PaletteLookup(new Map([[3, flat(255)]]), table('5 1003'));
      const result = lookup.getPaletteForId(5);
      expect(result.get(0).r).toBe(255);
    });

    it('leaves a pure-white entry fully opaque and a black entry transparent', () => {
      const p = new Palette();
      p.set(0, { r: 0, g: 0, b: 0, a: 255 });
      p.set(1, { r: 255, g: 255, b: 255, a: 255 });
      const lookup = new PaletteLookup(new Map([[0, p]]), table('5 1000'));

      const blended = lookup.getPaletteForId(5);
      expect(blended.get(0).a).toBe(0);
      expect(blended.get(1).a).toBe(255);
    });

    it('produces a monotonic alpha ramp with brightness', () => {
      const p = new Palette();
      for (let i = 0; i < COLORS_PER_PALETTE; i++) p.set(i, { r: i, g: 0, b: 0, a: 255 });
      const blended = new PaletteLookup(new Map([[0, p]]), table('5 1000')).getPaletteForId(5);

      for (let i = 1; i < COLORS_PER_PALETTE; i++) {
        expect(blended.get(i).a).toBeGreaterThanOrEqual(blended.get(i - 1).a);
      }
      // RGB is carried through untouched; only alpha is derived.
      expect(blended.get(200).r).toBe(200);
    });

    it('does not mutate the source palette', () => {
      const p = flat(255);
      new PaletteLookup(new Map([[0, p]]), table('5 1000')).getPaletteForId(5);
      expect(p.get(0).a).toBe(255);
    });
  });
});

describe('scaleRangeByte', () => {
  it('maps a value between two ranges', () => {
    expect(scaleRangeByte(0, 0, 255, 0, 31)).toBe(0);
    expect(scaleRangeByte(255, 0, 255, 0, 31)).toBe(31);
    expect(scaleRangeByte(128, 0, 255, 0, 31)).toBe(16);
  });

  it('rounds to the nearest integer', () => {
    expect(Number.isInteger(scaleRangeByte(100, 0, 255, 0, 31))).toBe(true);
  });

  it('supports a non-zero destination minimum', () => {
    expect(scaleRangeByte(0, 0, 10, 5, 15)).toBe(5);
    expect(scaleRangeByte(10, 0, 10, 5, 15)).toBe(15);
  });

  it('throws when the source range is empty', () => {
    expect(() => scaleRangeByte(1, 5, 5, 0, 10)).toThrow(RangeError);
  });
});
