/**
 * A sequence of tile IDs that form an animated tile cycle.
 * Each tile in the sequence can be used as a key to look up the entry.
 */
export class TileAnimationEntry {
  /** Milliseconds between each frame step. Default 500ms (stored as 5 in the file: 5 × 100 = 500). */
  animationIntervalMs: number = 500;
  /** Ordered list of tile IDs making up the animation cycle. */
  tileSequence: number[] = [];

  /**
   * Returns the tile ID that follows `currentTileId` in the sequence (wraps around).
   * Returns -1 if `currentTileId` is not in the sequence.
   */
  getNextTileId(currentTileId: number): number {
    const idx = this.tileSequence.indexOf(currentTileId);
    if (idx === -1) return -1;
    const next = idx + 1;
    return this.tileSequence[next >= this.tileSequence.length ? 0 : next]!;
  }
}
