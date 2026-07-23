import { describe, expect, it } from 'vitest';
import { renderColorized, renderEpf, renderPalettized } from '../src/drawing/Graphics.js';
import { Palette } from '../src/drawing/Palette.js';
import type { EpfFrame } from '../src/drawing/EpfFrame.js';
import { AlphaMode } from '../src/enums.js';

describe('renderEpf', () => {
  const palette = new Palette();
  // Put a non-black color at index 1 so rendered output is distinguishable
  palette.set(1, { r: 255, g: 128, b: 64, a: 255 });

  it('returns 1×1 transparent for zero-width frame', () => {
    const frame: EpfFrame = { left: 5, top: 5, right: 5, bottom: 10, data: new Uint8Array(0) };
    const out = renderEpf(frame, palette);

    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect(out.data[3]).toBe(0);
  });

  it('returns 1×1 transparent for zero-height frame', () => {
    const frame: EpfFrame = { left: 0, top: 3, right: 10, bottom: 3, data: new Uint8Array(0) };
    const out = renderEpf(frame, palette);

    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect(out.data[3]).toBe(0);
  });

  it('renders a non-degenerate frame normally', () => {
    const frame: EpfFrame = { left: 0, top: 0, right: 2, bottom: 1, data: new Uint8Array([1, 1]) };
    const out = renderEpf(frame, palette);

    expect(out.width).toBe(2);
    expect(out.height).toBe(1);
    expect(out.data[0]).toBe(255);
    expect(out.data[3]).toBe(255);
  });
});

describe('shared renderers guard empty frames', () => {
  const palette = new Palette();
  palette.set(1, { r: 255, g: 128, b: 64, a: 255 });

  // Empty placeholder frames (e.g. setoa.dat UI sprites) encode Right < Left and
  // Bottom < Top, so the shared renderers see non-positive width/height. They must
  // return a 1×1 transparent frame, not throw a RangeError or return a 0×0 frame.
  it('renderPalettized returns 1×1 transparent for negative width/height', () => {
    const out = renderPalettized(45, 16, -45, -16, new Uint8Array(0), palette);
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect(out.data.length).toBe(4);
    expect(out.data[3]).toBe(0);
  });

  it('renderColorized returns 1×1 transparent for negative width/height', () => {
    const out = renderColorized(45, 16, -45, -16, []);
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect(out.data.length).toBe(4);
    expect(out.data[3]).toBe(0);
  });

  it('renderPalettized returns 1×1 transparent for zero width', () => {
    const out = renderPalettized(0, 0, 0, 5, new Uint8Array(0), palette);
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
  });
});

describe('AlphaMode', () => {
  const palette = new Palette();
  palette.set(1, { r: 200, g: 100, b: 50, a: 128 }); // half-transparent

  const data = new Uint8Array([1]); // one pixel, palette index 1

  it('Straight (default) leaves RGB channels unscaled', () => {
    const out = renderPalettized(0, 0, 1, 1, data, palette);
    expect(out.data[0]).toBe(200);
    expect(out.data[1]).toBe(100);
    expect(out.data[2]).toBe(50);
    expect(out.data[3]).toBe(128);
  });

  it('Premultiplied scales RGB by alpha/255', () => {
    const out = renderPalettized(0, 0, 1, 1, data, palette, AlphaMode.Premultiplied);
    expect(out.data[0]).toBe(Math.round((200 * 128) / 255));
    expect(out.data[1]).toBe(Math.round((100 * 128) / 255));
    expect(out.data[2]).toBe(Math.round((50 * 128) / 255));
    expect(out.data[3]).toBe(128);
  });

  it('Premultiplied leaves fully-opaque pixels untouched', () => {
    palette.set(2, { r: 200, g: 100, b: 50, a: 255 });
    const opaqueData = new Uint8Array([2]);
    const out = renderPalettized(0, 0, 1, 1, opaqueData, palette, AlphaMode.Premultiplied);
    expect(out.data[0]).toBe(200);
    expect(out.data[1]).toBe(100);
    expect(out.data[2]).toBe(50);
    expect(out.data[3]).toBe(255);
  });
});
