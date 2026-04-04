/**
 * Defines a palette index cycling range for animated color effects (e.g. water shimmer).
 * Colors at indices [startIndex, endIndex] are rotated each period step.
 */
export interface PaletteCyclingEntry {
  /** Starting palette index (0-based). */
  startIndex: number;
  /** Ending palette index (0-based). */
  endIndex: number;
  /** Number of 100ms intervals between each cycle step. */
  period: number;
}
