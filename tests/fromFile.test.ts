import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { buildArchiveBytes } from './archiveFixture.js';
import {
  COLORS_PER_PALETTE,
  DATA_ARCHIVE_ENTRY_NAME_LENGTH,
  HPF_TILE_WIDTH,
  TILE_SIZE,
} from '../src/constants.js';
import { DataArchive } from '../src/data/DataArchive.js';
import { MapFile } from '../src/data/MapFile.js';
import { MetaFile } from '../src/data/MetaFile.js';
import { SotpFile } from '../src/data/SotpFile.js';
import { BikFile } from '../src/drawing/BikFile.js';
import { ColorTable } from '../src/drawing/ColorTable.js';
import { ControlFile } from '../src/drawing/ControlFile.js';
import { EfaFile } from '../src/drawing/EfaFile.js';
import { EffectTable } from '../src/drawing/EffectTable.js';
import { EpfFile } from '../src/drawing/EpfFile.js';
import { FntFile } from '../src/drawing/FntFile.js';
import { HeaFile } from '../src/drawing/HeaFile.js';
import { HpfFile } from '../src/drawing/HpfFile.js';
import { JpfFile } from '../src/drawing/JpfFile.js';
import { LftFile, LFT_BITMAP_BASE, LFT_RECORD_LENGTH } from '../src/drawing/LftFile.js';
import { MpfFile } from '../src/drawing/MpfFile.js';
import { Palette } from '../src/drawing/Palette.js';
import { PaletteTable } from '../src/drawing/PaletteTable.js';
import { PcxFile } from '../src/drawing/PcxFile.js';
import { SpfFile } from '../src/drawing/SpfFile.js';
import { TileAnimationTable } from '../src/drawing/TileAnimationTable.js';
import { Tileset } from '../src/drawing/Tileset.js';
import { SpfFormatType } from '../src/enums.js';

/**
 * Every parser exposes a Node-only `fromFile` factory that reads a path and
 * delegates to `fromBuffer`. The delegation is one line each, but a wrong
 * `Uint8Array` view over the `Buffer` — the usual mistake — silently hands the
 * parser the whole pooled allocation instead of the file. These tests write a
 * real fixture to disk and read it back through each factory.
 */

