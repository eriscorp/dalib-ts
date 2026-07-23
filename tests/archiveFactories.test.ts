import { describe, expect, it } from 'vitest';
import { buildArchive } from './archiveFixture.js';
import { COLORS_PER_PALETTE, HPF_TILE_WIDTH } from '../src/constants.js';
import type { DataArchive } from '../src/data/DataArchive.js';
import type { DataArchiveEntry } from '../src/data/DataArchiveEntry.js';
import { SotpFile } from '../src/data/SotpFile.js';
import { BikFile } from '../src/drawing/BikFile.js';
import { ColorTable } from '../src/drawing/ColorTable.js';
import { ControlFile } from '../src/drawing/ControlFile.js';
import { EffectTable } from '../src/drawing/EffectTable.js';
import { FntFile } from '../src/drawing/FntFile.js';
import { HeaFile } from '../src/drawing/HeaFile.js';
import { HpfFile } from '../src/drawing/HpfFile.js';
import { LftFile, LFT_BITMAP_BASE, LFT_RECORD_LENGTH } from '../src/drawing/LftFile.js';
import { Palette } from '../src/drawing/Palette.js';
import { PcxFile } from '../src/drawing/PcxFile.js';
import { TileAnimationTable } from '../src/drawing/TileAnimationTable.js';

/**
 * Each parser exposes `fromEntry` and `fromArchive` alongside `fromBuffer`.
 * `fromArchive` appends the extension when the caller leaves it off and throws a
 * named error when the entry is absent, so both branches are asserted here.
 */

const enc = (text: string) => new TextEncoder().encode(text);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function hpfBytes(): Uint8Array {
  const out = new Uint8Array(8 + HPF_TILE_WIDTH * 2);
  out[8] = 42;
  return out;
}

function palBytes(r: number): Uint8Array {
  const bytes = new Uint8Array(COLORS_PER_PALETTE * 3);
  bytes[3] = r;
  return bytes;
}

function bikBytes(): Uint8Array {
  const bytes = new Uint8Array(64);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x42; bytes[1] = 0x49; bytes[2] = 0x4b; bytes[3] = 0x69;
  view.setUint32(8, 300, true);
  view.setUint32(16, 300, true);
  view.setUint32(20, 640, true);
  view.setUint32(24, 480, true);
  view.setUint32(28, 30, true);
  view.setUint32(32, 1, true);
  return bytes;
}

function pcxBytes(): Uint8Array {
  const header = new Uint8Array(128);
  const view = new DataView(header.buffer);
  header[0] = 0x0a; header[1] = 5; header[2] = 1; header[3] = 8;
  view.setUint16(8, 3, true);
  view.setUint16(10, 0, true);
  header[65] = 1;
  view.setUint16(66, 4, true);

  const body = [0xc4, 5];
  const bytes = new Uint8Array(header.length + body.length + 1 + 768);
  bytes.set(header);
  bytes.set(body, header.length);
  bytes[header.length + body.length] = 0x0c;
  return bytes;
}

function heaBytes(): Uint8Array {
  const ints = [0, 640, 480, 640, 480, 2, 3, 4, 1, 1, 0, 0];
  const runs = [5, 4];
  const bytes = new Uint8Array(ints.length * 4 + runs.length);
  const view = new DataView(bytes.buffer);
  ints.forEach((v, i) => view.setInt32(i * 4, v, true));
  bytes.set(runs, ints.length * 4);
  return bytes;
}

function lftBytes(): Uint8Array {
  const bytes = new Uint8Array(LFT_BITMAP_BASE + 16);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 12, true);
  view.setUint16(2, 12, true);
  const record = 4 + 0x41 * LFT_RECORD_LENGTH;
  bytes[record] = 6;
  bytes[record + 3] = 4;
  bytes[record + 4] = 4;
  view.setUint32(record + 7, 8, true);
  bytes.fill(0xff, LFT_BITMAP_BASE);
  return bytes;
}

const CONTROL_TEXT = [
  '<CONTROL>',
  '    <NAME> "OK"',
  '    <TYPE> 7',
  '    <RECT> 1 2 3 4',
  '<ENDCONTROL>',
].join('\n');

// ---------------------------------------------------------------------------
// The common shape: fromEntry, fromArchive with and without the extension,
// and a named throw when the entry is absent.
// ---------------------------------------------------------------------------

