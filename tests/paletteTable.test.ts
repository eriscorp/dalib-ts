import { describe, expect, it } from 'vitest';
import { buildArchive } from './archiveFixture.js';
import { KhanPalOverrideType } from '../src/enums.js';
import { PaletteTable } from '../src/drawing/PaletteTable.js';

const parse = (text: string) => PaletteTable.fromBuffer(new TextEncoder().encode(text));

describe('PaletteTable parsing', () => {
  it('skips // comment lines', () => {
    const table = PaletteTable.fromBuffer(
      new TextEncoder().encode(['// header comment', '5 42', '// trailing note'].join('\n')),
    );
    expect(table.getPaletteNumber(5)).toBe(42);
  });

  it('strips trailing // comments from a data line', () => {
    const table = PaletteTable.fromBuffer(
      new TextEncoder().encode('5 42 // inline note that must not be read as a palette id'),
    );
    // Without stripping, this would be parsed as the range "5..42 → NaN" or an override to
    // some bogus value. It must be the single override 5 → 42.
    expect(table.getPaletteNumber(5)).toBe(42);
  });

  it('tolerates multiple spaces between tokens', () => {
    const table = PaletteTable.fromBuffer(new TextEncoder().encode('1   3   7'));
    // Range 1..3 → palette 7.
    expect(table.getPaletteNumber(1)).toBe(7);
    expect(table.getPaletteNumber(2)).toBe(7);
    expect(table.getPaletteNumber(3)).toBe(7);
  });

  it('returns 0 for an unmapped id', () => {
    expect(parse('1 2 7').getPaletteNumber(999)).toBe(0);
  });

  it('skips lines with too few tokens or non-numeric values', () => {
    const table = parse('5\nabc def\n7 3\n');
    expect(table.getPaletteNumber(7)).toBe(3);
  });

  it('reads -1 and -2 as male and female overrides', () => {
    const table = parse('5 1\n5 2 -1\n5 3 -2\n');
    expect(table.getPaletteNumber(5)).toBe(1);
    expect(table.getPaletteNumber(5, KhanPalOverrideType.Male)).toBe(2);
    expect(table.getPaletteNumber(5, KhanPalOverrideType.Female)).toBe(3);
  });

  it('falls back to the general override when the sex-specific one is absent', () => {
    const table = parse('5 9\n');
    expect(table.getPaletteNumber(5, KhanPalOverrideType.Male)).toBe(9);
  });

  it('lets a single-value override win over a range entry', () => {
    // The range maps 1..10 to palette 4; the bare pair overrides id 5 to palette 8
    // regardless of the order the two lines appear in.
    const table = parse('5 8\n1 10 4\n');
    expect(table.getPaletteNumber(4)).toBe(4);
    expect(table.getPaletteNumber(5)).toBe(8);
  });
});

describe('PaletteTable range expansion limits', () => {
  it('refuses the hostile wide range without allocating or iterating it', () => {
    // The fixture from the card: one line claiming a billion ids. Before the cap
    // this filled a Map with 999,999,999 entries. The assertion is the timing as
    // much as the result — an unbounded loop does not return in 2 seconds.
    const started = performance.now();
    const table = parse('1 999999999 5\n');
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(2000);
    expect(table.getPaletteNumber(1)).toBe(0);
    expect(table.getPaletteNumber(500000)).toBe(0);
  });

  it('keeps parsing the rest of the file after refusing one wide line', () => {
    // The wide line is dropped, not treated as a parse failure, so a single bad
    // line cannot cost the whole table.
    const table = parse('1 999999999 5\n7 9 3\n');
    expect(table.getPaletteNumber(8)).toBe(3);
  });

  it('accepts a span as wide as any in retail data', () => {
    // The widest span in a real palette table is 527 (ia.dat:stspal.tbl), and the
    // widest in any retail .tbl is 3,196. Both must stay well inside the cap.
    const table = parse('1 3196 4\n');
    expect(table.getPaletteNumber(1)).toBe(4);
    expect(table.getPaletteNumber(3196)).toBe(4);
  });

  it('stops expanding once the whole-file budget is spent', () => {
    // 40 lines of 65,536 exceeds the 1,000,000 aggregate, so the later lines are
    // dropped even though each one is individually legal.
    const lines: string[] = [];
    for (let i = 0; i < 40; i++) lines.push(`${i * 100000 + 1} ${i * 100000 + 65536} 6`);
    const table = parse(lines.join('\n'));

    expect(table.getPaletteNumber(1)).toBe(6);
    expect(table.getPaletteNumber(3900001)).toBe(0);
  });

  it('drops a reversed range without failing the file', () => {
    // A stock 7.41 install has 163 reversed "ranges", every one of them in a .tbl
    // that is not a palette table at all — MobTile.tbl, skill.tbl, meffect.tbl —
    // sharing the extension but not this grammar. They yielded nothing before the
    // guard and must still yield nothing rather than aborting the parse.
    const table = parse('2\t1\t1\t4\t2\n5 3 9\n7 9 3\n');
    expect(table.getPaletteNumber(4)).toBe(0);
    expect(table.getPaletteNumber(8)).toBe(3);
  });

  it('refuses a range whose span overflows through a negative minimum', () => {
    const table = parse('-999999999 5 7\n1 3 8\n');
    expect(table.getPaletteNumber(0)).toBe(0);
    expect(table.getPaletteNumber(2)).toBe(8);
  });
});

