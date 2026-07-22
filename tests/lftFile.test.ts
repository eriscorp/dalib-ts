import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DataArchive } from '../src/data/DataArchive.js';
import {
  LftFile,
  LFT_BITMAP_BASE,
  LFT_GLYPH_COUNT,
  LFT_RECORD_LENGTH,
  lftRowStride,
} from '../src/drawing/LftFile.js';
import { measureLftText, renderLftText } from '../src/drawing/Graphics.js';

/**
 * Build a minimal but well-formed LFT: a full 65,535-record table plus a bitmap region.
 * The caller supplies records for the low keys; everything else is an empty glyph.
 */
function buildLft(
  nominalWidth: number,
  nominalHeight: number,
  records: Array<{
    key: number;
    advance: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
    bitmapOffset: number;
    packedSize?: number;
  }>,
  bitmap: Uint8Array,
): Uint8Array {
  const buf = new Uint8Array(LFT_BITMAP_BASE + bitmap.length);
  const view = new DataView(buf.buffer);
  view.setUint16(0, nominalWidth, true);
  view.setUint16(2, nominalHeight, true);

  for (const r of records) {
    const o = 4 + r.key * LFT_RECORD_LENGTH;
    buf[o] = r.advance;
    buf[o + 1] = r.left;
    buf[o + 2] = r.top;
    buf[o + 3] = r.right;
    buf[o + 4] = r.bottom;
    view.setUint16(o + 5, r.packedSize ?? 0, true);
    view.setUint32(o + 7, r.bitmapOffset, true);
  }

  buf.set(bitmap, LFT_BITMAP_BASE);
  return buf;
}

describe('LftFile', () => {
  it('the record table lines up with the client bitmap base', () => {
    // The client seeks directly to 0x0AFFF9; this is the constraint that proves it.
    expect(4 + LFT_GLYPH_COUNT * LFT_RECORD_LENGTH).toBe(0x0afff9);
    expect(LFT_BITMAP_BASE).toBe(0x0afff9);
  });

  it('decodes a glyph mask MSB-first with 4-byte row padding', () => {
    // A 3×2 glyph. stride = ((3 + 31) / 32) * 4 = 4 bytes per row.
    expect(lftRowStride(3)).toBe(4);
    // Offset 0 is the "no bitmap" sentinel, so place the glyph after a pad byte.
    const bitmap = new Uint8Array(16);
    bitmap[8] = 0b10100000; // row 0: pixels at x=0 and x=2
    bitmap[12] = 0b01000000; // row 1: pixel at x=1
    const lft = LftFile.fromBuffer(
      buildLft(6, 6, [
        { key: 0x41, advance: 4, left: 0, top: 0, right: 3, bottom: 2, bitmapOffset: 8 },
      ], bitmap),
    );

    const g = lft.getGlyphPixels(0x41);
    expect(g.width).toBe(3);
    expect(g.height).toBe(2);
    expect(Array.from(g.data)).toEqual([255, 0, 255, 0, 255, 0]);
  });

  it('applies the client advance rules', () => {
    const lft = LftFile.fromBuffer(
      buildLft(12, 12, [
        { key: 0x41, advance: 7, left: 0, top: 0, right: 5, bottom: 8, bitmapOffset: 16 },
        // Space with no bitmap → falls back to nominalWidth / 2.
        { key: 0x20, advance: 99, left: 0, top: 0, right: 0, bottom: 0, bitmapOffset: 0 },
      ], new Uint8Array(64)),
    );

    expect(lft.getAdvance(0x41)).toBe(7);
    expect(lft.getAdvance(0x20)).toBe(6); // nominalWidth / 2
    // Control chars have a forced zero advance.
    for (const c of [0x08, 0x09, 0x0a, 0x0d]) expect(lft.getAdvance(c)).toBe(0);
  });

  it('measures a line by summing advances and unions ink bounds', () => {
    const lft = LftFile.fromBuffer(
      buildLft(12, 12, [
        { key: 0x41, advance: 6, left: 1, top: 2, right: 5, bottom: 9, bitmapOffset: 16 },
      ], new Uint8Array(64)),
    );

    const metrics = measureLftText(lft, [0x41, 0x41]);
    expect(metrics.advanceWidth).toBe(12);
    // Second glyph is offset by one advance (6).
    expect(metrics.ink).toEqual({ left: 1, top: 2, right: 11, bottom: 9 });
  });

  it('renders multi-line text at nominal-height line spacing', () => {
    const lft = LftFile.fromBuffer(
      buildLft(12, 12, [
        { key: 0x41, advance: 6, left: 0, top: 0, right: 4, bottom: 4, bitmapOffset: 0 },
      ], new Uint8Array(64)),
    );

    const frame = renderLftText(lft, [0x41, 0x0a, 0x41], { r: 255, g: 255, b: 255, a: 255 });
    expect(frame.height).toBe(24); // 2 lines × nominal height 12
  });

  const clientRoot = 'e:/games/dark ages';
  const nationalDat = `${clientRoot}/national.dat`;
  describe.skipIf(!existsSync(nationalDat))('against the installed da.lft', () => {
    it('has consistent, in-range bitmap records for every glyph', () => {
      const buf = readFileSync(nationalDat);
      const archive = DataArchive.fromBuffer(
        new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
      );
      const lft = LftFile.fromArchive('da.lft', archive);

      let checked = 0;
      for (let key = 0; key < LFT_GLYPH_COUNT; key++) {
        const glyph = lft.glyphs[key]!;
        if (glyph.bitmapOffset === 0) continue;
        checked++;

        const width = glyph.right - glyph.left;
        const height = glyph.bottom - glyph.top;
        const stride = lftRowStride(width);
        // The doc states packed_size == stride * rows and no range escapes the entry.
        expect(glyph.packedSize).toBe(stride * height);
        expect(glyph.bitmapOffset + glyph.packedSize).toBeLessThanOrEqual(
          lft.bitmapData.length,
        );
      }
      expect(checked).toBeGreaterThan(0);
    });
  });
});
