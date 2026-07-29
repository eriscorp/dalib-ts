import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KhanPalOverrideType } from '../src/enums.js';
import { matchPaletteRule } from '../src/drawing/paletteRules.js';

interface MatchCase {
  archive: string;
  entry: string;
  ruleId: string | null;
}

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/palette-resolution.json', import.meta.url), 'utf8'),
) as { match: MatchCase[] };

describe('matchPaletteRule conformance', () => {
  // The fixture is the frozen cross-port contract: a rule change that alters
  // any emitted ruleId must fail here.
  it.each(fixture.match)('$archive / $entry → $ruleId', ({ archive, entry, ruleId }) => {
    expect(matchPaletteRule(archive, entry)?.ruleId ?? null).toBe(ruleId);
  });
});

describe('matchPaletteRule details', () => {
  it('reports the source data for a table rule', () => {
    const match = matchPaletteRule('ia.dat', 'stc00012.hpf')!;
    expect(match.kind).toBe('table');
    expect(match.sourceArchive).toBe('self');
    expect(match.tablePattern).toBe('stcpal');
    expect(match.palettePattern).toBe('stc');
    expect(match.idKind).toBe('identifierPlus1');
  });

  it('reports the gui palette number for a setoa constant rule', () => {
    const match = matchPaletteRule('setoa.dat', 'gbicon12.epf')!;
    expect(match.kind).toBe('constant');
    expect(match.palettePattern).toBe('gui');
    expect(match.paletteNumber).toBe(1);
    expect(match.idKind).toBeUndefined();
  });

  it('maps every setoa constant rule to the hand-mapped gui number', () => {
    const expected: [entry: string, gui: number][] = [
      ['dlgcre01a.epf', 8],
      ['gbicon02.epf', 0],
      ['emot00a.epf', 0],
      ['lsbackm1.epf', 0],
      ['setup12.epf', 0],
      ['gbicon12.epf', 1],
      ['gbicon01.epf', 2],
      ['emot9.epf', 3],
      ['legends1.epf', 3],
      ['nation01.epf', 5],
      ['lback01.epf', 4],
      ['skill01.epf', 6],
      ['lodbk1.epf', 7],
      ['staff01.epf', 9],
      ['lsback1.epf', 10],
      ['leicon01.epf', 10],
      ['ldi01.epf', 11],
      ['lwmap01.epf', 12],
      ['bw_back1.epf', 13],
      ['kdesc01.epf', 14],
      ['lg_01.epf', 15],
      ['bw_flag1.epf', 16],
      ['album_b1.epf', 17],
      ['zzz.epf', 0],
    ];
    for (const [entry, gui] of expected) {
      expect(matchPaletteRule('setoa.dat', entry)?.paletteNumber, entry).toBe(gui);
    }
  });

  it('selects the male or female khan override from the first character', () => {
    expect(matchPaletteRule('khanm.dat', 'mb00501.epf')?.overrideType).toBe(KhanPalOverrideType.Male);
    expect(matchPaletteRule('khanm.dat', 'fb00501.epf')?.overrideType).toBe(KhanPalOverrideType.Female);
  });

  it('remaps khan letters onto their table letters', () => {
    // a→b, g→c, j→c, s→p; other table letters pass through.
    expect(matchPaletteRule('khanm.dat', 'ma00501.epf')?.tablePattern).toBe('palb');
    expect(matchPaletteRule('khanm.dat', 'mg001.epf')?.tablePattern).toBe('palc');
    expect(matchPaletteRule('khanm.dat', 'mj001.epf')?.tablePattern).toBe('palc');
    expect(matchPaletteRule('khanm.dat', 'ms001.epf')?.tablePattern).toBe('palp');
    expect(matchPaletteRule('khanm.dat', 'mw001.epf')?.tablePattern).toBe('palw');
  });

  it('routes khan bodies and pants to the sibling archives', () => {
    const body = matchPaletteRule('khanm.dat', 'mmbody01.epf')!;
    expect(body.sourceArchive).toBe('khanpal.dat');
    expect(body.idKind).toBe('lowestKey');

    const pants = matchPaletteRule('khanm.dat', 'mn001.epf')!;
    expect(pants.sourceArchive).toBe('legend.dat');
    expect(pants.idKind).toBe('dyeIndexZero');
  });

  it('routes national.dat and misc.dat to the sibling legend.dat', () => {
    expect(matchPaletteRule('national.dat', 'nation01.epf')?.sourceArchive).toBe('legend.dat');
    expect(matchPaletteRule('misc.dat', 'anything.epf')?.sourceArchive).toBe('legend.dat');
  });

  it('uses the in-file palette number for .mpf entries', () => {
    const match = matchPaletteRule('sanm.dat', 'mns003.mpf')!;
    expect(match.kind).toBe('indexed');
    expect(match.palettePattern).toBe('mns');
    expect(match.idKind).toBe('mpfInternal');
  });

  it('keys tileset rules on the tile index', () => {
    expect(matchPaletteRule('seo.dat', 'tilea.bmp')?.idKind).toBe('tileIndexPlus1');
    expect(matchPaletteRule('seo.dat', 'tileas.bmp')?.tablePattern).toBe('mpspal');
  });
});
