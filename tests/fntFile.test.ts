import { describe, expect, it } from 'vitest';
import { FntFile } from '../src/drawing/FntFile.js';

describe('FntFile', () => {
  it('decodes 8×2 glyph bytes MSB-first via getGlyphPixels', () => {
    // Two rows: 0b10000001 (corner pixels) and 0b00011000 (middle two pixels).
    const fnt = FntFile.fromBuffer(new Uint8Array([0b10000001, 0b00011000]), 8, 2);
    expect(fnt.glyphCount).toBe(1);
    expect(Array.from(fnt.getGlyphPixels(0))).toEqual([
      1, 0, 0, 0, 0, 0, 0, 1,
      0, 0, 0, 1, 1, 0, 0, 0,
    ]);
  });

  it('decodes 16×1 Korean-cell glyph across two bytes per row', () => {
    // 0b11000001 0b00000011 → leftmost two on, then 13 off, then two on at the right end.
    const fnt = FntFile.fromBuffer(new Uint8Array([0b11000001, 0b00000011]), 16, 1);
    expect(Array.from(fnt.getGlyphPixels(0))).toEqual([
      1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1,
    ]);
  });

  it('getGlyphData returns raw bytes without decoding', () => {
    const raw = new Uint8Array([0b10101010, 0b01010101]);
    const fnt = FntFile.fromBuffer(raw, 8, 2);
    expect(Array.from(fnt.getGlyphData(0))).toEqual([0b10101010, 0b01010101]);
  });

  it('throws RangeError for out-of-range glyph indices', () => {
    const fnt = FntFile.fromBuffer(new Uint8Array([0, 0]), 8, 2);
    expect(() => fnt.getGlyphPixels(99)).toThrow(RangeError);
    expect(() => fnt.getGlyphData(99)).toThrow(RangeError);
  });

  // Round-trip a known, deliberately left-heavy glyph shape (a capital "F") in a
  // real 8×12 English cell. The shape is asymmetric across each byte, so it only
  // decodes correctly under MSB-first — a regression back to LSB-first would
  // scramble every row and fail this test. (The repo synthesizes all fixtures;
  // there are no committed binary assets, so we encode the reference here.)
  it('round-trips a known 8×12 glyph shape MSB-first', () => {
    // prettier-ignore
    const F = [
      [1, 1, 1, 1, 1, 1, 0, 0],
      [1, 1, 0, 0, 0, 0, 0, 0],
      [1, 1, 0, 0, 0, 0, 0, 0],
      [1, 1, 0, 0, 0, 0, 0, 0],
      [1, 1, 1, 1, 1, 0, 0, 0],
      [1, 1, 1, 1, 1, 0, 0, 0],
      [1, 1, 0, 0, 0, 0, 0, 0],
      [1, 1, 0, 0, 0, 0, 0, 0],
      [1, 1, 0, 0, 0, 0, 0, 0],
      [1, 1, 0, 0, 0, 0, 0, 0],
      [1, 1, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
    ];
    // Encode the grid to 1bpp MSB-first bytes (one byte per 8-wide row).
    const bytes = new Uint8Array(F.length);
    for (let y = 0; y < F.length; y++) {
      let b = 0;
      for (let x = 0; x < 8; x++) if (F[y]![x]) b |= 1 << (7 - x);
      bytes[y] = b;
    }

    const fnt = FntFile.fromBuffer(bytes, 8, 12);
    expect(fnt.glyphCount).toBe(1);
    expect(Array.from(fnt.getGlyphPixels(0))).toEqual(F.flat());

    // Sanity: this shape is not bit-symmetric, so an LSB-first reading of the same
    // bytes would differ — the property that makes the assertion above a real guard.
    const lsbFirst = Array.from({ length: 8 }, (_, x) => (bytes[0]! >> x) & 1);
    expect(lsbFirst).not.toEqual(F[0]);
  });
});
