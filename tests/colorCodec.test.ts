import { describe, expect, it } from 'vitest';
import { decodeRgb555, decodeRgb565, encodeRgb555, encodeRgb565 } from '../src/utility/ColorCodec.js';

describe('ColorCodec', () => {
  describe('RGB555', () => {
    it('decodes pure red', () => {
      // Red in RGB555: R=31, G=0, B=0 → 0b_0_11111_00000_00000 = 0x7C00
      const color = decodeRgb555(0x7c00);
      expect(color.r).toBe(255);
      expect(color.g).toBe(0);
      expect(color.b).toBe(0);
      expect(color.a).toBe(255);
    });

    it('decodes pure green', () => {
      // G=31 → 0b_0_00000_11111_00000 = 0x03E0
      const color = decodeRgb555(0x03e0);
      expect(color.r).toBe(0);
      expect(color.g).toBe(255);
      expect(color.b).toBe(0);
    });

    it('decodes pure blue', () => {
      // B=31 → 0b_0_00000_00000_11111 = 0x001F
      const color = decodeRgb555(0x001f);
      expect(color.r).toBe(0);
      expect(color.g).toBe(0);
      expect(color.b).toBe(255);
    });

    it('decodes black', () => {
      const color = decodeRgb555(0x0000);
      expect(color.r).toBe(0);
      expect(color.g).toBe(0);
      expect(color.b).toBe(0);
    });

    it('decodes white', () => {
      // All channels = 31 → 0x7FFF
      const color = decodeRgb555(0x7fff);
      expect(color.r).toBe(255);
      expect(color.g).toBe(255);
      expect(color.b).toBe(255);
    });

    it('encode/decode round-trips with acceptable loss', () => {
      const original = { r: 128, g: 64, b: 200, a: 255 };
      const encoded = encodeRgb555(original);
      const decoded = decodeRgb555(encoded);
      // 5-bit channels lose precision — allow ±9 error
      expect(Math.abs(decoded.r - original.r)).toBeLessThanOrEqual(9);
      expect(Math.abs(decoded.g - original.g)).toBeLessThanOrEqual(9);
      expect(Math.abs(decoded.b - original.b)).toBeLessThanOrEqual(9);
    });
  });

  describe('RGB565', () => {
    it('decodes pure red', () => {
      // R=31 → 0b_11111_000000_00000 = 0xF800
      const color = decodeRgb565(0xf800);
      expect(color.r).toBe(255);
      expect(color.g).toBe(0);
      expect(color.b).toBe(0);
    });

    it('decodes pure green (6 bits)', () => {
      // G=63 → 0b_00000_111111_00000 = 0x07E0
      const color = decodeRgb565(0x07e0);
      expect(color.g).toBe(255);
      expect(color.r).toBe(0);
      expect(color.b).toBe(0);
    });

    it('decodes pure blue', () => {
      // B=31 → 0b_00000_000000_11111 = 0x001F
      const color = decodeRgb565(0x001f);
      expect(color.b).toBe(255);
    });

    it('decodes white', () => {
      const color = decodeRgb565(0xffff);
      expect(color.r).toBe(255);
      expect(color.g).toBe(255);
      expect(color.b).toBe(255);
    });

    it('encode/decode round-trips with acceptable loss', () => {
      const original = { r: 200, g: 100, b: 50, a: 255 };
      const encoded = encodeRgb565(original);
      const decoded = decodeRgb565(encoded);
      expect(Math.abs(decoded.r - original.r)).toBeLessThanOrEqual(9);
      expect(Math.abs(decoded.g - original.g)).toBeLessThanOrEqual(5); // 6-bit green is more precise
      expect(Math.abs(decoded.b - original.b)).toBeLessThanOrEqual(9);
    });
  });

  describe('encodeRgb555', () => {
    it('encodes black to 0', () => {
      expect(encodeRgb555({ r: 0, g: 0, b: 0, a: 255 })).toBe(0);
    });

    it('encodes white to 0x7FFF', () => {
      expect(encodeRgb555({ r: 255, g: 255, b: 255, a: 255 })).toBe(0x7fff);
    });
  });

  describe('encodeRgb565', () => {
    it('encodes black to 0', () => {
      expect(encodeRgb565({ r: 0, g: 0, b: 0, a: 255 })).toBe(0);
    });

    it('encodes white to 0xFFFF', () => {
      expect(encodeRgb565({ r: 255, g: 255, b: 255, a: 255 })).toBe(0xffff);
    });
  });
});
