import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildArchive } from './archiveFixture.js';
import { clientArchive, hasClientArchive } from './clientAssets.js';
import { COLORS_PER_PALETTE } from '../src/constants.js';
import { DataArchive } from '../src/data/DataArchive.js';
import { PaletteResolver } from '../src/drawing/PaletteResolver.js';
import { SpanWriter } from '../src/io/SpanWriter.js';

const enc = (s: string) => new TextEncoder().encode(s);

/** A 768-byte PAL whose index 1 red channel is a recognizable value. */
function palBytes(r: number): Uint8Array {
  const bytes = new Uint8Array(COLORS_PER_PALETTE * 3);
  bytes[3] = r;
  return bytes;
}

/** One byte of filler for entries the resolver never parses. */
const stub = new Uint8Array(1);

/**
 * A minimal MPF whose only frame is the palette sentinel (left/top of -1),
 * which carries the palette number in its startAddress field.
 */
function mpfBytes(paletteNumber: number): Uint8Array {
  const w = new SpanWriter();
  w.writeUInt8(1); // frame count: the sentinel frame only
  w.writeInt16LE(1); // pixel width
  w.writeInt16LE(1); // pixel height
  w.writeInt32LE(0); // data length
  w.writeUInt8(0); // walk frame index
  w.writeUInt8(0); // walk frame count
  // Six animation bytes; the first two read as formatType 0 (single attack).
  for (let i = 0; i < 6; i++) w.writeUInt8(0);
  w.writeInt16LE(-1); // left: sentinel
  w.writeInt16LE(-1); // top: sentinel
  w.writeInt16LE(0); // right
  w.writeInt16LE(0); // bottom
  w.writeInt16LE(0); // centerX
  w.writeInt16LE(0); // centerY
  w.writeInt32LE(paletteNumber); // startAddress carries the palette number
  return w.toUint8Array();
}

const noSiblings = () => null;

describe('PaletteResolver — legend.dat', () => {
  const archive = buildArchive([
    { name: 'backpal1.pal', data: palBytes(10) },
    { name: 'legend.pal', data: palBytes(20) },
    { name: 'legend01.pal', data: palBytes(30) },
    { name: 'staff.pal', data: palBytes(40) },
    { name: 'itempal.tbl', data: enc('1 7\n2 8\n') },
    { name: 'item007.pal', data: palBytes(50) },
    { name: 'item008.pal', data: palBytes(55) },
    { name: 'field001.pal', data: palBytes(60) },
    { name: 'bkstory1.epf', data: stub },
    { name: 'bkstory.epf', data: stub },
    { name: 'item001.epf', data: stub },
    { name: 'field001.epf', data: stub },
    { name: 'skill01.epf', data: stub },
    { name: 'f01.epf', data: stub },
    { name: 'rain01.epf', data: stub },
    { name: 'staff01.epf', data: stub },
    { name: 'zzz.epf', data: stub },
  ]);
  const resolver = new PaletteResolver('legend.dat', archive, noSiblings);
  const resolve = (name: string, frameIndex = 0) => resolver.resolve(archive.get(name)!, frameIndex);

  it('resolves bkstory entries through the backpal indexed map', () => {
    const r = resolve('bkstory1.epf')!;
    expect(r.ruleId).toBe('legend/bkstory');
    expect(r.kind).toBe('indexed');
    expect(r.paletteNumber).toBe(1);
    expect(r.luminanceBlended).toBe(false);
    expect(r.palette.get(1).r).toBe(10);
  });

  it('changes the item palette per frame', () => {
    // id = (identifier - 1) * 266 + frameIndex + 1
    const frame0 = resolve('item001.epf', 0)!;
    expect(frame0.ruleId).toBe('legend/item');
    expect(frame0.paletteNumber).toBe(7);
    expect(frame0.palette.get(1).r).toBe(50);

    const frame1 = resolve('item001.epf', 1)!;
    expect(frame1.paletteNumber).toBe(8);
    expect(frame1.palette.get(1).r).toBe(55);
  });

  it('resolves field entries through the field indexed map', () => {
    expect(resolve('field001.epf')!.palette.get(1).r).toBe(60);
  });

  it('resolves the fixed rules to their named palettes', () => {
    const skill = resolve('skill01.epf')!;
    expect(skill.kind).toBe('fixed');
    expect(skill.paletteNumber).toBe(0);
    expect(skill.palette.get(1).r).toBe(30);

    expect(resolve('f01.epf')!.palette.get(1).r).toBe(20);
    expect(resolve('rain01.epf')!.palette.get(1).r).toBe(30);
    expect(resolve('staff01.epf')!.palette.get(1).r).toBe(40);
  });

  it('falls back to legend.pal for unmatched entries', () => {
    const r = resolve('zzz.epf')!;
    expect(r.ruleId).toBe('legend/default');
    expect(r.palette.get(1).r).toBe(20);
  });

  it('returns null when an indexed rule finds no numeric identifier', () => {
    expect(resolve('bkstory.epf')).toBeNull();
  });

  it('reuses the cached fixed palette on repeat calls', () => {
    expect(resolve('zzz.epf')!.palette).toBe(resolve('f01.epf')!.palette);
  });
});

