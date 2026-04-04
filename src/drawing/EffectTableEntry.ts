/**
 * An entry in the EffectTable containing an ordered sequence of frame indices for an animated effect.
 */
export class EffectTableEntry {
  /** Ordered sequence of frame indices that make up the animation. */
  frameSequence: number[] = [];

  /**
   * Returns the frame index at `currentAnimationIndex`.
   * If the index is out of range it wraps back to frame 0.
   */
  getNextFrameIndex(currentAnimationIndex: number): number {
    const idx = currentAnimationIndex >= this.frameSequence.length ? 0 : currentAnimationIndex;
    return this.frameSequence[idx] ?? 0;
  }
}