interface FactoryCase<T> {
  label: string;
  entryName: string;
  data: Uint8Array;
  fromEntry: (entry: DataArchiveEntry) => T;
  fromArchive: (name: string, archive: DataArchive) => T;
  check: (parsed: T) => void;
}

/** Keep each case's type intact while erasing it for the shared table. */
function factoryCase<T>(c: FactoryCase<T>): FactoryCase<unknown> {
  return c as FactoryCase<unknown>;
}

const CASES: FactoryCase<unknown>[] = [
  factoryCase({
    label: 'HpfFile',
    entryName: 'stc00001.hpf',
    data: hpfBytes(),
    fromEntry: HpfFile.fromEntry,
    fromArchive: HpfFile.fromArchive,
    check: p => expect(p.pixelHeight).toBe(2),
  }),
  factoryCase({
    label: 'BikFile',
    entryName: 'intro.bik',
    data: bikBytes(),
    fromEntry: BikFile.fromEntry,
    fromArchive: BikFile.fromArchive,
    check: p => expect(p.width).toBe(640),
  }),
  factoryCase({
    label: 'PcxFile',
    entryName: 'logo.pcx',
    data: pcxBytes(),
    fromEntry: PcxFile.fromEntry,
    fromArchive: PcxFile.fromArchive,
    check: p => expect(p.width).toBe(4),
  }),
  factoryCase({
    label: 'ColorTable',
    entryName: 'dyes.tbl',
    data: enc('1\n4\n255,128,0\n'),
    fromEntry: ColorTable.fromEntry,
    fromArchive: ColorTable.fromArchive,
    check: p => expect(p.get(4)?.colors).toHaveLength(1),
  }),
  factoryCase({
    label: 'TileAnimationTable',
    entryName: 'anim.tbl',
    data: enc('1\n10 11 12 3\n'),
    fromEntry: TileAnimationTable.fromEntry,
    fromArchive: TileAnimationTable.fromArchive,
    check: p => expect(p.tryGetEntry(10)!.tileSequence).toEqual([10, 11, 12]),
  }),
  factoryCase({
    label: 'LftFile',
    entryName: 'da.lft',
    data: lftBytes(),
    fromEntry: LftFile.fromEntry,
    fromArchive: LftFile.fromArchive,
    check: p => expect(p.getAdvance(0x41)).toBe(6),
  }),
];

describe.each(CASES)('$label archive factories', ({ entryName, data, fromEntry, fromArchive, check }) => {
  const stem = entryName.replace(/\.[^.]+$/, '');
  const archive = () => buildArchive([{ name: entryName, data }]);

  it('reads from an entry', () => {
    check(fromEntry(archive().get(entryName)!));
  });

  it('appends the extension when the caller omits it', () => {
    check(fromArchive(stem, archive()));
    check(fromArchive(entryName, archive()));
  });

  it('throws when the entry is missing', () => {
    expect(() => fromArchive('nope', buildArchive([]))).toThrow(/not found/);
  });
});

// ---------------------------------------------------------------------------
// Factories with a shape of their own
// ---------------------------------------------------------------------------

describe('FntFile archive factories', () => {
  const data = new Uint8Array(94 * 12).fill(0xff);

  it('carries the cell size through both factories', () => {
    const archive = buildArchive([{ name: 'eng00.fnt', data }]);
    expect(FntFile.fromEntry(archive.get('eng00.fnt')!, 8, 12).glyphCount).toBe(94);
    expect(FntFile.fromArchive('eng00', archive, 8, 12).glyphWidth).toBe(8);
    expect(FntFile.fromArchive('eng00.fnt', archive, 8, 12).glyphHeight).toBe(12);
  });

  it('throws when the entry is missing', () => {
    expect(() => FntFile.fromArchive('nope', buildArchive([]), 8, 12)).toThrow(/not found/);
  });
});

describe('HeaFile archive factories', () => {
  it('accepts a name or a map number', () => {
    const archive = buildArchive([{ name: '000042.hea', data: heaBytes() }]);
    expect(HeaFile.fromEntry(archive.get('000042.hea')!).screenWidth).toBe(640);
    // Per-map overlays are named by a zero-padded map id.
    expect(HeaFile.fromArchive(42, archive).screenWidth).toBe(640);
    expect(HeaFile.fromArchive('000042', archive).screenWidth).toBe(640);
    expect(HeaFile.fromArchive('000042.hea', archive).screenWidth).toBe(640);
  });

  it('throws when the entry is missing', () => {
    expect(() => HeaFile.fromArchive(7, buildArchive([]))).toThrow(/not found/);
  });
});

