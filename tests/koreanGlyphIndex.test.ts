import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `getGlyphIndex` maps a Korean character to a glyph slot in the 2401-glyph FNT
 * face using its EUC-KR lead and trail bytes. Node's `TextEncoder` ignores its
 * label argument and always emits UTF-8, so the real encoder is never available
 * here and the arithmetic would otherwise go untested.
 *
 * These tests install a stand-in `TextEncoder` that returns the EUC-KR bytes for
 * a character, then load the module fresh so it picks the stand-in up. The
 * encoder is memoized on first use, so the reset is what makes this work.
 */

const REAL_TEXT_ENCODER = globalThis.TextEncoder;

/** EUC-KR bytes for the characters these tests use. */
const EUC_KR: Record<string, number[]> = {
  'ㄱ': [0xa4, 0xa1], // first Jamo → index 0
  'ㅎ': [0xa4, 0xd3], // last Jamo → index 50
  '가': [0xb0, 0xa1], // first syllable → index 51
  '힣': [0xc8, 0xfe], // last syllable → index 2400
  '中': [0xd6, 0xd0], // outside both ranges
};

/** Install a TextEncoder whose two-argument form returns EUC-KR bytes. */
function installEucKrEncoder(): void {
  class StubEncoder {
    private readonly eucKr: boolean;
    constructor(label?: string) {
      this.eucKr = label === 'euc-kr';
    }
    encode(input: string): Uint8Array {
      if (this.eucKr) {
        const bytes = EUC_KR[input];
        if (bytes) return new Uint8Array(bytes);
        // An unmapped character encodes to a single replacement byte.
        return new Uint8Array([0x3f]);
      }
      return new REAL_TEXT_ENCODER().encode(input);
    }
  }
  globalThis.TextEncoder = StubEncoder as unknown as typeof TextEncoder;
}

/** Load Graphics and FntFile fresh so the memoized encoder is rebuilt. */
async function loadGraphics() {
  vi.resetModules();
  const [{ getGlyphIndex }, { FntFile }] = await Promise.all([
    import('../src/drawing/Graphics.js'),
    import('../src/drawing/FntFile.js'),
  ]);
  // The Korean face is 2401 glyphs of 16×12, so two bytes per row.
  const font = FntFile.fromBuffer(new Uint8Array(2401 * 12 * 2), 16, 12);
  return { getGlyphIndex, font };
}

describe('getGlyphIndex with an EUC-KR encoder available', () => {
  beforeEach(installEucKrEncoder);
  afterEach(() => {
    globalThis.TextEncoder = REAL_TEXT_ENCODER;
    vi.resetModules();
  });

  it('maps the Jamo block to indexes 0 through 50', async () => {
    const { getGlyphIndex, font } = await loadGraphics();
    expect(getGlyphIndex(font, 'ㄱ')).toBe(0);
    expect(getGlyphIndex(font, 'ㅎ')).toBe(50);
  });

  it('maps the Hangul syllable block to indexes 51 through 2400', async () => {
    const { getGlyphIndex, font } = await loadGraphics();
    expect(getGlyphIndex(font, '가')).toBe(51);
    // The last syllable: 51 + (0xC8 - 0xB0) * 94 + (0xFE - 0xA1).
    expect(getGlyphIndex(font, '힣')).toBe(51 + 24 * 94 + 93);
    expect(getGlyphIndex(font, '힣')).toBe(2400);
  });

  it('returns -1 for a character outside both ranges', async () => {
    const { getGlyphIndex, font } = await loadGraphics();
    expect(getGlyphIndex(font, '中')).toBe(-1);
  });

  it('returns -1 when the character does not encode to a byte pair', async () => {
    const { getGlyphIndex, font } = await loadGraphics();
    // Not in the table, so the stub emits one replacement byte.
    expect(getGlyphIndex(font, '☃')).toBe(-1);
  });

  it('still rejects ASCII in a Korean face', async () => {
    const { getGlyphIndex, font } = await loadGraphics();
    expect(getGlyphIndex(font, 'A')).toBe(-1);
  });
});

describe('getGlyphIndex when the encoder constructor throws', () => {
  afterEach(() => {
    globalThis.TextEncoder = REAL_TEXT_ENCODER;
    vi.resetModules();
  });

  it('degrades to -1 rather than propagating the failure', async () => {
    // A runtime that rejects the label argument outright.
    class ThrowingEncoder {
      constructor(label?: string) {
        if (label) throw new RangeError(`unsupported encoding: ${label}`);
      }
      encode(input: string): Uint8Array {
        return new REAL_TEXT_ENCODER().encode(input);
      }
    }
    globalThis.TextEncoder = ThrowingEncoder as unknown as typeof TextEncoder;

    const { getGlyphIndex, font } = await loadGraphics();
    expect(getGlyphIndex(font, '가')).toBe(-1);
  });
});