describe('PaletteTable mutation', () => {
  it('adds general, male and female overrides', () => {
    const table = new PaletteTable();
    table.add(1, 10);
    table.add(1, 20, KhanPalOverrideType.Male);
    table.add(1, 30, KhanPalOverrideType.Female);

    expect(table.getPaletteNumber(1)).toBe(10);
    expect(table.getPaletteNumber(1, KhanPalOverrideType.Male)).toBe(20);
    expect(table.getPaletteNumber(1, KhanPalOverrideType.Female)).toBe(30);
  });

  it('remove clears every override kind for the id', () => {
    const table = new PaletteTable();
    table.add(1, 10);
    table.add(1, 20, KhanPalOverrideType.Male);
    table.remove(1);

    expect(table.getPaletteNumber(1)).toBe(0);
    expect(table.getPaletteNumber(1, KhanPalOverrideType.Male)).toBe(0);
  });

  it('merges another table over itself', () => {
    const base = parse('1 5 2\n');
    const other = new PaletteTable();
    other.add(3, 99);

    base.merge(other);
    expect(base.getPaletteNumber(3)).toBe(99);
    // Entries the other table does not mention survive.
    expect(base.getPaletteNumber(1)).toBe(2);
  });

  it('exposes cycling entries only for palettes that define them', () => {
    const table = new PaletteTable();
    expect(table.getCyclingEntries(1)).toBeUndefined();
    table.cyclingEntries.set(1, [{ startIndex: 0, endIndex: 3, period: 100 }]);
    expect(table.getCyclingEntries(1)).toHaveLength(1);
  });
});

describe('PaletteTable serialization', () => {
  it('collapses consecutive ids into a single range line', () => {
    const table = parse('1 4 7\n');
    expect(table.toText().trimEnd().split('\n')).toEqual(['1 4 7']);
  });

  it('writes a lone id as a bare pair', () => {
    const table = new PaletteTable();
    table.add(9, 3);
    expect(table.toText().trimEnd()).toBe('9 3');
  });

  it('splits a non-consecutive group into separate lines', () => {
    const table = new PaletteTable();
    table.add(1, 5);
    table.add(2, 5);
    table.add(9, 5);
    const lines = table.toText().trimEnd().split('\n');
    expect(lines).toContain('1 2 5');
    expect(lines).toContain('9 5');
  });

  it('emits the -1 and -2 suffixes for sex overrides', () => {
    const table = new PaletteTable();
    table.add(4, 11, KhanPalOverrideType.Male);
    table.add(4, 12, KhanPalOverrideType.Female);
    const text = table.toText();
    expect(text).toContain('4 11 -1');
    expect(text).toContain('4 12 -2');
  });

  it('round-trips through text', () => {
    const original = parse('1 4 7\n20 3\n8 9 -1\n');
    const reparsed = PaletteTable.fromBuffer(original.toUint8Array());

    expect(reparsed.getPaletteNumber(2)).toBe(7);
    expect(reparsed.getPaletteNumber(20)).toBe(3);
    expect(reparsed.getPaletteNumber(8, KhanPalOverrideType.Male)).toBe(9);
  });

  it('encodes to bytes', () => {
    const table = new PaletteTable();
    table.add(1, 2);
    expect(table.toUint8Array().length).toBeGreaterThan(0);
  });

  it('sorts sex overrides by id', () => {
    const table = new PaletteTable();
    table.add(9, 1, KhanPalOverrideType.Male);
    table.add(2, 2, KhanPalOverrideType.Male);
    table.add(9, 3, KhanPalOverrideType.Female);
    table.add(2, 4, KhanPalOverrideType.Female);

    const lines = table.toText().trimEnd().split('\n');
    expect(lines.indexOf('2 2 -1')).toBeLessThan(lines.indexOf('9 1 -1'));
    expect(lines.indexOf('2 4 -2')).toBeLessThan(lines.indexOf('9 3 -2'));
  });
});

