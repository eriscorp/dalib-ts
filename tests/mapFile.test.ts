import { describe, expect, it } from 'vitest';
import { MapFile } from '../src/data/MapFile.js';

/** Build a width×height map body: three uint16 LE per cell, row-major. */
function body(width: number, height: number, cell: (x: number, y: number) => [number, number, number]): Uint8Array {
  const bytes = new Uint8Array(width * height * 6);
  const view = new DataView(bytes.buffer);
  let o = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [bg, lf, rf] = cell(x, y);
      view.setUint16(o, bg, true);
      view.setUint16(o + 2, lf, true);
      view.setUint16(o + 4, rf, true);
      o += 6;
    }
  }
  return bytes;
}

describe('MapFile', () => {
  it('is a row-major grid of six-byte cells', () => {
    const map = MapFile.fromBuffer(body(3, 2, (x, y) => [y * 10 + x, 100 + x, 200 + y]), 3, 2);
    expect(map.width).toBe(3);
    expect(map.height).toBe(2);
    expect(map.tiles).toHaveLength(6);
    expect(map.getTile(2, 1)).toEqual({ background: 12, leftForeground: 102, rightForeground: 201 });
  });

  it('defaults every cell to zero', () => {
    const map = new MapFile(2, 2);
    expect(map.getTile(1, 1)).toEqual({ background: 0, leftForeground: 0, rightForeground: 0 });
  });

  it('setTile writes to the addressed cell only', () => {
    const map = new MapFile(2, 2);
    map.setTile(1, 0, { background: 5, leftForeground: 6, rightForeground: 7 });
    expect(map.getTile(1, 0).background).toBe(5);
    expect(map.getTile(0, 0).background).toBe(0);
  });

  // Tile IDs are unsigned: the empty-static sentinel is 0x2710 and real banks run to
  // ~20,000, so a signed read would wrap anything above 0x7FFF into a negative.
  it('reads tile IDs as unsigned', () => {
    const map = MapFile.fromBuffer(body(1, 1, () => [0xffff, 0x8000, 0x2710]), 1, 1);
    expect(map.getTile(0, 0)).toEqual({
      background: 0xffff,
      leftForeground: 0x8000,
      rightForeground: 0x2710,
    });
  });

  it('round-trips through toUint8Array', () => {
    const original = body(4, 3, (x, y) => [x + y, 0xffff, 0x2710]);
    const out = MapFile.fromBuffer(original, 4, 3).toUint8Array();
    expect(Array.from(out)).toEqual(Array.from(original));
  });

  // Matches the client's file_read_map_cells: a short file is rejected outright,
  // while bytes past the expected array are ignored.
  it('rejects a buffer shorter than width × height × 6', () => {
    expect(() => MapFile.fromBuffer(new Uint8Array(5), 1, 1)).toThrow(/expected at least/);
  });

  it('accepts and ignores trailing bytes', () => {
    const padded = new Uint8Array(6 + 32);
    padded.set(body(1, 1, () => [7, 8, 9]), 0);
    const map = MapFile.fromBuffer(padded, 1, 1);
    expect(map.getTile(0, 0).background).toBe(7);
  });

  it('accepts an ArrayBuffer', () => {
    const bytes = body(1, 1, () => [1, 2, 3]);
    const map = MapFile.fromBuffer(bytes.buffer as ArrayBuffer, 1, 1);
    expect(map.getTile(0, 0).leftForeground).toBe(2);
  });

  it('handles a single-cell map', () => {
    const map = MapFile.fromBuffer(body(1, 1, () => [1, 2, 3]), 1, 1);
    expect(map.tiles).toHaveLength(1);
    expect(map.toUint8Array()).toHaveLength(6);
  });
});
