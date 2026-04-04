/**
 * Scale a byte value from one range to another, rounding to the nearest integer.
 * All Dark Ages color conversions use min=0 for both ranges, so the formula
 * simplifies to: Math.round(num * (newMax / max)).
 */
export function scaleRangeByte(num: number, min: number, max: number, newMin: number, newMax: number): number {
  if (min === max) throw new RangeError('min and max cannot be the same value');
  const ratio = (num - min) / (max - min);
  return Math.round((newMax - newMin) * ratio + newMin);
}