describe('PaletteResolver — setoa.dat', () => {
  // field000.pal is listed before fielde00.pal, so the stray fielde00 wins
  // slot 0 in archive order. The wart rule must force field000 back in.
  const archive = buildArchive([
    { name: 'field000.pal', data: palBytes(71) },
    { name: 'fielde00.pal', data: palBytes(70) },
    { name: 'field001.pal', data: palBytes(72) },
    { name: 'gui00.pal', data: palBytes(80) },
    { name: 'gui03.pal', data: palBytes(81) },
    { name: 'gui08.pal', data: palBytes(82) },
    { name: 'gui17.pal', data: palBytes(83) },
    { name: 'field000.epf', data: stub },
    { name: 'field001.epf', data: stub },
    { name: 'dlgcre01a.epf', data: stub },
    { name: 'emot9.epf', data: stub },
    { name: 'album.epf', data: stub },
    { name: 'zzz.epf', data: stub },
    { name: 'orb01.epf', data: stub },
  ]);
  const resolver = new PaletteResolver('setoa.dat', archive, noSiblings);
  const resolve = (name: string) => resolver.resolve(archive.get(name)!);

  it('forces field000.pal into slot 0 over the stray fielde00.pal', () => {
    const r = resolve('field000.epf')!;
    expect(r.ruleId).toBe('setoa/field');
    expect(r.paletteNumber).toBe(0);
    expect(r.palette.get(1).r).toBe(71);
  });

  it('resolves the other field palettes by identifier', () => {
    expect(resolve('field001.epf')!.palette.get(1).r).toBe(72);
  });

  it('resolves constant rules to their hand-mapped gui palettes', () => {
    const dlgcre01 = resolve('dlgcre01a.epf')!;
    expect(dlgcre01.kind).toBe('constant');
    expect(dlgcre01.paletteNumber).toBe(8);
    expect(dlgcre01.palette.get(1).r).toBe(82);

    expect(resolve('emot9.epf')!.palette.get(1).r).toBe(81);
    expect(resolve('album.epf')!.palette.get(1).r).toBe(83);
    expect(resolve('zzz.epf')!.palette.get(1).r).toBe(80);
  });

  it('returns null when the hand-mapped gui palette is absent', () => {
    // orb maps to gui 1, which this fixture does not contain.
    expect(resolve('orb01.epf')).toBeNull();
  });
});

