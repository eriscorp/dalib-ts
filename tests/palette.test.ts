import { describe, expect, it } from 'vitest';
import { COLORS_PER_PALETTE, PALETTE_DYE_INDEX_START } from '../src/constants.js';
import { Palette } from '../src/drawing/Palette.js';
import { emptyColorTableEntry } from '../src/drawing/ColorTableEntry.js';

/** A 768-byte PAL where index i is the greyscale (i, i, i). */
function greyPalBytes(): Uint8Array {
  const bytes = new Uint8Array(COLORS_PER_PALETTE * 3);
  for (let i = 0; i < COLORS_PER_PALETTE; i++) {
    bytes[i * 3] = i;
    bytes[i * 3 + 1] = i;
    bytes[i * 3 + 2] = i;
  }
  return bytes;
}

describe('Palette', () => {
  it('is 256 transparent entries by default', () => {
    const p = new Palette();
    expect(p.length).toBe(COLORS_PER_PALETTE);
    expect(p.get(0)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('pads a short colors array up to 256 and truncates a long one', () => {
    const short = new Palette([{ r: 1, g: 2, b: 3, a: 255 }]);
    expect(short.length).toBe(COLORS_PER_PALETTE);
    expect(short.get(0)).toEqual({ r: 1, g: 2, b: 3, a: 255 });
    expect(short.get(255).a).toBe(0);

    const long = new Palette(Array.from({ length: 300 }, () => ({ r: 9, g: 9, b: 9, a: 255 })));
    expect(long.length).toBe(COLORS_PER_PALETTE);
  });

  it('parses a 768-byte PAL as opaque RGB', () => {
    const p = Palette.fromBuffer(greyPalBytes());
    expect(p.get(0)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(p.get(200)).toEqual({ r: 200, g: 200, b: 200, a: 255 });
    // PAL bytes are full 8-bit channels, not VGA 6-bit — 255 must stay 255.
    expect(p.get(255).r).toBe(255);
  });

  it('accepts an ArrayBuffer', () => {
    const bytes = greyPalBytes();
    const p = Palette.fromBuffer(bytes.buffer as ArrayBuffer);
    expect(p.get(7).r).toBe(7);
  });

  it('round-trips through toUint8Array (alpha is not stored)', () => {
    const original = greyPalBytes();
    const out = Palette.fromBuffer(original).toUint8Array();
    expect(out.length).toBe(COLORS_PER_PALETTE * 3);
    expect(Array.from(out)).toEqual(Array.from(original));
  });

  it('set and get address the same slot', () => {
    const p = new Palette();
    p.set(5, { r: 1, g: 2, b: 3, a: 4 });
    expect(p.get(5)).toEqual({ r: 1, g: 2, b: 3, a: 4 });
  });

  describe('cycle', () => {
    it('is a no-op at stage 0', () => {
      const p = Palette.fromBuffer(greyPalBytes());
      const cycled = p.cycle(10, 14, 0);
      for (let i = 10; i <= 14; i++) expect(cycled.get(i).r).toBe(i);
    });

    it('rotates the range by the stage and leaves the rest untouched', () => {
      const p = Palette.fromBuffer(greyPalBytes());
      const cycled = p.cycle(10, 14, 1);
      // Rotating a 5-wide window by one step moves the last entry to the front.
      expect(cycled.get(10).r).toBe(14);
      expect(cycled.get(11).r).toBe(10);
      expect(cycled.get(14).r).toBe(13);
      // Outside the window nothing moved.
      expect(cycled.get(9).r).toBe(9);
      expect(cycled.get(15).r).toBe(15);
    });

    it('wraps a stage larger than the range and handles negatives', () => {
      const p = Palette.fromBuffer(greyPalBytes());
      const rangeLen = 5;
      expect(p.cycle(10, 14, rangeLen).get(10).r).toBe(p.cycle(10, 14, 0).get(10).r);
      // -1 lands on the same place as +(rangeLen - 1).
      expect(p.cycle(10, 14, -1).get(10).r).toBe(p.cycle(10, 14, rangeLen - 1).get(10).r);
    });

    it('does not mutate the source palette', () => {
      const p = Palette.fromBuffer(greyPalBytes());
      p.cycle(10, 14, 2);
      expect(p.get(10).r).toBe(10);
    });
  });

  describe('dye', () => {
    it('copies the entry colors in at the default dye index', () => {
      const p = Palette.fromBuffer(greyPalBytes());
      const entry = emptyColorTableEntry();
      entry.colors = Array.from({ length: 6 }, (_, i) => ({ r: 100 + i, g: 0, b: 0, a: 255 }));

      const dyed = p.dye(entry);
      for (let i = 0; i < 6; i++) {
        expect(dyed.get(PALETTE_DYE_INDEX_START + i).r).toBe(100 + i);
      }
      // Neighbouring slots are untouched.
      expect(dyed.get(PALETTE_DYE_INDEX_START - 1).r).toBe(PALETTE_DYE_INDEX_START - 1);
    });

    it('honours an explicit dye start index and leaves the source alone', () => {
      const p = Palette.fromBuffer(greyPalBytes());
      const entry = emptyColorTableEntry();
      entry.colors = [{ r: 7, g: 7, b: 7, a: 255 }];

      const dyed = p.dye(entry, 10);
      expect(dyed.get(10).r).toBe(7);
      expect(p.get(10).r).toBe(10);
    });
  });
});

describe('emptyColorTableEntry', () => {
  it('is six transparent colors at index 0', () => {
    const entry = emptyColorTableEntry();
    expect(entry.colorIndex).toBe(0);
    expect(entry.colors).toHaveLength(6);
    expect(entry.colors.every(c => c.a === 0)).toBe(true);
  });
});