describe('PaletteTable parse edge cases', () => {
  it('skips a line whose third token is not a number', () => {
    const table = parse('1 2 abc\n5 7\n');
    expect(table.getPaletteNumber(1)).toBe(0);
    expect(table.getPaletteNumber(5)).toBe(7);
  });

  it('falls through to the general table when no override matches', () => {
    const table = parse('1 3 9\n');
    expect(table.getPaletteNumber(2, KhanPalOverrideType.Female)).toBe(9);
  });
});

describe('PaletteTable archive loading', () => {
  const enc = (s: string) => new TextEncoder().encode(s);

  it('reads a single table from an entry', () => {
    const archive = buildArchive([{ name: 'mptpal.tbl', data: enc('1 4 7\n') }]);
    expect(PaletteTable.fromEntry(archive.get('mptpal.tbl')!).getPaletteNumber(2)).toBe(7);
  });

  it('merges every non-numeric table that matches the pattern', () => {
    const archive = buildArchive([
      { name: 'mptpal.tbl', data: enc('1 4 7\n') },
      { name: 'mptpalx.tbl', data: enc('20 3\n') },
      { name: 'other.tbl', data: enc('50 9\n') },
    ]);

    const table = PaletteTable.fromArchive('mptpal', archive);
    expect(table.getPaletteNumber(2)).toBe(7);
    expect(table.getPaletteNumber(20)).toBe(3);
    // A table outside the pattern must not be merged in.
    expect(table.getPaletteNumber(50)).toBe(0);
  });

  // A numbered file in the same family is a cycling definition, not a mapping
  // table: "mpt001.tbl" holds the cycling ranges for palette 1.
  it('reads a numbered file as cycling entries for that palette', () => {
    const archive = buildArchive([
      { name: 'mptpal.tbl', data: enc('1 4 7\n') },
      { name: 'mpt001.tbl', data: enc('10 20 300\n30 40 500\n') },
    ]);

    const table = PaletteTable.fromArchive('mpt', archive);
    const cycling = table.getCyclingEntries(1);
    expect(cycling).toHaveLength(2);
    expect(cycling![0]).toEqual({ startIndex: 10, endIndex: 20, period: 300 });
    expect(cycling![1]).toEqual({ startIndex: 30, endIndex: 40, period: 500 });
    // The mapping table in the same pattern is still merged.
    expect(table.getPaletteNumber(2)).toBe(7);
  });

  it('ignores blank, short and non-numeric cycling lines', () => {
    const archive = buildArchive([
      { name: 'mpt002.tbl', data: enc('\n1 2\n1 2 3 4\na b c\n5 6 7\n') },
    ]);
    const cycling = PaletteTable.fromArchive('mpt', archive).getCyclingEntries(2);
    expect(cycling).toEqual([{ startIndex: 5, endIndex: 6, period: 7 }]);
  });

  it('records nothing for a numbered file with no valid cycling lines', () => {
    const archive = buildArchive([{ name: 'mpt003.tbl', data: enc('garbage\n') }]);
    expect(PaletteTable.fromArchive('mpt', archive).getCyclingEntries(3)).toBeUndefined();
  });

  it('returns an empty table when nothing matches the pattern', () => {
    const table = PaletteTable.fromArchive('nothing', buildArchive([]));
    expect(table.getPaletteNumber(1)).toBe(0);
  });

  it('merge carries every override kind and the cycling entries', () => {
    const base = new PaletteTable();
    const other = parse('1 4 7\n');
    other.add(2, 20, KhanPalOverrideType.Male);
    other.add(3, 30, KhanPalOverrideType.Female);
    other.add(4, 40);
    other.cyclingEntries.set(9, [{ startIndex: 0, endIndex: 1, period: 100 }]);

    base.merge(other);
    expect(base.getPaletteNumber(2, KhanPalOverrideType.Male)).toBe(20);
    expect(base.getPaletteNumber(3, KhanPalOverrideType.Female)).toBe(30);
    expect(base.getPaletteNumber(4)).toBe(40);
    expect(base.getPaletteNumber(1)).toBe(7);
    expect(base.getCyclingEntries(9)).toHaveLength(1);
  });
});