describe('SotpFile archive factories', () => {
  it('defaults to the sotp.dat entry name', () => {
    const archive = buildArchive([{ name: 'sotp.dat', data: new Uint8Array([0x0f, 0x8f]) }]);
    expect(SotpFile.fromEntry(archive.get('sotp.dat')!).maxTileId).toBe(2);
    expect(SotpFile.fromArchive(archive).getFlags(1)).toBe(0x0f);
    expect(SotpFile.fromArchive(archive, 'sotp.dat').isOverPlayer(2)).toBe(true);
  });

  it('throws when the entry is missing', () => {
    expect(() => SotpFile.fromArchive(buildArchive([]))).toThrow(/not found/);
  });

  it('exposes the backing bytes verbatim', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(Array.from(SotpFile.fromBuffer(bytes).toUint8Array())).toEqual([1, 2, 3]);
  });
});

describe('EffectTable archive factories', () => {
  // The effect table has one fixed name, so fromArchive takes the archive alone.
  it('reads the fixed effect.tbl entry', () => {
    const archive = buildArchive([{ name: 'effect.tbl', data: enc('2\n1 2 3\n4 5\n') }]);
    expect(EffectTable.fromEntry(archive.get('effect.tbl')!).tryGetEntry(1)!.frameSequence)
      .toEqual([1, 2, 3]);
    expect(EffectTable.fromArchive(archive).tryGetEntry(2)!.frameSequence).toEqual([4, 5]);
  });

  it('throws when the entry is missing', () => {
    expect(() => EffectTable.fromArchive(buildArchive([]))).toThrow(/not found/);
  });
});

describe('Palette.fromArchive', () => {
  // Palettes load as a whole family, keyed by the number in the file name.
  it('returns a map keyed by the numeric identifier', () => {
    const archive = buildArchive([
      { name: 'mns001.pal', data: palBytes(10) },
      { name: 'mns002.pal', data: palBytes(20) },
    ]);

    const palettes = Palette.fromArchive('mns', archive);
    expect(palettes.size).toBe(2);
    expect(palettes.get(1)!.get(1).r).toBe(10);
    expect(palettes.get(2)!.get(1).r).toBe(20);
  });

  it('skips an entry with no number in its name', () => {
    const archive = buildArchive([
      { name: 'mns.pal', data: palBytes(5) },
      { name: 'mns003.pal', data: palBytes(30) },
    ]);

    const palettes = Palette.fromArchive('mns', archive);
    expect(palettes.size).toBe(1);
    expect(palettes.get(3)!.get(1).r).toBe(30);
  });

  it('returns an empty map when nothing matches', () => {
    expect(Palette.fromArchive('nothing', buildArchive([])).size).toBe(0);
  });

  it('reads a single palette from an entry', () => {
    const archive = buildArchive([{ name: 'x.pal', data: palBytes(7) }]);
    expect(Palette.fromEntry(archive.get('x.pal')!).get(1).r).toBe(7);
  });
});

describe('ControlFile.fromArchive', () => {
  // UI layouts load as a whole set, keyed by the lowercased file stem.
  it('parses every .txt entry into a map', () => {
    const archive = buildArchive([
      { name: '_nMain.txt', data: enc(CONTROL_TEXT) },
      { name: '_nopt.txt', data: enc(CONTROL_TEXT) },
      { name: 'skip.pal', data: new Uint8Array(4) },
    ]);

    const layouts = ControlFile.fromArchive(archive);
    expect(layouts.size).toBe(2);
    expect(layouts.get('_nmain')!.get('OK')!.type).toBe(7);
    expect(layouts.has('skip')).toBe(false);
  });

  it('returns an empty map for an archive with no layouts', () => {
    expect(ControlFile.fromArchive(buildArchive([])).size).toBe(0);
  });

  it('reads a single layout from an entry', () => {
    const archive = buildArchive([{ name: '_nmain.txt', data: enc(CONTROL_TEXT) }]);
    expect(ControlFile.fromEntry(archive.get('_nmain.txt')!).controls).toHaveLength(1);
  });
});
