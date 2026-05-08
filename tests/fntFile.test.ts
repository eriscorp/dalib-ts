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
});