describe('PaletteResolver — khan family', () => {
  const khanpal = buildArchive([
    { name: 'palb.tbl', data: enc('5 1\n5 2 -1\n5 3 -2\n') },
    { name: 'palb001.pal', data: palBytes(90) },
    { name: 'palb002.pal', data: palBytes(91) },
    { name: 'palb003.pal', data: palBytes(92) },
    { name: 'palm001.pal', data: palBytes(94) },
    { name: 'palm002.pal', data: palBytes(95) },
    { name: 'palm003.pal', data: palBytes(93) },
  ]);
  const legend = buildArchive([
    { name: 'color0.tbl', data: enc('2\n0\n10,20,30\n40,50,60\n') },
  ]);
  const archive = buildArchive([
    { name: 'mb00501.epf', data: stub },
    { name: 'fb00501.epf', data: stub },
    { name: 'ma00501.epf', data: stub },
    { name: 'mmbody01.epf', data: stub },
    { name: 'mn001.epf', data: stub },
    { name: 'mz001.epf', data: stub },
  ]);

  const makeResolver = () => {
    const calls: string[] = [];
    const resolver = new PaletteResolver('khanmt.dat', archive, name => {
      calls.push(name);
      if (name === 'khanpal.dat') return khanpal;
      if (name === 'legend.dat') return legend;
      return null;
    });
    return { resolver, calls };
  };

  it('resolves letter entries through the khanpal table with the gender override', () => {
    const { resolver } = makeResolver();
    // Entry id: the first three digits of "00501" → 5.
    const male = resolver.resolve(archive.get('mb00501.epf')!)!;
    expect(male.ruleId).toBe('khan/letter');
    expect(male.kind).toBe('table');
    expect(male.paletteNumber).toBe(2);
    expect(male.palette.get(1).r).toBe(91);

    const female = resolver.resolve(archive.get('fb00501.epf')!)!;
    expect(female.paletteNumber).toBe(3);
    expect(female.palette.get(1).r).toBe(92);
  });

  it('remaps the letter before the table lookup', () => {
    const { resolver } = makeResolver();
    // "a" remaps to "b", so the palb table serves this entry too.
    const remapped = resolver.resolve(archive.get('ma00501.epf')!)!;
    expect(remapped.paletteNumber).toBe(2);
    expect(remapped.palette.get(1).r).toBe(91);
  });

  it('resolves bodies to the lowest palm palette', () => {
    const { resolver } = makeResolver();
    const body = resolver.resolve(archive.get('mmbody01.epf')!)!;
    expect(body.ruleId).toBe('khan/body');
    expect(body.kind).toBe('indexed');
    expect(body.paletteNumber).toBe(1);
    expect(body.palette.get(1).r).toBe(94);
  });

  it('resolves pants to a blank palette dyed with color0 entry 0', () => {
    const { resolver } = makeResolver();
    const pants = resolver.resolve(archive.get('mn001.epf')!)!;
    expect(pants.ruleId).toBe('khan/pants');
    expect(pants.paletteNumber).toBe(0);
    // The dye writes the entry colors from index 98.
    expect(pants.palette.get(98)).toEqual({ r: 10, g: 20, b: 30, a: 255 });
    expect(pants.palette.get(99)).toEqual({ r: 40, g: 50, b: 60, a: 255 });
  });

  it('returns null for a letter outside the khan table set', () => {
    const { resolver } = makeResolver();
    expect(resolver.resolve(archive.get('mz001.epf')!)).toBeNull();
  });

  it('invokes the provider at most once per sibling archive', () => {
    const { resolver, calls } = makeResolver();
    resolver.resolve(archive.get('mb00501.epf')!);
    resolver.resolve(archive.get('ma00501.epf')!);
    resolver.resolve(archive.get('mn001.epf')!);
    resolver.resolve(archive.get('mn001.epf')!);
    expect(calls.filter(n => n === 'khanpal.dat')).toHaveLength(1);
    expect(calls.filter(n => n === 'legend.dat')).toHaveLength(1);
  });

  it('returns null when the provider has no sibling', () => {
    const resolver = new PaletteResolver('khanmt.dat', archive, noSiblings);
    expect(resolver.resolve(archive.get('mb00501.epf')!)).toBeNull();
    expect(resolver.resolve(archive.get('mn001.epf')!)).toBeNull();
  });

  it('treats a provider throw as an absent sibling', () => {
    let calls = 0;
    const resolver = new PaletteResolver('khanmt.dat', archive, () => {
      calls++;
      throw new Error('no filesystem');
    });
    expect(resolver.resolve(archive.get('mb00501.epf')!)).toBeNull();
    const afterFirst = calls;
    expect(resolver.resolve(archive.get('mb00501.epf')!)).toBeNull();

    // The first resolve tries the three distinct casings of `khanpal.dat`; the
    // second adds nothing, because the null is cached under the requested name.
    expect(afterFirst).toBe(3);
    expect(calls).toBe(3);
  });
});

