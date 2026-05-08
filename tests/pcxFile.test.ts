import { describe, expect, it } from 'vitest';
import { PcxFile } from '../src/drawing/PcxFile.js';
import { renderPcx } from '../src/drawing/Graphics.js';

interface PcxFixture {
  width: number;
  height: number;
  bytesPerLine?: number;
  rleBody: number[];
  palette?: Uint8Array;
}

function buildPcx({ width, height, bytesPerLine, rleBody, palette }: PcxFixture): Uint8Array {
  const bpl = bytesPerLine ?? width;
  const header = new Uint8Array(128);
  const view = new DataView(header.buffer);
  header[0] = 0x0a;
  header[1] = 5; // version (arbitrary)
  header[2] = 1; // encoding (RLE)
  header[3] = 8; // bits per pixel
  view.setUint16(4, 0, true); // xMin
  view.setUint16(6, 0, true); // yMin
  view.setUint16(8, width - 1, true); // xMax
  view.setUint16(10, height - 1, true); // yMax
  header[65] = 1; // nPlanes
  view.setUint16(66, bpl, true); // bytesPerLine

  const pal = palette ?? new Uint8Array(768);
  const out = new Uint8Array(header.length + rleBody.length + 1 + pal.length);
  out.set(header, 0);
  out.set(rleBody, header.length);
  out[header.length + rleBody.length] = 0x0c; // palette marker
  out.set(pal, header.length + rleBody.length + 1);
  return out;
}

describe('PcxFile', () => {
  it('decodes literal bytes and runs into the indexed buffer', () => {
    const palette = new Uint8Array(768);
    palette[1 * 3] = 10; palette[1 * 3 + 1] = 20; palette[1 * 3 + 2] = 30;
    palette[5 * 3] = 50; palette[5 * 3 + 1] = 60; palette[5 * 3 + 2] = 70;

    // Row 0: literals 1,2,3,4. Row 1: run of four 5s.
    const buf = buildPcx({
      width: 4,
      height: 2,
      rleBody: [1, 2, 3, 4, 0xc4, 5],
      palette,
    });

    const pcx = PcxFile.fromBuffer(buf);
    expect(pcx.width).toBe(4);
    expect(pcx.height).toBe(2);
    expect(pcx.bpp).toBe(8);
    expect(pcx.nPlanes).toBe(1);
    expect(Array.from(pcx.data)).toEqual([1, 2, 3, 4, 5, 5, 5, 5]);
  });

  it('renderPcx produces RGBA from the embedded palette', () => {
    const palette = new Uint8Array(768);
    palette[1 * 3] = 10; palette[1 * 3 + 1] = 20; palette[1 * 3 + 2] = 30;
    palette[5 * 3] = 50; palette[5 * 3 + 1] = 60; palette[5 * 3 + 2] = 70;

    const buf = buildPcx({
      width: 4,
      height: 2,
      rleBody: [1, 2, 3, 4, 0xc4, 5],
      palette,
    });
    const frame = renderPcx(PcxFile.fromBuffer(buf));
    expect(frame.width).toBe(4);
    expect(frame.height).toBe(2);
    // Pixel 0 (palette index 1) → (10, 20, 30, 255)
    expect([frame.data[0], frame.data[1], frame.data[2], frame.data[3]]).toEqual([10, 20, 30, 255]);
    // Pixel 4 (row 1, col 0, palette index 5) → (50, 60, 70, 255)
    expect([frame.data[16], frame.data[17], frame.data[18], frame.data[19]]).toEqual([50, 60, 70, 255]);
  });

  it('trims per-scanline padding when bytesPerLine exceeds width', () => {
    // width=3, bytesPerLine=4 → one trailing padding byte per row.
    // Row 0 literals 1,2,3 + pad 0. Row 1 literals 4,5,6 + pad 0.
    const buf = buildPcx({
      width: 3,
      height: 2,
      bytesPerLine: 4,
      rleBody: [1, 2, 3, 0, 4, 5, 6, 0],
    });
    const pcx = PcxFile.fromBuffer(buf);
    expect(pcx.bytesPerLine).toBe(4);
    expect(pcx.data.length).toBe(6);
    expect(Array.from(pcx.data)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('throws on missing PCX magic', () => {
    const buf = buildPcx({ width: 1, height: 1, rleBody: [0] });
    buf[0] = 0xff;
    expect(() => PcxFile.fromBuffer(buf)).toThrow(/Not a PCX file/);
  });

  it('throws on unsupported bpp / plane combinations', () => {
    const buf = buildPcx({ width: 1, height: 1, rleBody: [0] });
    buf[3] = 4; // 4bpp variant
    expect(() => PcxFile.fromBuffer(buf)).toThrow(/Unsupported PCX variant/);
  });

  it('throws when the trailing palette marker is missing', () => {
    const buf = buildPcx({ width: 1, height: 1, rleBody: [0] });
    buf[buf.length - 769] = 0x00; // overwrite the 0x0C marker
    expect(() => PcxFile.fromBuffer(buf)).toThrow(/trailing 256-color palette marker/);
  });
});
