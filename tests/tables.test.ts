import { describe, expect, it } from 'vitest';
import { EffectTable } from '../src/drawing/EffectTable.js';
import { EffectTableEntry } from '../src/drawing/EffectTableEntry.js';
import { TileAnimationTable } from '../src/drawing/TileAnimationTable.js';
import { TileAnimationEntry } from '../src/drawing/TileAnimationEntry.js';

const enc = (s: string) => new TextEncoder().encode(s);

describe('EffectTable', () => {
  // Line 1 is the effect count; each following line is one effect's frame sequence.
  const TEXT = '3\n1 2 3\n10 11\n\n';

  it('parses sequences and exposes 1-based effect IDs', () => {
    const table = EffectTable.fromBuffer(enc(TEXT));
    expect(table.tryGetEntry(1)!.frameSequence).toEqual([1, 2, 3]);
    expect(table.tryGetEntry(2)!.frameSequence).toEqual([10, 11]);
  });

  it('returns undefined outside the 1-based range', () => {
    const table = EffectTable.fromBuffer(enc(TEXT));
    expect(table.tryGetEntry(0)).toBeUndefined();
    expect(table.tryGetEntry(999)).toBeUndefined();
  });

  it('adds, inserts and clears entries', () => {
    const table = new EffectTable();
    table.add([1, 2]);
    table.add([3]);
    expect(table.count).toBe(2);
    expect(table.getNextEffectId()).toBe(3);

    table.insert(1, [9, 9]);
    expect(table.tryGetEntry(1)!.frameSequence).toEqual([9, 9]);
    expect(table.tryGetEntry(2)!.frameSequence).toEqual([1, 2]);

    // remove clears the slot rather than shifting later effects down.
    const before = table.count;
    table.remove(1);
    expect(table.count).toBe(before);
    expect(table.tryGetEntry(1)!.frameSequence).toEqual([]);
  });

  it('remove ignores an out-of-range id', () => {
    const table = new EffectTable();
    table.add([1]);
    expect(() => table.remove(50)).not.toThrow();
    expect(table.count).toBe(1);
  });

  it('addEfa appends a single frame-zero entry', () => {
    const table = new EffectTable();
    table.addEfa();
    expect(table.tryGetEntry(1)!.frameSequence).toEqual([0]);
  });

  it('copies the array passed to add, so later mutation does not leak in', () => {
    const table = new EffectTable();
    const seq = [1, 2];
    table.add(seq);
    seq.push(3);
    expect(table.tryGetEntry(1)!.frameSequence).toEqual([1, 2]);
  });

  it('serializes with the count on the first line', () => {
    const table = new EffectTable();
    table.add([1, 2, 3]);
    const lines = table.toText().trimEnd().split('\n');
    expect(lines[0]).toBe('1');
    expect(lines[1]).toBe('1 2 3');
    expect(table.toUint8Array().length).toBeGreaterThan(0);
  });

  it('round-trips through text', () => {
    const reparsed = EffectTable.fromBuffer(EffectTable.fromBuffer(enc(TEXT)).toUint8Array());
    expect(reparsed.tryGetEntry(1)!.frameSequence).toEqual([1, 2, 3]);
  });
});

describe('EffectTableEntry', () => {
  it('returns the frame at the index and wraps past the end', () => {
    const entry = new EffectTableEntry();
    entry.frameSequence = [5, 6, 7];
    expect(entry.getNextFrameIndex(0)).toBe(5);
    expect(entry.getNextFrameIndex(2)).toBe(7);
    // Past the end it restarts at frame 0.
    expect(entry.getNextFrameIndex(3)).toBe(5);
  });

  it('returns 0 for an empty sequence', () => {
    expect(new EffectTableEntry().getNextFrameIndex(0)).toBe(0);
  });
});

describe('TileAnimationTable', () => {
  // "id id id delay" — the final token is the interval in 100 ms ticks.
  const TEXT = '100 101 102 2\n200 201 5\n';

  it('indexes an entry by every tile ID in its sequence', () => {
    const table = TileAnimationTable.fromBuffer(enc(TEXT));
    for (const id of [100, 101, 102]) {
      expect(table.tryGetEntry(id)!.tileSequence).toEqual([100, 101, 102]);
    }
    expect(table.tryGetEntry(999)).toBeUndefined();
  });

  it('reads the trailing token as an interval in 100 ms ticks', () => {
    const table = TileAnimationTable.fromBuffer(enc(TEXT));
    expect(table.tryGetEntry(100)!.animationIntervalMs).toBe(200);
    expect(table.tryGetEntry(200)!.animationIntervalMs).toBe(500);
  });

  it('adds and removes an entry across all of its tile IDs', () => {
    const table = new TileAnimationTable();
    const entry = new TileAnimationEntry();
    entry.tileSequence = [1, 2, 3];
    entry.animationIntervalMs = 300;

    table.add(entry);
    expect(table.tryGetEntry(2)).toBe(entry);

    table.remove(entry);
    expect(table.tryGetEntry(1)).toBeUndefined();
    expect(table.tryGetEntry(3)).toBeUndefined();
  });

  it('writes each group once, converting the interval back to ticks', () => {
    const table = TileAnimationTable.fromBuffer(enc(TEXT));
    const lines = table.toText().trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('100 101 102 2');
  });

  it('round-trips through text', () => {
    const once = TileAnimationTable.fromBuffer(enc(TEXT));
    const twice = TileAnimationTable.fromBuffer(once.toUint8Array());
    expect(twice.tryGetEntry(101)!.tileSequence).toEqual([100, 101, 102]);
    expect(twice.tryGetEntry(101)!.animationIntervalMs).toBe(200);
  });

  it('skips blank lines and single-token lines', () => {
    const table = TileAnimationTable.fromBuffer(enc('\n\n42\n'));
    expect(table.tryGetEntry(42)).toBeUndefined();
  });
});

describe('TileAnimationEntry', () => {
  it('steps to the next tile and wraps at the end', () => {
    const entry = new TileAnimationEntry();
    entry.tileSequence = [10, 11, 12];
    expect(entry.getNextTileId(10)).toBe(11);
    expect(entry.getNextTileId(12)).toBe(10);
  });

  it('returns -1 for a tile outside the cycle', () => {
    const entry = new TileAnimationEntry();
    entry.tileSequence = [10, 11];
    expect(entry.getNextTileId(99)).toBe(-1);
  });

  it('defaults to a 500 ms interval', () => {
    expect(new TileAnimationEntry().animationIntervalMs).toBe(500);
  });
});