describe('PaletteResolver — national.dat and misc.dat', () => {
  const legend = buildArchive([{ name: 'legend.pal', data: palBytes(20) }]);
  const provider = (name: string) => (name === 'legend.dat' ? legend : null);

  it('resolves every entry to legend.pal from the sibling legend.dat', () => {
    const national = buildArchive([{ name: 'nation01.epf', data: stub }]);
    const r = new PaletteResolver('national.dat', national, provider)
      .resolve(national.get('nation01.epf')!)!;
    expect(r.ruleId).toBe('national/legend');
    expect(r.kind).toBe('fixed');
    expect(r.palette.get(1).r).toBe(20);

    const misc = buildArchive([{ name: 'any.epf', data: stub }]);
    const m = new PaletteResolver('misc.dat', misc, provider).resolve(misc.get('any.epf')!)!;
    expect(m.ruleId).toBe('misc/legend');
    expect(m.palette.get(1).r).toBe(20);
  });

  it('returns null when the sibling is absent', () => {
    const national = buildArchive([{ name: 'nation01.epf', data: stub }]);
    expect(new PaletteResolver('national.dat', national, noSiblings)
      .resolve(national.get('nation01.epf')!)).toBeNull();
  });
});

describe('PaletteResolver — .hpf', () => {
  // stcani.tbl must stay out of the palette table: the stcpal pattern excludes
  // it. If it were merged, id 13 would map to palette 99 and resolve to null.
  const archive = buildArchive([
    { name: 'stcpal.tbl', data: enc('13 2\n21 1002\n') },
    { name: 'stcani.tbl', data: enc('13 13 99\n') },
    { name: 'stc000.pal', data: palBytes(102) },
    { name: 'stc002.pal', data: palBytes(100) },
    { name: 'stspal.tbl', data: enc('2 5\n') },
    { name: 'sts005.pal', data: palBytes(101) },
    { name: 'stc00012.hpf', data: stub },
    { name: 'stc00020.hpf', data: stub },
    { name: 'stc00099.hpf', data: stub },
    { name: 'sts00001.hpf', data: stub },
  ]);
  const resolver = new PaletteResolver('ia.dat', archive, noSiblings);
  const resolve = (name: string) => resolver.resolve(archive.get(name)!);

  it('adds one to the identifier for stc tiles', () => {
    const r = resolve('stc00012.hpf')!;
    expect(r.ruleId).toBe('hpf/stc');
    expect(r.paletteNumber).toBe(2);
    expect(r.luminanceBlended).toBe(false);
    expect(r.palette.get(1).r).toBe(100);
  });

  it('reports luminance blending for palette numbers of 1000 or more', () => {
    const r = resolve('stc00020.hpf')!;
    expect(r.paletteNumber).toBe(2);
    expect(r.luminanceBlended).toBe(true);
    // max channel 100 → LUT index 4 → alpha round(2 * 255 / 10) = 51.
    expect(r.palette.get(1).a).toBe(51);
  });

  it('falls back to palette 0 for an unmapped id, as the client does', () => {
    const r = resolve('stc00099.hpf')!;
    expect(r.paletteNumber).toBe(0);
    expect(r.palette.get(1).r).toBe(102);
  });

  it('routes non-stc entries through the sts table', () => {
    const r = resolve('sts00001.hpf')!;
    expect(r.ruleId).toBe('hpf/sts');
    expect(r.paletteNumber).toBe(5);
    expect(r.palette.get(1).r).toBe(101);
  });
});

