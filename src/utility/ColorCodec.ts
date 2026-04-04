import type { Color } from '../constants.js';
import { FIVE_BIT_MASK, SIX_BIT_MASK } from '../constants.js';
import { scaleRangeByte } from './MathEx.js';

/**
 * Decode a 16-bit RGB555-encoded value to an RGBA Color (alpha = 255).
 * Bit layout: [0 RRRRR GGGGG BBBBB] — channels are scaled from 5-bit (0-31) to 8-bit (0-255).
 */
export function decodeRgb555(encoded: number): Color {
  const r5 = (encoded >> 10) & FIVE_BIT_MASK;
  const g5 = (encoded >> 5) & FIVE_BIT_MASK;
  const b5 = encoded & FIVE_BIT_MASK;
  return {
    r: scaleRangeByte(r5, 0, FIVE_BIT_MASK, 0, 255),
    g: scaleRangeByte(g5, 0, FIVE_BIT_MASK, 0, 255),
    b: scaleRangeByte(b5, 0, FIVE_BIT_MASK, 0, 255),
    a: 255,
  };
}

/**
 * Decode a 16-bit RGB565-encoded value to an RGBA Color (alpha = 255).
 * Bit layout: [RRRRR GGGGGG BBBBB] — R/B scaled from 5-bit, G scaled from 6-bit.
 */
export function decodeRgb565(encoded: number): Color {
  const r5 = (encoded >> 11) & FIVE_BIT_MASK;
  const g6 = (encoded >> 5) & SIX_BIT_MASK;
  const b5 = encoded & FIVE_BIT_MASK;
  return {
    r: scaleRangeByte(r5, 0, FIVE_BIT_MASK, 0, 255),
    g: scaleRangeByte(g6, 0, SIX_BIT_MASK, 0, 255),
    b: scaleRangeByte(b5, 0, FIVE_BIT_MASK, 0, 255),
    a: 255,
  };
}

/**
 * Encode an RGBA Color to a 16-bit RGB555 value.
 * Alpha is ignored; channels are scaled from 8-bit to 5-bit.
 */
export function encodeRgb555(color: Color): number {
  const r = scaleRangeByte(color.r, 0, 255, 0, FIVE_BIT_MASK);
  const g = scaleRangeByte(color.g, 0, 255, 0, FIVE_BIT_MASK);
  const b = scaleRangeByte(color.b, 0, 255, 0, FIVE_BIT_MASK);
  return (r << 10) | (g << 5) | b;
}

/**
 * Encode an RGBA Color to a 16-bit RGB565 value.
 * Alpha is ignored; R/B scaled to 5-bit, G to 6-bit.
 */
export function encodeRgb565(color: Color): number {
  const r = scaleRangeByte(color.r, 0, 255, 0, FIVE_BIT_MASK);
  const g = scaleRangeByte(color.g, 0, 255, 0, SIX_BIT_MASK);
  const b = scaleRangeByte(color.b, 0, 255, 0, FIVE_BIT_MASK);
  return (r << 11) | (g << 5) | b;
}
