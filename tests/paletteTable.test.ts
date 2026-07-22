import { describe, expect, it } from 'vitest';
import { PaletteTable } from '../src/drawing/PaletteTable.js';

describe('PaletteTable parsing', () => {
  it('skips // comment lines', () => {
    const table = PaletteTable.fromBuffer(
      new TextEncoder().encode(['// header comment', '5 42', '// trailing note'].join('\n')),
    );
    expect(table.getPaletteNumber(5)).toBe(42);
  });

  it('strips trailing // comments from a data line', () => {
    const table = PaletteTable.fromBuffer(
      new TextEncoder().encode('5 42 // inline note that must not be read as a palette id'),
    );
    // Without stripping, this would be parsed as the range "5..42 → NaN" or an override to
    // some bogus value. It must be the single override 5 → 42.
    expect(table.getPaletteNumber(5)).toBe(42);
  });

  it('tolerates multiple spaces between tokens', () => {
    const table = PaletteTable.fromBuffer(new TextEncoder().encode('1   3   7'));
    // Range 1..3 → palette 7.
    expect(table.getPaletteNumber(1)).toBe(7);
    expect(table.getPaletteNumber(2)).toBe(7);
    expect(table.getPaletteNumber(3)).toBe(7);
  });
});