describe('PaletteResolver — tilesets', () => {
  const archive = buildArchive([
    { name: 'mptpal.tbl', data: enc('3 7\n') },
    { name: 'mpt007.pal', data: palBytes(110) },
    { name: 'mpspal.tbl', data: enc('1 4\n') },
    { name: 'mps004.pal', data: palBytes(111) },
    { name: 'tilea.bmp', data: stub },
    { name: 'tileas.bmp', data: stub },
  ]);
  const resolver = new PaletteResolver('seo.dat', archive, noSiblings);

  it('keys the ground tileset on tileIndex + 1', () => {
    const r = resolver.resolve(archive.get('tilea.bmp')!, 2)!;
    expect(r.ruleId).toBe('tileset/mpt');
    expect(r.paletteNumber).toBe(7);
    expect(r.palette.get(1).r).toBe(110);
  });

  it('keys the static tileset on tileIndex + 1', () => {
    const r = resolver.resolve(archive.get('tileas.bmp')!, 0)!;
    expect(r.ruleId).toBe('tileset/mps');
    expect(r.paletteNumber).toBe(4);
    expect(r.palette.get(1).r).toBe(111);
  });

  it('returns null when the mapped palette is absent', () => {
    // Tile index 0 → id 1 is unmapped and this fixture has no palette 0.
    expect(resolver.resolve(archive.get('tilea.bmp')!)).toBeNull();
  });
});

describe('PaletteResolver — .mpf', () => {
  const archive = buildArchive([
    { name: 'mns003.pal', data: palBytes(120) },
    { name: 'mon001.mpf', data: mpfBytes(3) },
    { name: 'mon002.mpf', data: mpfBytes(9) },
    { name: 'bad.mpf', data: new Uint8Array([1, 2]) },
  ]);
  const resolver = new PaletteResolver('sanm.dat', archive, noSiblings);

  it('reads the palette number from inside the file', () => {
    const r = resolver.resolve(archive.get('mon001.mpf')!)!;
    expect(r.ruleId).toBe('mpf/mns');
    expect(r.kind).toBe('indexed');
    expect(r.paletteNumber).toBe(3);
    expect(r.palette.get(1).r).toBe(120);
  });

  it('returns null when the palette number is absent from the map', () => {
    expect(resolver.resolve(archive.get('mon002.mpf')!)).toBeNull();
  });

  it('returns null for a corrupt file instead of throwing', () => {
    expect(resolver.resolve(archive.get('bad.mpf')!)).toBeNull();
  });
});

