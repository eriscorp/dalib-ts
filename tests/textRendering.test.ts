import { describe, expect, it } from 'vitest';
import { FntFile } from '../src/drawing/FntFile.js';
import {
  LftFile,
  LFT_BITMAP_BASE,
  LFT_GLYPH_COUNT,
  LFT_RECORD_LENGTH,
} from '../src/drawing/LftFile.js';
import {
  drawGlyph,
  drawLftGlyph,
  getGlyphIndex,
  lftGlyphKeys,
  measureLftText,
  measureText,
  renderLftText,
  renderText,
} from '../src/drawing/Graphics.js';

const WHITE = { r: 255, g: 255, b: 255, a: 255 };

/** An English FNT: 94 glyphs of 8×12, every pixel set. */
function solidEnglishFnt(): FntFile {
  return FntFile.fromBuffer(new Uint8Array(94 * 12).fill(0xff), 8, 12);
}

describe('FNT text rendering (dormant format)', () => {
  it('maps printable ASCII to a glyph index', () => {
    const font = solidEnglishFnt();
    // The English face starts at '!' (0x21), so 'A' lands at 0x41 - 33.
    expect(getGlyphIndex(font, '!')).toBe(0);
    expect(getGlyphIndex(font, 'A')).toBe(0x41 - 33);
    expect(getGlyphIndex(font, '~')).toBe(93);
  });

  it('returns -1 for a character the face does not cover', () => {
    const font = solidEnglishFnt();
    expect(getGlyphIndex(font, ' ')).toBe(-1);
    expect(getGlyphIndex(font, '\n')).toBe(-1);
  });

  it('measures a line and tracks the widest of several', () => {
    const font = solidEnglishFnt();
    expect(measureText(font, '')).toBe(0);
    const one = measureText(font, 'AB');
    expect(one).toBeGreaterThan(0);
    // The widest line wins, not the total.
    expect(measureText(font, `AB\nA`)).toBe(one);
  });

  it('renders text to a frame sized by the line count', () => {
    const font = solidEnglishFnt();
    const single = renderText(font, 'AB', WHITE);
    const double = renderText(font, 'AB\nCD', WHITE);
    expect(double.height).toBe(single.height * 2);
    expect(single.data.some(v => v !== 0)).toBe(true);
  });

  it('renders a blank frame for empty text', () => {
    const frame = renderText(solidEnglishFnt(), '', WHITE);
    expect(frame.width).toBeGreaterThan(0);
    expect(frame.height).toBeGreaterThan(0);
  });

  it('draws a glyph into a caller buffer and clips out-of-bounds writes', () => {
    const font = solidEnglishFnt();
    const width = 8;
    const buffer = new Uint8ClampedArray(width * 12 * 4);

    drawGlyph(font, buffer, width, 0, 0, 0, WHITE);
    expect(buffer.some(v => v !== 0)).toBe(true);

    // Drawing far off-canvas must not throw or write anything.
    const clean = new Uint8ClampedArray(width * 12 * 4);
    drawGlyph(font, clean, width, 0, 1000, 1000, WHITE);
    expect(clean.every(v => v === 0)).toBe(true);
  });

  it('ignores an invalid glyph index', () => {
    const font = solidEnglishFnt();
    const buffer = new Uint8ClampedArray(8 * 12 * 4);
    drawGlyph(font, buffer, 8, 9999, 0, 0, WHITE);
    expect(buffer.every(v => v === 0)).toBe(true);
  });

  it('leaves the background untouched where a glyph row is blank', () => {
    // Only the first row of the first glyph is inked.
    const data = new Uint8Array(94 * 12);
    data[0] = 0xff;
    const font = FntFile.fromBuffer(data, 8, 12);

    const buffer = new Uint8ClampedArray(8 * 12 * 4);
    drawGlyph(font, buffer, 8, 0, 0, 0, WHITE);

    expect(buffer[3]).toBe(255);           // row 0 is drawn
    expect(buffer[8 * 4 * 1 + 3]).toBe(0); // row 1 stays clear
  });

  it('draws only the set bits within a partially inked row', () => {
    const data = new Uint8Array(94 * 12);
    data[0] = 0b1000_0001; // leftmost and rightmost pixel of row 0
    const font = FntFile.fromBuffer(data, 8, 12);

    const buffer = new Uint8ClampedArray(8 * 12 * 4);
    drawGlyph(font, buffer, 8, 0, 0, 0, WHITE);

    expect(buffer[3]).toBe(255);       // x = 0
    expect(buffer[1 * 4 + 3]).toBe(0); // x = 1
    expect(buffer[7 * 4 + 3]).toBe(255); // x = 7
  });

  describe('getGlyphIndex for the non-English faces', () => {
    // The Korean face is 2401 glyphs: 51 Jamo then the Hangul syllable block.
    const koreanFnt = () => FntFile.fromBuffer(new Uint8Array(2401 * 12 * 2), 16, 12);

    it('rejects ASCII in a Korean face', () => {
      expect(getGlyphIndex(koreanFnt(), 'A')).toBe(-1);
    });

    // Node's TextEncoder ignores its label argument and always emits UTF-8, so no
    // EUC-KR encoder is available and every multi-byte character resolves to -1.
    // The lookup must degrade to that rather than throwing.
    it('returns -1 for Hangul when no EUC-KR encoder is available', () => {
      expect(getGlyphIndex(koreanFnt(), '가')).toBe(-1);
    });

    it('falls back to a direct ASCII offset for a face of an unknown size', () => {
      const odd = FntFile.fromBuffer(new Uint8Array(50 * 12), 8, 12);
      expect(getGlyphIndex(odd, '!')).toBe(0);
      expect(getGlyphIndex(odd, 'A')).toBe(0x41 - 33);
      // Past the end of the face.
      expect(getGlyphIndex(odd, '~')).toBe(-1);
    });
  });
});

