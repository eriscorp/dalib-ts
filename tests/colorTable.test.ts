import { describe, expect, it } from 'vitest';
import { ColorTable } from '../src/drawing/ColorTable.js';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('ColorTable', () => {
  it('parses a normal dye table', () => {
    const table = ColorTable.fromBuffer(
      encode(['2', '5', '255,0,0', '0,255,0', '9', '0,0,255', '10,20,30'].join('\n')),
    );
    expect(table.entries).toHaveLength(2);
    expect(table.get(5)?.colors).toEqual([
      { r: 255, g: 0, b: 0, a: 255 },
      { r: 0, g: 255, b: 0, a: 255 },
    ]);
    expect(table.get(9)?.colors[1]).toEqual({ r: 10, g: 20, b: 30, a: 255 });
  });

  it('treats an empty color line as transparent', () => {
    const table = ColorTable.fromBuffer(encode(['1', '3', ''].join('\n')));
    expect(table.get(3)?.colors).toEqual([{ r: 0, g: 0, b: 0, a: 0 }]);
  });

  it('rejects an out-of-range colorsPerEntry header without runaway allocation', () => {
    // A non-dye .tbl (or corrupt blob) whose first line is a huge integer must
    // not allocate ~that many objects. Returns an empty table and completes fast.
    const table = ColorTable.fromBuffer(encode(['2000000000', '0', '1,2,3'].join('\n')));
    expect(table.entries).toHaveLength(0);
  });

  it('stops at EOF instead of padding a truncated final entry', () => {
    // Header declares 5 colors per entry but only 2 lines follow the index line.
    const table = ColorTable.fromBuffer(encode(['5', '7', '1,1,1', '2,2,2'].join('\n')));
    expect(table.get(7)?.colors).toHaveLength(2); // not padded out to 5
  });
});