describe('PaletteResolver — source build failures', () => {
  // A 10-byte .pal is truncated: Palette.fromBuffer throws while reading it.
  const badPal = new Uint8Array(10);

  it('returns null when a table source fails to build, and caches the failure', () => {
    const archive = buildArchive([
      { name: 'stcpal.tbl', data: enc('13 2\n') },
      { name: 'stc002.pal', data: badPal },
      { name: 'stc00012.hpf', data: stub },
    ]);
    const resolver = new PaletteResolver('ia.dat', archive, noSiblings);
    expect(resolver.resolve(archive.get('stc00012.hpf')!)).toBeNull();
    expect(resolver.resolve(archive.get('stc00012.hpf')!)).toBeNull();
  });

  it('returns null when an indexed palette map fails to build', () => {
    const archive = buildArchive([
      { name: 'backpal1.pal', data: badPal },
      { name: 'bkstory1.epf', data: stub },
    ]);
    const resolver = new PaletteResolver('legend.dat', archive, noSiblings);
    expect(resolver.resolve(archive.get('bkstory1.epf')!)).toBeNull();
  });

  it('returns null when a constant rule gui map fails to build', () => {
    const archive = buildArchive([
      { name: 'gui00.pal', data: badPal },
      { name: 'zzz.epf', data: stub },
    ]);
    const resolver = new PaletteResolver('setoa.dat', archive, noSiblings);
    expect(resolver.resolve(archive.get('zzz.epf')!)).toBeNull();
  });

  it('returns null when a fixed palette fails to parse', () => {
    const archive = buildArchive([
      { name: 'legend.pal', data: badPal },
      { name: 'zzz.epf', data: stub },
    ]);
    const resolver = new PaletteResolver('legend.dat', archive, noSiblings);
    expect(resolver.resolve(archive.get('zzz.epf')!)).toBeNull();
  });

  it('returns null for pants when the sibling has no color0.tbl', () => {
    const archive = buildArchive([{ name: 'mn001.epf', data: stub }]);
    const legend = buildArchive([{ name: 'legend.pal', data: palBytes(20) }]);
    const resolver = new PaletteResolver('khanm.dat', archive, name => (name === 'legend.dat' ? legend : null));
    expect(resolver.resolve(archive.get('mn001.epf')!)).toBeNull();
  });

  it('returns null for pants when color0.tbl lacks entry 0', () => {
    const archive = buildArchive([{ name: 'mn001.epf', data: stub }]);
    const legend = buildArchive([
      { name: 'color0.tbl', data: enc('2\n1\n10,20,30\n40,50,60\n') },
    ]);
    const resolver = new PaletteResolver('khanm.dat', archive, name => (name === 'legend.dat' ? legend : null));
    expect(resolver.resolve(archive.get('mn001.epf')!)).toBeNull();
  });

  it('returns null for bodies when the sibling holds no palm palettes', () => {
    const archive = buildArchive([{ name: 'mmbody01.epf', data: stub }]);
    const khanpal = buildArchive([{ name: 'palb.tbl', data: enc('5 1\n') }]);
    const resolver = new PaletteResolver('khanm.dat', archive, name => (name === 'khanpal.dat' ? khanpal : null));
    expect(resolver.resolve(archive.get('mmbody01.epf')!)).toBeNull();
  });

  it('returns null when a table rule finds no numeric identifier', () => {
    const khanpal = buildArchive([
      { name: 'palb.tbl', data: enc('5 1\n') },
      { name: 'palb001.pal', data: palBytes(90) },
    ]);
    const archive = buildArchive([
      { name: 'mb.epf', data: stub },
      { name: 'item.epf', data: stub },
      { name: 'stc.hpf', data: stub },
    ]);
    const khan = new PaletteResolver('khanm.dat', archive, name => (name === 'khanpal.dat' ? khanpal : null));
    expect(khan.resolve(archive.get('mb.epf')!)).toBeNull();

    const legend = new PaletteResolver('legend.dat', archive, noSiblings);
    expect(legend.resolve(archive.get('item.epf')!)).toBeNull();

    const ia = new PaletteResolver('ia.dat', archive, noSiblings);
    expect(ia.resolve(archive.get('stc.hpf')!)).toBeNull();
  });

  it('resolves setoa field entries when no field000.pal exists', () => {
    const archive = buildArchive([
      { name: 'field001.pal', data: palBytes(72) },
      { name: 'field001.epf', data: stub },
    ]);
    const resolver = new PaletteResolver('setoa.dat', archive, noSiblings);
    expect(resolver.resolve(archive.get('field001.epf')!)!.palette.get(1).r).toBe(72);
  });
});

describe('PaletteResolver — unresolved entries', () => {
  it('returns null when no rule matches the archive', () => {
    const archive = buildArchive([{ name: 'whatever.epf', data: stub }]);
    const resolver = new PaletteResolver('foo.dat', archive, noSiblings);
    expect(resolver.resolve(archive.get('whatever.epf')!)).toBeNull();
  });

  it('returns null for roh.dat entries outside efct and mefc', () => {
    const archive = buildArchive([{ name: 'wizard01.epf', data: stub }]);
    const resolver = new PaletteResolver('roh.dat', archive, noSiblings);
    expect(resolver.resolve(archive.get('wizard01.epf')!)).toBeNull();
  });
});