const dir = mkdtempSync(join(tmpdir(), 'dalib-fromfile-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const enc = (text: string) => new TextEncoder().encode(text);

/** Write `bytes` to a scratch file and return its path. */
function fixture(name: string, bytes: Uint8Array): string {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

describe('Node-only fromFile factories', () => {
  it('DataArchive reads an archive and its entries', () => {
    const path = fixture('test.dat', buildArchiveBytes([
      { name: 'a.pal', data: new Uint8Array(COLORS_PER_PALETTE * 3).fill(7) },
      { name: 'b.tbl', data: enc('1 2 3') },
    ]));

    const archive = DataArchive.fromFile(path);
    expect(archive.get('a.pal')).toBeDefined();
    expect(archive.get('b.tbl')!.toUint8Array()).toHaveLength(5);
    // The entry body must be the file's bytes, not a slice of a pooled Buffer.
    expect(archive.get('a.pal')!.toUint8Array()[0]).toBe(7);
  });

  it('DataArchive forwards its options argument', () => {
    const path = fixture('opts.dat', buildArchiveBytes([{ name: 'x.pal', data: new Uint8Array(4) }]));
    expect(DataArchive.fromFile(path, false).get('x.pal')).toBeDefined();
    expect(DataArchive.fromFile(path, {}).get('x.pal')).toBeDefined();
  });

  it('MapFile reads a grid at the supplied dimensions', () => {
    const bytes = new Uint8Array(2 * 1 * 6);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 0x2710, true); view.setUint16(2, 5, true); view.setUint16(4, 6, true);
    view.setUint16(6, 9, true); view.setUint16(8, 0, true); view.setUint16(10, 0, true);

    const map = MapFile.fromFile(fixture('map.map', bytes), 2, 1);
    expect(map.width).toBe(2);
    expect(map.getTile(0, 0)).toEqual({ background: 0x2710, leftForeground: 5, rightForeground: 6 });
    expect(map.getTile(1, 0).background).toBe(9);
  });

  it('MetaFile reads both the compressed and the plain form', () => {
    // u16be group count, then u8 name length + name, u16be value count,
    // then u16be length + bytes per value.
    const plain = new Uint8Array([
      0, 1,
      3, 0x41, 0x42, 0x43, // "ABC"
      0, 1,
      0, 2, 0x68, 0x69, // "hi"
    ]);

    const raw = MetaFile.fromFile(fixture('meta.plain', plain), false);
    expect(raw.entries[0]!.key).toBe('ABC');
    expect(raw.entries[0]!.properties).toEqual(['hi']);

    const compressed = new Uint8Array(deflateSync(Buffer.from(plain)));
    const inflated = MetaFile.fromFile(fixture('meta.mpk', compressed));
    expect(inflated.entries[0]!.key).toBe('ABC');
  });

  it('SotpFile reads the flat collision table', () => {
    const sotp = SotpFile.fromFile(fixture('sotp.dat', new Uint8Array([0x0f, 0x00, 0x8f])));
    expect(sotp.maxTileId).toBe(3);
    expect(sotp.getFlags(1)).toBe(0x0f);
    expect(sotp.isOverPlayer(3)).toBe(true);
  });

  it('ColorTable reads a dye table', () => {
    const table = ColorTable.fromFile(fixture('color.tbl', enc('1\n4\n255,128,0\n')));
    expect(table.get(4)?.colors).toEqual([{ r: 255, g: 128, b: 0, a: 255 }]);
  });

  it('EffectTable reads a frame-sequence table', () => {
    const table = EffectTable.fromFile(fixture('effect.tbl', enc('2\n1 2 3\n4 5\n')));
    expect(table.tryGetEntry(1)!.frameSequence).toEqual([1, 2, 3]);
    expect(table.tryGetEntry(2)!.frameSequence).toEqual([4, 5]);
  });

  it('TileAnimationTable reads a tile-animation table', () => {
    const table = TileAnimationTable.fromFile(fixture('anim.tbl', enc('1\n10 11 12 3\n')));
    expect(table.tryGetEntry(10)!.tileSequence).toEqual([10, 11, 12]);
    expect(table.tryGetEntry(10)!.animationIntervalMs).toBe(300);
  });

  it('PaletteTable reads a palette range table', () => {
    const table = PaletteTable.fromFile(fixture('stcpal.tbl', enc('1 4 7\n20 3\n')));
    expect(table.getPaletteNumber(2)).toBe(7);
    expect(table.getPaletteNumber(20)).toBe(3);
  });

  it('ControlFile reads a UI layout', () => {
    const text = [
      '<CONTROL>',
      '    <NAME> "OK"',
      '    <TYPE> 7',
      '    <RECT> 1 2 3 4',
      '    <IMAGE>',
      '        "_nbtn.spf" 0',
      '<ENDCONTROL>',
    ].join('\n');

    const file = ControlFile.fromFile(fixture('_nmain.txt', enc(text)));
    expect(file.get('OK')!.type).toBe(7);
    expect(file.get('OK')!.images).toEqual([{ imageName: '_nbtn.spf', frameIndex: 0 }]);
  });

  it('Palette reads a 768-byte PAL', () => {
    const bytes = new Uint8Array(COLORS_PER_PALETTE * 3);
    bytes[3] = 10; bytes[4] = 20; bytes[5] = 30;
    const palette = Palette.fromFile(fixture('mns001.pal', bytes));
    expect(palette.length).toBe(COLORS_PER_PALETTE);
    expect(palette.get(1)).toEqual({ r: 10, g: 20, b: 30, a: 255 });
  });

  it('HpfFile reads an eight-byte header plus pixels', () => {
    const bytes = new Uint8Array(8 + HPF_TILE_WIDTH * 2);
    bytes[8] = 42;
    const hpf = HpfFile.fromFile(fixture('stc00001.hpf', bytes));
    expect(hpf.pixelWidth).toBe(HPF_TILE_WIDTH);
    expect(hpf.pixelHeight).toBe(2);
    expect(hpf.data[0]).toBe(42);
  });

  it('EpfFile reads a multi-frame sprite', () => {
    const epf = new EpfFile();
    epf.pixelWidth = 8;
    epf.pixelHeight = 6;
    epf.frames.push({ top: 0, left: 0, bottom: 2, right: 3, data: new Uint8Array([1, 2, 3, 4, 5, 6]) });

    const parsed = EpfFile.fromFile(fixture('item001.epf', epf.toUint8Array()));
    expect(parsed.pixelWidth).toBe(8);
    expect(Array.from(parsed.frames[0]!.data)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('SpfFile reads a palettized sprite', () => {
    const spf = new SpfFile(SpfFormatType.Palettized);
    spf.primaryColors = new Palette();
    spf.secondaryColors = new Palette();
    spf.frames.push({
      left: 0, top: 0, right: 2, bottom: 2,
      centerX: 0, centerY: 0, flags: 0, hasCenterPoint: false,
      startAddress: 0, byteWidth: 2, byteCount: 4, imageByteCount: 4,
      data: new Uint8Array([1, 2, 3, 4]),
    });

    const parsed = SpfFile.fromFile(fixture('art.spf', spf.toUint8Array()));
    expect(parsed.format).toBe(SpfFormatType.Palettized);
    expect(Array.from(parsed.frames[0]!.data!)).toEqual([1, 2, 3, 4]);
  });

  it('MpfFile reads an animation file', () => {
    const mpf = new MpfFile();
    mpf.pixelWidth = 8;
    mpf.pixelHeight = 8;
    mpf.paletteNumber = 12;
    mpf.frames.push({
      left: 0, top: 0, right: 2, bottom: 2,
      centerX: 0, centerY: 0, startAddress: 0,
      data: new Uint8Array([1, 2, 3, 4]),
    });

    const parsed = MpfFile.fromFile(fixture('mns001.mpf', mpf.toUint8Array()));
    expect(parsed.paletteNumber).toBe(12);
    expect(Array.from(parsed.frames[0]!.data)).toEqual([1, 2, 3, 4]);
  });

  it('EfaFile reads a compressed animation file', () => {
    const source = EfaFile.fromRgbaFrames([
      { width: 2, height: 2, data: new Uint8ClampedArray(2 * 2 * 4).fill(255) },
    ]);
    const parsed = EfaFile.fromFile(fixture('spell.efa', source.toUint8Array()));
    expect(parsed.frames).toHaveLength(1);
    expect(parsed.frames[0]!.framePixelWidth).toBe(2);
  });

  it('Tileset reads a headerless ground-tile bank', () => {
    const bytes = new Uint8Array(TILE_SIZE * 2);
    bytes.fill(3, TILE_SIZE);
    const ts = Tileset.fromFile(fixture('tilea.bmp', bytes));
    expect(ts.length).toBe(2);
    expect(ts.tiles[1]!.data[0]).toBe(3);
  });

  it('HeaFile reads a darkness overlay', () => {
    const ints = [0, 640, 480, 640, 480, 2, 3, 4, 1, 1, /* threshold */ 0, /* offset */ 0];
    const runs = [5, 4];
    const bytes = new Uint8Array(ints.length * 4 + runs.length);
    const view = new DataView(bytes.buffer);
    ints.forEach((v, i) => view.setInt32(i * 4, v, true));
    bytes.set(runs, ints.length * 4);

    const hea = HeaFile.fromFile(fixture('000001.hea', bytes));
    expect(hea.screenWidth).toBe(640);
    expect(hea.scanlineWidth).toBe(4);
    expect(hea.layerCount).toBe(1);
  });

  it('FntFile reads a fixed-cell glyph bank at the supplied cell size', () => {
    const font = FntFile.fromFile(fixture('eng00.fnt', new Uint8Array(94 * 12).fill(0xff)), 8, 12);
    expect(font.glyphWidth).toBe(8);
    expect(font.glyphHeight).toBe(12);
    expect(font.glyphCount).toBe(94);
  });

  it('LftFile reads the record table and the bitmap region', () => {
    const bytes = new Uint8Array(LFT_BITMAP_BASE + 16);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 12, true); // nominal width
    view.setUint16(2, 12, true); // nominal height
    const record = 4 + 0x41 * LFT_RECORD_LENGTH;
    bytes[record] = 6;     // advance
    bytes[record + 3] = 4; // right
    bytes[record + 4] = 4; // bottom
    view.setUint32(record + 7, 8, true); // bitmap offset
    bytes.fill(0xff, LFT_BITMAP_BASE);

    const lft = LftFile.fromFile(fixture('da.lft', bytes));
    expect(lft.getAdvance(0x41)).toBe(6);
    expect(lft.getGlyphPixels(0x41).width).toBe(4);
  });

  it('JpfFile reads and strips the JPF prefix', () => {
    const bytes = new Uint8Array([0x4a, 0x50, 0x46, 0x00, 0xff, 0xd8, 0xff, 0xe0]);
    const jpf = JpfFile.fromFile(fixture('splash.jpf', bytes));
    expect(Array.from(jpf.jpegBytes)).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  });

  it('PcxFile reads a run-length encoded image', () => {
    const header = new Uint8Array(128);
    const view = new DataView(header.buffer);
    header[0] = 0x0a; header[1] = 5; header[2] = 1; header[3] = 8;
    view.setUint16(8, 3, true);  // xMax
    view.setUint16(10, 0, true); // yMax
    header[65] = 1;
    view.setUint16(66, 4, true); // bytes per line

    const body = [0xc4, 5]; // one run of four 5s
    const bytes = new Uint8Array(header.length + body.length + 1 + 768);
    bytes.set(header);
    bytes.set(body, header.length);
    bytes[header.length + body.length] = 0x0c;

    const pcx = PcxFile.fromFile(fixture('logo.pcx', bytes));
    expect(pcx.width).toBe(4);
    expect(Array.from(pcx.data)).toEqual([5, 5, 5, 5]);
  });

  it('BikFile reads the video header', () => {
    const bytes = new Uint8Array(64);
    const view = new DataView(bytes.buffer);
    bytes[0] = 0x42; bytes[1] = 0x49; bytes[2] = 0x4b; bytes[3] = 0x69;
    view.setUint32(8, 300, true);
    view.setUint32(16, 300, true);
    view.setUint32(20, 640, true);
    view.setUint32(24, 480, true);
    view.setUint32(28, 30, true);
    view.setUint32(32, 1, true);

    const bik = BikFile.fromFile(fixture('intro.bik', bytes));
    expect(bik.width).toBe(640);
    expect(bik.frameCount).toBe(300);
    expect(bik.fps).toBe(30);
  });

  it('DataArchive.compileFromDirectory packs a directory back into an archive', () => {
    const packDir = mkdtempSync(join(tmpdir(), 'dalib-pack-'));
    try {
      writeFileSync(join(packDir, 'one.pal'), new Uint8Array([1, 2, 3, 4]));
      writeFileSync(join(packDir, 'two.tbl'), enc('hello'));

      const archive = DataArchive.fromBuffer(DataArchive.compileFromDirectory(packDir));
      expect(archive.get('one.pal')!.toUint8Array()).toHaveLength(4);
      expect(archive.get('two.tbl')!.toUint8Array()).toHaveLength(5);
      // Names are stored in a fixed-length field, so they must survive the round trip.
      expect(archive.get('one.pal')!.entryName.length).toBeLessThanOrEqual(
        DATA_ARCHIVE_ENTRY_NAME_LENGTH,
      );
    } finally {
      rmSync(packDir, { recursive: true, force: true });
    }
  });

  it('DataArchive.compileFromDirectory rejects a name that will not fit the header field', () => {
    // The name field is fixed width; a longer name would be silently truncated
    // and collide with another entry.
    const packDir = mkdtempSync(join(tmpdir(), 'dalib-pack-'));
    try {
      writeFileSync(join(packDir, 'a-very-long-entry-name.pal'), new Uint8Array(4));
      expect(() => DataArchive.compileFromDirectory(packDir)).toThrow(/too long/);
    } finally {
      rmSync(packDir, { recursive: true, force: true });
    }
  });
});