describe('LFT text rendering (active format)', () => {
  /** Build an LFT with the supplied glyph records and bitmap region. */
  function buildLft(
    records: Array<{ key: number; advance: number; left: number; top: number; right: number; bottom: number; bitmapOffset: number }>,
    bitmapLength = 64,
  ): LftFile {
    const buf = new Uint8Array(LFT_BITMAP_BASE + bitmapLength);
    const view = new DataView(buf.buffer);
    view.setUint16(0, 12, true);
    view.setUint16(2, 12, true);

    for (const r of records) {
      const o = 4 + r.key * LFT_RECORD_LENGTH;
      buf[o] = r.advance;
      buf[o + 1] = r.left;
      buf[o + 2] = r.top;
      buf[o + 3] = r.right;
      buf[o + 4] = r.bottom;
      view.setUint32(o + 7, r.bitmapOffset, true);
    }
    // Set every bitmap bit so any referenced glyph is fully inked.
    buf.fill(0xff, LFT_BITMAP_BASE);
    return LftFile.fromBuffer(buf);
  }

  const FONT = buildLft([
    { key: 0x41, advance: 6, left: 0, top: 0, right: 4, bottom: 4, bitmapOffset: 8 },
    { key: 0x20, advance: 99, left: 0, top: 0, right: 0, bottom: 0, bitmapOffset: 0 },
  ]);

  it('places the bitmap region exactly after the record table', () => {
    expect(LFT_BITMAP_BASE).toBe(4 + LFT_GLYPH_COUNT * LFT_RECORD_LENGTH);
  });

  it('rejects a buffer that is too short to hold the record table', () => {
    expect(() => LftFile.fromBuffer(new Uint8Array(100))).toThrow(/at least/);
  });

  describe('lftGlyphKeys', () => {
    it('maps single-byte text to one key per byte', () => {
      expect(lftGlyphKeys('AB')).toEqual([0x41, 0x42]);
    });

    it('combines a DBCS pair into one key', () => {
      const isLead = (b: number) => b >= 0xb0 && b <= 0xc8;
      expect(lftGlyphKeys(new Uint8Array([0xb0, 0xa1, 0x41]), isLead)).toEqual([0xb0a1, 0x41]);
    });

    it('drops a trailing lead byte with no partner', () => {
      const isLead = (b: number) => b === 0xb0;
      expect(lftGlyphKeys(new Uint8Array([0x41, 0xb0]), isLead)).toEqual([0x41]);
    });

    it('accepts a plain number array and skips code units above 0xFF', () => {
      expect(lftGlyphKeys([1, 2, 3])).toEqual([1, 2, 3]);
      expect(lftGlyphKeys('A你B')).toEqual([0x41, 0x42]);
    });
  });

  describe('advance rules', () => {
    it('uses the stored advance for an ordinary glyph', () => {
      expect(FONT.getAdvance(0x41)).toBe(6);
    });

    it('forces zero for backspace, tab, line feed and carriage return', () => {
      for (const c of [0x08, 0x09, 0x0a, 0x0d]) expect(FONT.getAdvance(c)).toBe(0);
    });

    it('falls back to half the nominal width for a space with no bitmap', () => {
      expect(FONT.getAdvance(0x20)).toBe(6);
    });

    it('is zero for a key with no record', () => {
      expect(FONT.getAdvance(0xfffe)).toBe(0);
    });
  });

  describe('glyph pixels', () => {
    it('decodes an inked glyph to an alpha mask', () => {
      const g = FONT.getGlyphPixels(0x41);
      expect(g.width).toBe(4);
      expect(g.height).toBe(4);
      expect(Array.from(g.data).every(v => v === 255)).toBe(true);
    });

    it('returns an empty mask for a glyph with no bitmap', () => {
      const g = FONT.getGlyphPixels(0x20);
      expect(g.width).toBe(0);
      expect(g.data).toHaveLength(0);
    });

    it('returns an empty mask for an unknown key', () => {
      expect(FONT.getGlyphPixels(0xfffe).width).toBe(0);
    });

    it('returns an empty mask for a glyph whose bounds enclose no area', () => {
      // A record with a bitmap offset but a collapsed box: the size comes from
      // the bounds, not from the stored packed size, so it decodes to nothing.
      const empty = buildLft([
        { key: 0x43, advance: 3, left: 0, top: 0, right: 0, bottom: 4, bitmapOffset: 8 },
      ]);
      const g = empty.getGlyphPixels(0x43);
      expect(g.width).toBe(0);
      expect(g.height).toBe(0);
      expect(g.data).toHaveLength(0);
    });
  });

  describe('measureLftText', () => {
    it('sums advances and unions the ink box', () => {
      const metrics = measureLftText(FONT, [0x41, 0x41]);
      expect(metrics.advanceWidth).toBe(12);
      expect(metrics.ink).toEqual({ left: 0, top: 0, right: 10, bottom: 4 });
    });

    it('reports an empty ink box for a line with no inked glyphs', () => {
      const metrics = measureLftText(FONT, [0x20]);
      expect(metrics.ink).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
      expect(metrics.advanceWidth).toBe(6);
    });

    it('is zero for an empty line', () => {
      expect(measureLftText(FONT, []).advanceWidth).toBe(0);
    });
  });

  describe('renderLftText', () => {
    it('renders one line at the nominal height', () => {
      const frame = renderLftText(FONT, [0x41, 0x41], WHITE);
      expect(frame.height).toBe(12);
      expect(frame.width).toBe(12);
      expect(frame.data.some(v => v !== 0)).toBe(true);
    });

    it('starts a new line on a line feed', () => {
      const frame = renderLftText(FONT, [0x41, 0x0a, 0x41], WHITE);
      expect(frame.height).toBe(24);
    });

    it('accepts a string as well as keys', () => {
      expect(renderLftText(FONT, 'AA', WHITE).width).toBe(12);
    });

    it('produces a minimum 1×n frame for empty input', () => {
      const frame = renderLftText(FONT, [], WHITE);
      expect(frame.width).toBeGreaterThanOrEqual(1);
      expect(frame.height).toBeGreaterThanOrEqual(1);
    });
  });

  describe('drawLftGlyph', () => {
    it('draws into a caller buffer', () => {
      const buffer = new Uint8ClampedArray(8 * 8 * 4);
      drawLftGlyph(FONT, buffer, 8, 0x41, 0, 0, WHITE);
      expect(buffer.some(v => v !== 0)).toBe(true);
    });

    it('draws nothing for a glyph with no bitmap or an unknown key', () => {
      const buffer = new Uint8ClampedArray(8 * 8 * 4);
      drawLftGlyph(FONT, buffer, 8, 0x20, 0, 0, WHITE);
      drawLftGlyph(FONT, buffer, 8, 0xfffe, 0, 0, WHITE);
      expect(buffer.every(v => v === 0)).toBe(true);
    });

    it('clips a glyph drawn off-canvas', () => {
      const buffer = new Uint8ClampedArray(8 * 8 * 4);
      drawLftGlyph(FONT, buffer, 8, 0x41, 500, 500, WHITE);
      expect(buffer.every(v => v === 0)).toBe(true);
    });

    it('clips the columns that fall past the right edge', () => {
      // A 4-wide glyph drawn with its pen two pixels from the edge of a 6-wide
      // buffer: two columns land, two are clipped.
      const buffer = new Uint8ClampedArray(6 * 8 * 4);
      drawLftGlyph(FONT, buffer, 6, 0x41, 4, 0, WHITE);
      expect(buffer[4 * 4 + 3]).toBe(255);
      expect(buffer[5 * 4 + 3]).toBe(255);
      // Nothing wrapped onto the next row.
      expect(buffer[6 * 4 + 3]).toBe(0);
    });

    it('skips the clear pixels of a partially inked glyph', () => {
      // Build a font whose glyph bitmap has only the top-left bit set.
      const buf = new Uint8Array(LFT_BITMAP_BASE + 32);
      const view = new DataView(buf.buffer);
      view.setUint16(0, 12, true);
      view.setUint16(2, 12, true);
      const o = 4 + 0x42 * LFT_RECORD_LENGTH;
      buf[o] = 4;     // advance
      buf[o + 3] = 2; // right
      buf[o + 4] = 2; // bottom
      view.setUint32(o + 7, 8, true);
      buf[LFT_BITMAP_BASE + 8] = 0b1000_0000; // row 0, leftmost pixel only

      const font = LftFile.fromBuffer(buf);
      const buffer = new Uint8ClampedArray(4 * 4 * 4);
      drawLftGlyph(font, buffer, 4, 0x42, 0, 0, WHITE);

      expect(buffer[3]).toBe(255);       // the one inked pixel
      expect(buffer[1 * 4 + 3]).toBe(0); // its clear neighbour
    });
  });
});