describe('PaletteResolver — sibling archive casing', () => {
  const legend = buildArchive([{ name: 'legend.pal', data: palBytes(77) }]);
  const archive = buildArchive([{ name: 'anything.epf', data: stub }]);

  /** A provider backed by one archive stored under exactly `storedAs`. */
  const caseSensitiveProvider = (storedAs: string) => {
    const asked: string[] = [];
    const provider = (name: string) => {
      asked.push(name);
      return name === storedAs ? legend : null;
    };
    return { asked, provider };
  };

  // national.dat resolves through a fixed `legend.pal` in the sibling legend.dat,
  // so it exercises the cross-archive boundary with the least machinery.
  const resolveVia = (provider: (name: string) => typeof legend | null) =>
    new PaletteResolver('national.dat', archive, provider).resolve(archive.get('anything.epf')!);

  it('finds the sibling when the host stores it as the installer wrote it', () => {
    // The official 7.41 installer writes `Legend.dat`. The rules ask for
    // `legend.dat`, so on a case-sensitive filesystem this used to resolve to
    // null with no error, and the caller silently fell back to a manual picker.
    const { asked, provider } = caseSensitiveProvider('Legend.dat');
    const resolved = resolveVia(provider);

    expect(resolved).not.toBeNull();
    expect(resolved!.palette.get(1).r).toBe(77);
    expect(asked).toEqual(['legend.dat', 'Legend.dat']);
  });

  it('finds the sibling when an unpacker folded the name to upper case', () => {
    const { asked, provider } = caseSensitiveProvider('LEGEND.DAT');
    expect(resolveVia(provider)).not.toBeNull();
    expect(asked).toEqual(['legend.dat', 'Legend.dat', 'LEGEND.DAT']);
  });

  it('asks exactly once when the first name answers', () => {
    // A case-insensitive host must not pay for the retry.
    const { asked, provider } = caseSensitiveProvider('legend.dat');
    expect(resolveVia(provider)).not.toBeNull();
    expect(asked).toEqual(['legend.dat']);
  });

  it('caches the miss under the requested name and stops probing', () => {
    let calls = 0;
    const provider = () => {
      calls++;
      return null;
    };
    const resolver = new PaletteResolver('national.dat', archive, provider);
    const entry = archive.get('anything.epf')!;

    expect(resolver.resolve(entry)).toBeNull();
    const afterFirst = calls;
    expect(resolver.resolve(entry)).toBeNull();

    // Three distinct casings tried once, then the null is cached by the name the
    // rule asked for — not re-probed on every call.
    expect(afterFirst).toBe(3);
    expect(calls).toBe(3);
  });

  it('survives a provider that throws on a name it does not expect', () => {
    const asked: string[] = [];
    const provider = (name: string) => {
      asked.push(name);
      if (name !== 'Legend.dat') throw new Error('no such file');
      return legend;
    };
    expect(resolveVia(provider)).not.toBeNull();
    expect(asked).toEqual(['legend.dat', 'Legend.dat']);
  });
});

// ---------------------------------------------------------------------------
// Real-client conformance (skipped when no client install is present)
// ---------------------------------------------------------------------------

interface ClientResolveCase {
  archive: string;
  entryPrefix: string;
  ext: string;
  ruleId: string;
}

const clientCases = (JSON.parse(
  readFileSync(new URL('./fixtures/palette-resolution.json', import.meta.url), 'utf8'),
) as { clientResolve: ClientResolveCase[] }).clientResolve;

describe.skipIf(!hasClientArchive('legend.dat'))('PaletteResolver against the real client', () => {
  const cache = new Map<string, DataArchive | null>();
  const load = (name: string): DataArchive | null => {
    let archive = cache.get(name);
    if (archive === undefined) {
      archive = hasClientArchive(name) ? DataArchive.fromFile(clientArchive(name)) : null;
      cache.set(name, archive);
    }
    return archive;
  };

  it.each(clientCases)('$archive: $entryPrefix*$ext → $ruleId', ({ archive, entryPrefix, ext, ruleId }) => {
    const dat = load(archive);
    if (!dat) return; // this install lacks the archive; nothing to assert
    const entry = dat.getEntriesByPattern(entryPrefix, ext)[0];
    expect(entry, `${archive} holds no ${entryPrefix}*${ext}`).toBeDefined();

    const resolved = new PaletteResolver(archive, dat, load).resolve(entry!);
    expect(resolved).not.toBeNull();
    expect(resolved!.ruleId).toBe(ruleId);
  });
});
