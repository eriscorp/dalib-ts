import { describe, expect, it } from 'vitest';
import { TILE_HEIGHT, TILE_WIDTH } from '../src/constants.js';
import { Palette } from '../src/drawing/Palette.js';
import { Tile } from '../src/drawing/Tile.js';
import { renderTile } from '../src/drawing/Graphics.js';

/** A palette where index i maps to a distinct opaque grey so pixels are traceable. */
function tracePalette(): Palette {
  const pal = new Palette();
  for (let i = 0; i < 256; i++) pal.colors[i] = { r: i, g: i, b: i, a: 255 };
  // Index 0 gets a recognizable non-black color to prove it is drawn opaque inside the diamond.
  pal.colors[0] = { r: 10, g: 20, b: 30, a: 255 };
  return pal;
}

/** The diamond span for a given row, matching the client's decode. */
function diamond(y: number): { left: number; right: number } {
  const left = Math.abs(13 - y) * 2;
  return { left, right: TILE_WIDTH - left };
}

describe('renderTile', () => {
  it('draws palette index 0 as an opaque color inside the diamond', () => {
    const data = new Uint8Array(TILE_WIDTH * TILE_HEIGHT); // all index 0
    const frame = renderTile(new Tile(data), tracePalette());

    // Center row 13 spans the full width; its center pixel is inside the diamond.
    const y = 13;
    const x = 28;
    const o = (y * TILE_WIDTH + x) * 4;
    expect(frame.data[o]).toBe(10);
    expect(frame.data[o + 1]).toBe(20);
    expect(frame.data[o + 2]).toBe(30);
    expect(frame.data[o + 3]).toBe(255); // opaque, not color-keyed
  });

  it('masks non-zero padding outside the diamond to transparent', () => {
    // Fill everything with a visible index; only the diamond should survive.
    const data = new Uint8Array(TILE_WIDTH * TILE_HEIGHT).fill(200);
    const frame = renderTile(new Tile(data), tracePalette());

    for (let y = 0; y < TILE_HEIGHT; y++) {
      const { left, right } = diamond(y);
      for (let x = 0; x < TILE_WIDTH; x++) {
        const a = frame.data[(y * TILE_WIDTH + x) * 4 + 3]!;
        if (x >= left && x < right) {
          expect(a).toBe(255);
        } else {
          expect(a).toBe(0);
        }
      }
    }
  });

  it('the visible diamond is exactly 784 pixels', () => {
    let visible = 0;
    for (let y = 0; y < TILE_HEIGHT; y++) {
      const { left, right } = diamond(y);
      visible += right - left;
    }
    expect(visible).toBe(784);
  });
});
